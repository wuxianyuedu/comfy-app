// @ts-nocheck -- 纯 Node 宿主模块（launcher-core），不进 Next 的模块图
/**
 * 桌包 standalone 形态的运行期环境装配（P3 §5 · ISSUE #1216）。
 *
 * 为什么必须有这一份：分发出去的 standalone 载荷里**没有 `.env`**——那是硬规则 17
 * 的结论（`next build` 会无条件把开发机的 `.env` 复制进产物，`outputFileTracingExcludes`
 * 实测无效，真正的防线是产物层剥离）。而 `src/env.js` 的启动校验判的是「`.env` 文件
 * 在不在」（`MissingEnvFileError`），三项必填还把空串当「没给」。所以「剥掉私有输入」
 * 与「server 要读配置」这两件事之间必须有一个人补位：
 *   · 放 Rust 侧 = 把端口口径、密钥生成、按次命名日志、回收语义在另一门语言再写一份
 *     （ADR §14 D5「判据只收一处」+ 硬规则 3），且每次改动都要重编壳（硬规则 5）；
 *   · 写回 `<应用根>/.env` = 在只读或半只读的安装目录里落明文密钥，且把「产物不含
 *     私有输入」这条防线原地废掉；
 *   · 放这里（纯 Node，launcher-core 这一层）= 与 `dev-launcher.mjs` / `executor-host.mjs`
 *     同层同语义，密钥只在运行期经 env 传给直系子进程，磁盘上不留明文配置。
 *
 * 密钥的持久化只存 `BETTER_AUTH_SECRET` 一项（better-auth 的会话签名密钥，跨重启必须
 * 稳定，否则用户每次开机都被登出）。落在 `<应用根>/data/runtime-secret.json`：
 * `data/` 是应用已有的运行期目录约定（`app-settings.server.ts` 与 `llm/secrets.ts`
 * 都写这里），不是新造的概念。
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

/**
 * 本机回环地址。值与 `src/lib/endpoints.ts` 的 `LOOPBACK_HOST` 同形——写
 * `127.0.0.1` 不写 `localhost`（硬规则 20：Node 的 fetch 会把 `localhost` 先解析成
 * IPv6 `::1`，而 ComfyUI / Ollama 只监听 IPv4）。这里另写一份是因为那份是 TS，
 * 纯 Node 宿主加载不到（§18.4），不是「再找一处放默认值」。
 */
export const LOOPBACK_HOST = "127.0.0.1";

/**
 * 本地 OAuth 占位值：非空即可过 `src/env.js` 的 schema，不参与任何真实鉴权。
 *
 * 单一定义点：`scripts/env-init.mjs` 原先自己写了一份同样的字面量，现改为 import
 * 这里（§12.12「跨文件不许各写一份」），两侧不一致的表现是「桌包与 dev 检出的
 * 鉴权配置形状不同」，而不是一个能看见的报错。
 */
export const OAUTH_PLACEHOLDER = "local-dev-placeholder";

/** 64 位随机 hex：满足 schema 的 `min(32)`，与 `pnpm env:init` 同口径。 */
export function newAuthSecret() {
  return randomBytes(32).toString("hex");
}

/** 运行期密钥文件的相对位置（相对应用根）。 */
export const AUTH_SECRET_FILE_REL = path.join("data", "runtime-secret.json");

/**
 * 读或建 `BETTER_AUTH_SECRET`。
 *
 * 「文件在但读不出合法密钥」按真故障抛错而不是悄悄换一把：换一把会让既有会话全部
 * 失效，用户看到的是「莫名其妙被登出」，而现场没有任何线索指向密钥文件坏了。
 *
 * @param {string} appRoot 应用根（standalone 载荷所在目录）
 * @returns {string}
 */
export function readOrCreateAuthSecret(appRoot) {
  const file = path.join(appRoot, AUTH_SECRET_FILE_REL);
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") {
      // 首启：还没有密钥文件。只有这一种情况才新建。
      const secret = newAuthSecret();
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(
        file,
        `${JSON.stringify({ betterAuthSecret: secret }, null, 2)}\n`,
        "utf8",
      );
      return secret;
    }
    // 其它读失败（权限 / 目录被删成半个）是真故障，必须报出来。
    throw new Error(
      `cannot read auth secret: ${file} (${err?.message ?? err})`,
    );
  }
  // 以下三种「文件在但内容不能用」一律抛错，**不悄悄换一把**：换密钥等于把用户已有的
  // 会话全部作废（表现是莫名其妙被登出），而现场不会有任何线索指向密钥文件坏了。
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`auth secret is not valid JSON: ${file}`);
  }
  const secret =
    typeof parsed?.betterAuthSecret === "string" ? parsed.betterAuthSecret : "";
  // 32 是 src/env.js 的 schema 下限；短于它一定是被写坏或手工截断过。
  if (secret.length < 32) {
    throw new Error(
      `auth secret too short (${secret.length} chars, need >= 32): ${file}`,
    );
  }
  return secret;
}

/** 运行期数据库文件（与 `buildStandaloneRuntimeEnv` 的 `DATABASE_URL` 同一处拼法）。
 *  单独出一个函数是因为**首启建表与 server 必须指向同一个文件**：两处各拼一遍
 *  `db.sqlite` 的话，一旦锚点不同就是「建了表的那个库不是 server 读的那个库」，
 *  表现与「表没建」一模一样、现场完全看不出根因。
 * @param {string} appRoot @returns {string} */
export function standaloneDbFile(appRoot) {
  return path.join(appRoot, "db.sqlite");
}

