#!/usr/bin/env node
// 数据库 schema 同步入口（`pnpm db:push`）。
//
// 为什么不能直接 `drizzle-kit push`：它在需要交互确认时会**静默失败**——
// `drizzle-kit push` 遇到「要丢数据/重建表」的语句会弹交互提示，而在无 TTY
// 环境（CI、脚本、远程会话、容器）里它报
// `Interactive prompts require a TTY terminal` 后 **exit 0**，并把
// `db.sqlite` 留成 **0 字节**（一张表都没有）。调用方（尤其照着文档
// `pnpm db:push && pnpm dev` 走的人）看到的是「成功」，随后应用起来
// `/`、`/api/health` 都 200，只有真实业务路由 500（`no such table`）——
// 属规范 §9.2 第 3 条明令禁止的「静默失败」，比抛错难查得多。
//
// 本脚本做三件事（**库已经是当前这版 schema 建的那张**时那三件都不必做，
// 见下面「空转档」）：
//   1. 以 `--force` 运行（无交互、幂等：已有 schema 时输出 No changes detected）；
//   2. **复核结果**——不看退出码，看库里到底有没有表（退出码在这条链路上不可信）；
//   3. 复核失败即**非零退出并打印可行动提示**，绝不把「留了个空库」当成功。
//
// ── 空转档：库与当前 schema 一致时，一次 drizzle 都不起 ────────────────────
//
// 判据是 `probeSchemaFresh()`（`db-schema-state.mjs`，只读、毫秒级）：表在、
// 且库里登记的指纹 == 源码 schema 的指纹 ⇒ 库就是这一版 schema 建的，那三件事
// 一件都不必做。`Changes applied` 与 `No changes detected` 是同一份 schema 的
// 两次同一结果，前者不必重放，而「复核表结构」要复核的正是「它落地了没有」。
//
// 代价那边写清：drizzle-kit 一轮要十几秒（CI 节点上更久），而这是平台侧每条 PR
// 都跑的一格 —— 空转档省掉的是它自己在日志里承认的那句「No changes detected」。
// 判据失效（读不到库 / 读不到指纹）时不跳：**「拿不到结论」不是「已经一致」**。
//
// 指纹对不上时仍按原样全跑（不另做增量）—— 那一档本来就该由 drizzle 说
// 「有什么要改」，本脚本不替它猜。

// 关于 `--force`：它的语义是「自动批准会丢数据的语句」（drop column / 重建表
// 等）。首次建表与增量加表都没有丢数据的语句，无风险；但**当 schema 变更需要
// 丢弃既有数据时它会直接执行而不询问**——那时请先在副本上确认，或改用
// `pnpm db:generate` + `pnpm db:migrate` 审阅 SQL 后再应用（见
// docs/standards/launch-and-build.md §9.1）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { pushSchema } from "./db-push-core.mjs";
import { pnpmCli, spawnSettled } from "./ci-install-deps.mjs";
import { rejectUnknownArgs } from "./cli-arg-contract.mjs";
import { sweepLegacyTimestamps } from "./db-legacy-sweep.mjs";
import {
  probeSchemaFresh,
  resolveSqlitePath,
  schemaFingerprint,
  writeSchemaFingerprint,
} from "./db-schema-state.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* 本入口**不接受任何参数**，所以认不出的旗标一律退非零，而不是默默吞掉（ISSUE #1956）。
 *
 * 吞掉的代价在这条链上不是「参数没生效」而是**库被改了**：它默认动的那一句是
 * `pushSchema(root, { force: true })`，即 `drizzle-kit push --force` —— 真写库，
 * 且 `--force` 的语义是「自动批准会丢数据的语句」。实测踩过：本想拿一份不写库的
 * 清单，敲了 `node scripts/db-push.mjs --dry-run`，它照旧起了 `push --force` 并把
 * 批次落了库（那批里唯一一条 `DROP TABLE loraTrainingJob` 恰好是张 0 行的表 ——
 * 没造成损失，但**这个方向本来不该由「恰好那张表是空的」来兜**）。
 *
 * 判据与正文形状在 `cli-arg-contract.mjs`（`db:migrate` 问的是同一个问题，
 * §12.18 一处定义）；这里只交出自己的那一句因果与出口。
 *
 * 为什么是「拒绝」而不是「补一个 `--dry-run`」：破坏性入口遇到不认识的旗标时，
 * 唯一不猜的答复就是不作动。真要一份不写库的语句清单，出口现成且已被实测：
 * `pnpm exec drizzle-kit push`（不带 `--force`）—— 无 TTY 时它把语句列出来、停在
 * 确认那一步，库不动（本轮就是拿这一形在临时副本上复现出 #1956 那个 fail-open 的）。 */
