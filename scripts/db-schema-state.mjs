// 库就绪探测的**非 TS**实现（scripts/*.mjs 用），判据与
// `src/lib/db-schema-ready.ts` 完全一致：读 `sqlite_master` 找哨兵表。
//
// 为什么要有一份 .mjs：dev.mjs / start.mjs / dev-launcher.mjs 是纯 Node 入口，
// 不能 import `src/lib/db-schema-ready.ts`（它 `import "server-only"` 且要过
// TS 编译）。两处判据必须同源，所以哨兵表名只在这里定义一次、由 TS 侧引用同名
// 常量，分歧会被 tests/db-push-noninteractive.test.ts 拦下。
//
// **本文件不止「表建没建」**：`probeSchemaSync` 只回答了「有没有表」，而
// 「表是不是当前这版 schema 建的那张」是另一件事（实测现场：`workflowTemplate`
// 留着历史版本删过的 `graph TEXT NOT NULL`，新建工作流直接
// `NOT NULL constraint failed`，而它一直报 ready）。`ensureSchemaCurrent` 是
// 启动链路的**唯一出口**：指纹一致就毫秒级通过，不一致就自动同步一次。
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { echoCommandLine } from "./launcher-core/command-echo.mjs";
import {
  canAutoApply,
  pendingStatements,
  pushSchema,
  riskyStatements,
} from "./db-push-core.mjs";

export const SENTINEL_TABLE = "task";

/** schema 源所在目录（相对项目根）；目录下的 `*.ts` 全部参与指纹。 */
const SCHEMA_DIR = ["src", "server", "db"];

/**
 * `file:` 前缀去掉后相对传入 root 解析（与 src/server/db.ts 同一锚点）。
 * @param {string} root 项目根（绝对路径）
 * @param {string} [databaseUrl] 形如 `file:./db.sqlite`
 * @returns {string} 绝对路径
 */
export function resolveSqlitePath(root, databaseUrl) {
  const url = databaseUrl ?? process.env.DATABASE_URL ?? "file:./db.sqlite";
  const raw = url.startsWith("file:") ? url.slice("file:".length) : url;
  return path.resolve(root, raw);
}

/**
 * @param {string} root 项目根（绝对路径）
 * @param {string} [databaseUrl] 形如 `file:./db.sqlite`
 * @returns {"ready" | "missing" | "unknown"}
 */
export function probeSchemaSync(root, databaseUrl) {
  const file = resolveSqlitePath(root, databaseUrl);
  if (!fs.existsSync(file)) return "unknown";
  try {
    const db = new DatabaseSync(file, { readOnly: true, open: true });
    try {
      const row = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get(SENTINEL_TABLE);
      return row ? "ready" : "missing";
    } finally {
      db.close();
    }
  } catch {
    return "unknown";
  }
}

/**
 * 当前 schema 源文件的指纹（31 位正整数）。
 *
 * 用途：回答「库是不是拿这一版 schema 建的」。`db:push` 成功后把指纹写进库里，
 * 启动时比对 —— 不一致就说明「代码里的 schema 已经变了，但库还没跟上」，
 * 也就是「拉了更新忘了跑 `pnpm db:push`」那一档。
 *
 * 取**内容哈希**而不是 mtime：拉取 / 切分支会改 mtime 却不一定改内容，反过来
 * 复制检出会保留内容而换掉 mtime，两种误判都很难查。压到 31 位是因为
 * `user_version` 是**有符号** 32 位整数槽；碰撞概率对这种自检提示（不是安全
 * 边界）足够低。
 *
 * 哈希**整个目录**的 `.ts` 而不是单写 `schema.ts`：将来拆文件时指纹继续成立，
 * 不会变成「改了新文件但指纹没变」。
 *
 * @param {string} root 项目根（绝对路径）
 * @returns {number | null} 读不到 schema 源时 null（判据失效，调用方跳过自检）
 */
export function schemaFingerprint(root) {
  try {
    const dir = path.join(root, ...SCHEMA_DIR);
    const files = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".ts"))
      .sort();
    if (files.length === 0) return null;
    const bytes = Buffer.concat(
      files.map((name) => fs.readFileSync(path.join(dir, name))),
    );
    const digest = crypto.createHash("sha256").update(bytes).digest();
    return digest.readUInt32BE(0) & 0x7fffffff;
  } catch {
    return null;
  }
}