/**
 * 首启建表：库里一张表都没有时，应用随包的 `schema.sql`。
 *
 * 为什么要在运行期做（ISSUE #1216 实测）：桌包没有 pnpm，也没有 `drizzle.config.ts`
 * 与 schema 源，而开发期的建表能力全在构建依赖里。载荷里唯一能带出去的是**每轮构建
 * 现生成的 DDL**（`scripts/build-desktop.mjs` 的 §首启建表，只含结构、不许含数据），
 * 于是首启动作 = 读那份 DDL 执行一次。
 *
 * 幂等判据取「表数量为零」而不是「文件是新的」：重装/升级时库里已有用户的行，这时
 * 一张表都不该动。半途失败的库（表建了一半）落到「非零」这一档，不在本函数里重试——
 * 那属于 `pnpm db:push` 的既有职责，运行期不该有一套平行的补列逻辑（§12.12）。
 *
 * @param {{ appRoot: string, dbFile?: string }} input
 * @returns {{ applied: boolean, tablesBefore: number, tablesAfter: number }}
 */
export function ensureStandaloneSchema({
  appRoot,
  dbFile = standaloneDbFile(appRoot),
}) {
  const schemaFile = path.join(appRoot, "schema.sql");
  const db = new DatabaseSync(dbFile);
  try {
    const count = () =>
      db
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'")
        .get().n;
    const tablesBefore = Number(count());
    if (tablesBefore > 0) {
      return { applied: false, tablesBefore, tablesAfter: tablesBefore };
    }
    if (!existsSync(schemaFile)) {
      throw new Error(
        `first-run schema bootstrap needs ${schemaFile} next to the payload ` +
          "(emitted by scripts/build-desktop.mjs); run `pnpm tauri build` (or node scripts/build-desktop.mjs) first",
      );
    }
    // PRAGMA 清单的权威定义在 `src/lib/sqlite-pragmas.ts`（那条 TS 侧的共用清单）；
    // 本文件是非 TS 宿主、引不到它，所以照抄一份，由 `tests/sqlite-pragma-sites.test.ts`
    // 核两边一致。下面那条 busy_timeout 是**这一侧自己的**预算，故意比宿主的
    // `SQLITE_BUSY_TIMEOUT_MS`（250ms）长：这里是首启建表，一次跑完整个 schema 文件，
    // 撞上一个还在跑的宿主时「等一等」比「启动失败」好，而这个进程此刻不在服务任何界面
    // 请求（libsql/node:sqlite 的语句执行都是同步的，等锁的毫秒数就是本进程停摆的毫秒数，
    // 所以交互侧只给 250ms）。TS 侧走 `timeout` 客户端选项而不是 PRAGMA —— 见那文件头。
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 2000");
    db.exec(readFileSync(schemaFile, "utf8"));
    const tablesAfter = Number(count());
    if (tablesAfter === 0) {
      throw new Error(
        `schema bootstrap ran but the library still has no table: ${schemaFile}`,
      );
    }
    return { applied: true, tablesBefore, tablesAfter };
  } finally {
    db.close();
  }
}

/**
 * 组装 standalone server 的运行期环境。
 *
 * `SKIP_ENV_VALIDATION=1` 只绕开 `src/env.js` 的「`.env` 文件在不在」与 zod 校验，
 * **值仍然由这里逐个给**——`createEnv` 在 skip 形态下原样取 `process.env`，少给一项
 * 就是运行期某条路由 500（`resolveDbPath` 对 `undefined` 的那处历史崩溃就是这么来的，
 * 见 `src/server/db.ts` 的注释），所以这里的必填清单与 `src/env.js` 的 `server` 段
 * 一一对应，由 tests/standalone-runtime.test.ts 钉住「少一项即红」。
 *
 * @param {{ appRoot: string, port: number, env?: NodeJS.ProcessEnv }} input
 * @returns {NodeJS.ProcessEnv}
 */
export function buildStandaloneRuntimeEnv({
  appRoot,
  port,
  env = process.env,
}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `standalone runtime needs a valid PORT from the shell, got: ${JSON.stringify(port)}`,
    );
  }
  return {
    ...env,
    // 载荷**就是**生产构建（Next 自己的 standalone `server.js` 启动即把这一项设成
    // production）。必须由这里显式给的原因是宿主：它是独立 Node 进程，不经过
    // `server.js`，而 `src/lib/core/logger.ts` 在 `NODE_ENV !== "production"` 时选的
    // 是 pino-pretty 的 worker transport —— `pino-pretty` 是 devDependency，**不在载荷
    // 里**，于是宿主在模块加载阶段就 `unable to determine transport target for
    // "pino-pretty"` 退出 1（实测：桌包设 `COMFY_EXECUTOR=host` 时入口打出
    // `host exited code=1`）。`pnpm build` 收尾的冒烟看不见这一条，因为它跑的
    // `.next/standalone` 在仓库里，Node 的模块上溯会撞到仓库的 dev 依赖——
    // 「在仓库里能跑、装到用户机器上就崩」正是这条判据要堵的形状。
    NODE_ENV: "production",
    SKIP_ENV_VALIDATION: "1",
    PORT: String(port),
    HOSTNAME: LOOPBACK_HOST,
    // 绝对路径：Next 的 standalone server.js 启动即 `process.chdir(__dirname)`
    // （实测 .next/standalone/server.js:12），运行期锚点因此是应用根而不是壳给的
    // cwd——写相对路径等于赌两侧锚点一致，所以这里给绝对值。
    DATABASE_URL: `file:${standaloneDbFile(appRoot)}`,
    BETTER_AUTH_SECRET: readOrCreateAuthSecret(appRoot),
    BETTER_AUTH_URL: `http://${LOOPBACK_HOST}:${port}`,
    BETTER_AUTH_GITHUB_CLIENT_ID: OAUTH_PLACEHOLDER,
    BETTER_AUTH_GITHUB_CLIENT_SECRET: OAUTH_PLACEHOLDER,
  };
}