rejectUnknownArgs({
  command: "db:push",
  action:
    "它默认动的是 `drizzle-kit push --force` —— **真的写库**，且自动批准会丢数据的语句。",
  exits: [
    "一份不写库的待执行语句清单 → pnpm exec drizzle-kit push（不带 --force；" +
      "无 TTY 时它列出语句后停在确认那一步，库不动）；",
    "只要不丢数据的变更 → 交给启动链路自动应用，或看 e2e 开跑前那一卡的判决；",
    "要审阅 SQL 再决定 → pnpm db:generate + pnpm db:migrate。",
  ],
  fail,
});

/* 库路径的解析**只有一份实现**（`resolveSqlitePath`，与启动链路同源）——
 * 这里此前自己抄了一遍逐字等价的版本，`db:migrate` 的入口又要同一件事：
 * 两份副本的下场是「改了一处、另一处继续按旧口径找库」而**没有任何判据会响**
 * （§12.12 / §12.18）。 */
const dbPath = resolveSqlitePath(root);

/** 数一遍库里的用户表（排除 sqlite 内部表）。读不到/不是库 → -1。 */
function countUserTables() {
  if (!fs.existsSync(dbPath)) return -1;
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true, open: true });
    try {
      const row = db
        .prepare(
          "SELECT count(*) AS c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .get();
      return Number(row.c ?? 0);
    } finally {
      db.close();
    }
  } catch {
    return -1;
  }
}

function fail(message) {
  process.stderr.write(`\n[db:push] ✗ ${message}\n\n`);
  process.exit(1);
}

process.stdout.write(`[db:push] 同步 schema → ${dbPath}\n`);

/* 空转档（见文件头）：库就是这一版 schema 建的 ⇒ 那一趟 drizzle、那次表数复核、
 * 那次结构收敛复核都没有新信息。判据只读、毫秒级，且**判据失效时不跳**。 */
const fresh = probeSchemaFresh(root);
if (fresh.state === "synced") {
  process.stdout.write(`[db:push] ✓ 跳过同步：${fresh.detail}\n`);
} else {
  syncSchema();
}

/**
 * 真跑那一趟：drizzle → 复核表数 → 复核结构 → 归一历史时间戳 → 登记指纹。
 *
 * 任一步判不过就 `fail()`（非零退出 + 可行动提示）。**空转档不进来** ——
 * 库已经是这一版 schema 建的那张时，这五步都不会给出新信息。
 */