/**
 * 库里登记的 schema 指纹（`PRAGMA user_version`；0 = 从没登记过）。
 *
 * 为什么用 `user_version` 而不是新开一张表：它是 sqlite 自带的库级整数槽，
 * 为「记一个数」新增一张表本身就是一次 schema 变更（本文件要防的正是这个）。
 *
 * @param {string} root
 * @param {string} [databaseUrl]
 * @returns {number | null} 读不到（库不存在 / 被占用）时 null
 */
export function readSchemaFingerprint(root, databaseUrl) {
  const file = resolveSqlitePath(root, databaseUrl);
  if (!fs.existsSync(file)) return null;
  try {
    const db = new DatabaseSync(file, { readOnly: true, open: true });
    try {
      const row = db.prepare("PRAGMA user_version").get();
      return Number(row?.user_version ?? 0);
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/**
 * 登记指纹。
 *
 * @param {string} root
 * @param {string | undefined} databaseUrl
 * @param {number} value
 * @returns {boolean} 写入成功与否（库被别的进程占着写锁时会失败）
 */
export function writeSchemaFingerprint(root, databaseUrl, value) {
  const file = resolveSqlitePath(root, databaseUrl);
  if (!fs.existsSync(file)) return false;
  try {
    const db = new DatabaseSync(file, { open: true });
    try {
      db.exec(`PRAGMA user_version = ${Math.trunc(value)}`);
      return true;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

/**
 * 库里全部 schema 对象的 DDL 摘要 —— 「push 之后库有没有真的变」的判据。
 *
 * 一次 sqlite 查询（毫秒级），替掉「再跑一次 drizzle 看它说 No changes
 * detected」那十几秒：后者多覆盖的只是「部分语句落地」这一档，而这里要挡的
 * 主要是「报了 applied、其实一点没动」（写锁 / 半途失败）。
 *
 * @param {string} root 项目根（绝对路径）
 * @param {string} [databaseUrl] 形如 `file:./db.sqlite`
 * @returns {string | null} 读不到库时 null
 */
function schemaDigest(root, databaseUrl) {
  try {
    const db = new DatabaseSync(resolveSqlitePath(root, databaseUrl), {
      readOnly: true,
      open: true,
    });
    try {
      const rows = db
        .prepare(
          "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
        )
        .all();
      return crypto
        .createHash("sha256")
        .update(
          rows.map((r) => `${r.type}|${r.name}|${r.sql ?? ""}`).join("\n"),
        )
        .digest("hex");
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/**
 * 启动链路的 schema 自检 + **按需自动同步** —— 本模块对启动路径的唯一出口。
 *
 * 目标形态：拉了含 schema 变更的代码之后，**不需要记得**跑 `pnpm db:push`。
 * 判据用指纹闸门而不是「每次都跑一遍 drizzle」：一致时毫秒级返回，不一致时
 * 才付出一次 drizzle 启动的代价（本机约 2-3 秒，且只在 schema 真的变过之后
 * 第一次启动发生）。
 *
 * 自动同步**不带 `--force`**：要让 drizzle 自己在「会丢数据的语句」（删列 /
 * 重建表）上停下来 —— 那种变更必须由人决定，启动链路不替用户做（无 TTY 时它
 * 报交互提示后原样退出，这里按输出判成 `stale`，由调用方讲清「该人工跑
 * `pnpm db:push`」）。这也是本模块与 `db-push.mjs`（那个刻意 `--force`）的分工。
 *
 * @param {string} root
 * @param {{ databaseUrl?: string, push?: typeof pushSchema,
 *           forward?: (chunk: string) => void }} [options]
 * @returns {{ state: "ready" | "synced" | "missing" | "stale" | "unknown",
 *             detail?: string }}
 */
export function ensureSchemaCurrent(root, options = {}) {
  const {
    databaseUrl,
    push = pushSchema,
    forward = (chunk) => process.stdout.write(chunk),
  } = options;

  if (!fs.existsSync(resolveSqlitePath(root, databaseUrl))) {
    return { state: "missing" };
  }
  if (probeSchemaSync(root, databaseUrl) !== "ready")
    return { state: "missing" };

  const want = schemaFingerprint(root);
  if (want === null)
    return { state: "unknown", detail: "读不到 schema 源文件" };
  const have = readSchemaFingerprint(root, databaseUrl);
  if (have === null) return { state: "unknown", detail: "读不到库里的指纹" };
  if (have === want) return { state: "ready" };

  /* 同步前讲一句：drizzle 每次 diff 要十几秒，不说清楚的话用户看到的是
   * 「启动卡住了」。 */
  forward("数据库结构与当前 schema 不一致，正在核对…\n");

  /* 第一次**不带 `--force`**：`strict: true` 会让 drizzle 先把待执行的语句列
   * 出来、再要求确认，而无 TTY 环境里确认弹不出来、它原地退出且**库不动** ——
   * 这一次恰好就是 dry-run，那份语句列表是「能不能自动应用」的唯一依据
   * （判据见 db-push-core.mjs 的白名单：只认建表 / 建索引 / 加列）。 */
  const probe = push(root, { databaseUrl, force: false, forward });

  if (probe.converged) {
    /* 库本来就是对的，只是指纹没登记（登记失败，或上一个版本还没登记过）。
     * 不提示 —— 用户没有需要做的事。 */
    writeSchemaFingerprint(root, databaseUrl, want);
    return { state: "ready" };
  }

  const pending = pendingStatements(probe.firstOutput);
  if (!canAutoApply(pending)) {
    if (pending.length > 0) {
      forward("\n这批变更需要人工确认，启动链路不自动执行：\n");
      for (const statement of pending) forward(`  ${statement}\n`);
      forward("\n");
    }
    return {
      state: "stale",
      detail:
        pending.length === 0
          ? "没能从 drizzle 的输出里认出待执行的语句"
          : `含「会丢数据」的语句 ${riskyStatements(pending).length} 条（删列 / 重建表），启动链路不替你做这个决定`,
    };
  }

  /* 全是安全语句（建表 / 建索引 / 加列）—— 自动应用。仍然复核「真的落地了」：
   * 「报了 applied 但一点没动」要挡住，否则指纹会被错写成「已同步」，
   * 而库其实还是旧结构（那就回到这次要修的那个现场了）。
   *
   * 复核用 push 前后的**库结构摘要**对比（毫秒级），不再起第三轮 drizzle：
   * 每轮 drizzle 在这台机器上约 17 秒，而它多覆盖的只是「部分语句落地」。 */
  forward("\n这批变更不涉及丢数据，自动应用…\n");
  const before = schemaDigest(root, databaseUrl);
  const applied = push(root, {
    databaseUrl,
    force: true,
    verifyConvergence: false,
    forward,
  });
  if (
    !applied.converged ||
    before === null ||
    schemaDigest(root, databaseUrl) === before
  ) {
    return {
      state: "stale",
      detail: applied.converged
        ? "drizzle-kit 报「已应用」，但库的结构没有变化"
        : staleReason(applied),
    };
  }
  writeSchemaFingerprint(root, databaseUrl, want);
  return { state: "synced" };
}

/** 自动同步没成功的原因（给人看的一句话）。
 *  @param {ReturnType<typeof pushSchema>} result
 *  @returns {string} */
function staleReason(result) {
  if (result.invocationFailed) {
    return `起 pnpm 失败（${result.error?.code ?? "UNKNOWN"}）`;
  }
  if (result.blockedByTty) {
    return "这次的变更里有「会丢数据」的语句（删列 / 重建表），drizzle-kit 要求人工确认";
  }
  return "drizzle-kit 没能把库改到与 schema 一致";
}

/**
 * 把 `ensureSchemaCurrent` 的结果翻成给用户看的行。
 *
 * 收在这里而不是三个入口各写一份：dev / start / 启动器要讲的是同一件事，
 * 分散写必然分叉（这个仓库吃过太多次两处口径不一致的亏）。
 *
 * @param {{ state: string, detail?: string }} result
 * @returns {{ level: "info" | "warn", lines: string[] } | null} null = 无需打印
 */
export function schemaNotice(result) {
  switch (result.state) {
    case "ready":
      return null;
    case "synced":
      return {
        level: "info",
        lines: ["数据库 schema 已自动同步到当前版本（这次改动不涉及丢数据）。"],
      };
    case "missing":
      return {
        level: "warn",
        lines: [
          "数据库表还没建（db.sqlite 缺失或为空）——真实业务页面会 500。",
          "先执行：pnpm db:push（见 docs/standards/launch-and-build.md §9.1）",
        ],
      };
    case "stale":
      return {
        level: "warn",
        lines: [
          `数据库结构与当前 schema 不一致，自动同步没能完成：${result.detail ?? "原因未知"}。`,
          "先执行：pnpm db:push（它带 --force，会自动执行「会丢数据」的语句，",
          "请先确认这次 schema 变更确实可以丢弃那些数据）",
        ],
      };
    default:
      return {
        level: "warn",
        lines: [
          `schema 自检没能完成：${result.detail ?? "原因未知"}。`,
          "必要时手动跑一次：pnpm db:push",
        ],
      };
  }
}

/** 后台同步的状态文件（相对项目根）。服务端 `GET /api/schema` 读它透出给页面。 */
export const SCHEMA_SYNC_STATUS_FILE = path.join("log", "schema-sync.json");

/**
 * 写同步状态（`{ phase, detail, at }`）。
 *
 * 用**文件**而不是内存：写它的是后台的 `db-sync.mjs` 子进程，读它的是另一个
 * 进程里的 Next 服务端 —— 两者唯一的交汇处就是磁盘。
 *
 * 写不进去**不算错**：最坏的后果只是页面少一条提示（同步本身照常），所以这里
 * 静默吞掉异常而不是把同步流程带崩。
 *
 * @param {string} root 项目根
 * @param {{ phase: string, detail?: string | null }} payload
 * @returns {boolean} 是否写成功
 */
export function writeSchemaSyncStatus(root, payload) {
  const file = path.join(root, SCHEMA_SYNC_STATUS_FILE);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      `${JSON.stringify({ ...payload, at: new Date().toISOString() })}\n`,
      "utf8",
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * 后台起一次 schema 同步，**不等待**。
 *
 * 为什么不让调用方等：drizzle 一轮约 17 秒、同步一次 15~30 秒。此前是
 * 「先同步、再起 Next」，用户要盯着空窗等半分钟；现在「先把 Next 拉起来、
 * 同步在后台跑」，等待时间还给用户，期间页面自己会显示「正在同步」。
 *
 * 输出重定向进 `log/schema-sync.log`（本进程通常立刻阻塞在 Next 上，转发不了
 * 子进程的输出）；真正的对外信号是状态文件。
 *
 * @param {string} root 项目根
 * @returns {{ started: boolean, reason?: string }}
 */
export function spawnSchemaSync(root) {
  const script = path.join(root, "scripts", "db-sync.mjs");
  if (!fs.existsSync(script)) {
    /* 生产产物里 `scripts/` 只保留运行时会读的那几个（见 build-desktop 白名单），
     * 那时这里没有可跑的东西 —— 如实返回，调用方据此不提示而不是报错。 */
    return { started: false, reason: "找不到 scripts/db-sync.mjs" };
  }
  /** @type {"ignore" | ["ignore", number, number]} */
  let stdio = "ignore";
  try {
    const dir = path.join(root, "log");
    fs.mkdirSync(dir, { recursive: true });
    const fd = fs.openSync(path.join(dir, "schema-sync.log"), "a");
    stdio = ["ignore", fd, fd];
  } catch {
    /* 日志文件开不出来就丢弃输出，不影响同步本身。 */
  }
  try {
    // 后台同步是「看不见的 15~30 秒」：先回显要跑的那条命令，出问题时至少知道
    // 谁在后台动数据库（输出落在 log/schema-sync.log，命令行则留在当前终端/编排日志）。
    echoCommandLine(process.execPath, [script]);
    const child = spawn(process.execPath, [script], {
      cwd: root,
      detached: true,
      stdio,
    });
    child.unref();
    return { started: true };
  } catch (error) {
    return {
      started: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