function syncSchema() {
  /* pnpm 的可执行形态由 shell.mjs 一处判定（规范 §2.1.1 / §9.5）；「跑一次并
   * 复核它真的落地」收在 `db-push-core.mjs` —— 启动链路的按需同步用同一份，
   * 判据不会分叉（写死 `pnpm` 在 Windows 上会选中 Node 起不来的形态，而本脚本
   * 刻意不看退出码，于是「命令没起来」会被下面那句「库里表数为 0」的复核捕获，
   * 报成一句与真相无关的「drizzle-kit 无 TTY」，ISSUE #638 同族）。
   *
   * `--force` 是本命令的既定口径（自动批准「会丢数据」的语句）——启动链路刻意
   * **不**沿用它，见 db-schema-state.mjs 的 `ensureSchemaCurrent`。 */
  /* ⚠️ 平台节点上的 PATH 里没有 pnpm（服务账号会话，ISSUE #2281）：先把它的
   * 落点找出来，再按「绝对路径 + 参数」起 —— 命令形态仍然只有一份实现
   * （`pnpmCli` → `ensurePnpmOnPath`），这里不自己拼可执行名。 */
  const cli = pnpmCli();
  const result = pushSchema(root, {
    force: true,
    run: (args, { cwd, env, stdio, timeoutMs }) =>
      spawnSettled(cli.command, [...cli.prefixArgs, ...args], {
        cwd,
        env,
        stdio,
        timeout: timeoutMs,
        encoding: "utf8",
        windowsHide: true,
      }),
  });

  /* 注意：这里**刻意不看 drizzle-kit 的退出码**。它在无 TTY 上正是「报错但
   * exit 0」，退出码在这条链路上不是事实来源；下面直接查库。 */
  const tables = countUserTables();
  if (tables <= 0) {
    const hint = result.invocationFailed
      ? `起 pnpm 失败（${result.error?.code ?? "UNKNOWN"}）：${result.error?.message ?? ""}`
      : result.blockedByTty
        ? "drizzle-kit 报「Interactive prompts require a TTY terminal」——交互提示被静默吞掉，库原样没动。"
        : "drizzle-kit 没走到 diff 那一步（输出见上），且库里的用户表数为 0。";
    fail(
      [
        hint,
        "",
        `库文件：${dbPath}（${fs.existsSync(dbPath) ? `${fs.statSync(dbPath).size} 字节` : "不存在"}）`,
        "",
        /* 「输出见上」要把话兑现：上面转发过的是 stdout，而真原因（地址被 libsql 拒、
         * 方言不认识、连接失败那一类）在 stderr —— `pushSchema` 已经把两路拼进
         * `firstOutput`，不接出来等于把根因丢掉（硬规则 4）。同文件下面那条
         * 「没收敛」的分支就是这么打的，这一条是那一形状漏掉的另一半。
         * ⚠️ 这里**不**打退出码当结论：它「报错 + 留一个没动过的库 + 退 0」是实测形态。 */
        "第一次输出的尾部：",
        ...result.firstOutput
          .trim()
          .split("\n")
          .slice(-12)
          .map((line) => `  ${line}`),
        "",
        "可行动作：",
        "  · 确认 drizzle.config.ts 的 dbCredentials.url 与 DATABASE_URL 指向同一个库；",
        "  · 手工重跑看完整输出：pnpm exec drizzle-kit push --force",
        "  · schema 有语法/引用错误时先修 src/server/db/schema.ts 再重跑。",
      ].join("\n"),
    );
  }

  process.stdout.write(`[db:push] ✓ 用户表 ${tables} 张\n`);

  /* ── 复核二：表**结构**是否真的与 schema 一致 ────────────────────────────
   *
   * 「有表」不等于「表就是 schema 说的那一张」。实测现场：库里的
   * `workflowTemplate` 留着历史版本删过的 `graph TEXT NOT NULL`，于是新建工作流
   * 直接 `NOT NULL constraint failed: workflowTemplate.graph` —— 而上面那条
   * 「表数 > 0」的复核一路绿灯，`probeSchemaSync` 也只判「表建没建」，同样说
   * ready。用户看到的是一句数据库报错，所有自检都说没问题。
   *
   * 判据（跑了第二次仍不是 `No changes detected`）收在 `db-push-core.mjs`。 */
  if (!result.converged) {
    fail(
      [
        "drizzle-kit 两次都报告有变更：第一次的语句没有全部落地，表结构与 schema 仍不一致。",
        "",
        `库文件：${dbPath}`,
        "",
        "第二次输出的尾部：",
        ...result.finalOutput
          .trim()
          .split("\n")
          .slice(-12)
          .map((line) => `  ${line}`),
        "",
        "可行动作：",
        "  · 手工重跑看完整输出：pnpm exec drizzle-kit push --force",
        "  · 按签名里的表名核对库里的实际列（PRAGMA table_info(<表名>)），与",
        "    src/server/db/schema.ts 对齐后再重跑；",
        "  · 确认没有另一个进程（dev server）长时间占着写锁。",
      ].join("\n"),
    );
  }

  process.stdout.write(`[db:push] ✓ schema 已收敛（无待应用变更）\n`);

  /* ── 历史时间戳写法归一（幂等，见 db-legacy-sweep.mjs）─────────────────────
   *
   * `project` 表里混着裸毫秒串与 ISO 串两种 `createdAt` / `updatedAt`
   * （ISSUE #1501 现场：4 行里两行是 `1787379642808`）。写入侧早就是 ISO
   * （`schema.ts` 的 `dateNotNull`），所以那是**读进来就得挡着**的历史痕迹。
   *
   * 为什么放在 `db:push` 而不放启动链路：这是数据改写，不是 DDL —— 启动链路
   * 连「会丢数据的 DDL」都不替用户决定（见 db-schema-state.mjs），更不会顺手
   * 改数据。放在这里，用户跑过一次 `pnpm db:push` 就顺手清干净了。
   *
   * 清洗失败/打不开库都不拦命令：它是整理，不是这一趟的目的。 */
  sweepLegacyTimestamps(dbPath);

  /* ── 登记 schema 指纹 ────────────────────────────────────────────────────
   *
   * 启动链路（dev / start / 启动器）靠这个数判断「库是不是当前这版 schema 建的」，
   * 好让「拉了含 schema 变更的代码后忘了跑 db:push」不再依赖人记得
   * （见 db-schema-state.mjs 的 `ensureSchemaCurrent`）。
   *
   * 登记失败**不算错**：最坏的后果只是启动时多跑一次 diff（那次会说
   * No changes detected），所以这里只提示不退出。 */
  const fingerprint = schemaFingerprint(root);
  if (fingerprint === null) {
    process.stdout.write(
      "[db:push] ⚠ 读不到 src/server/db/*.ts，跳过指纹登记（启动时会多跑一次 diff）\n",
    );
  } else if (writeSchemaFingerprint(root, undefined, fingerprint)) {
    process.stdout.write(`[db:push] ✓ 已登记 schema 指纹 ${fingerprint}\n`);
  } else {
    process.stdout.write(
      "[db:push] ⚠ 指纹登记失败（库不可写 / 被占用）——启动时会多跑一次 diff\n",
    );
  }
}
