import { defineConfig } from "drizzle-kit";

/**
 * SQLite 地址必须**带着 scheme** 交给 drizzle-kit。
 *
 * 它这一路的 sqlite 驱动就是 `@libsql/client`（实测 drizzle-kit@0.31.11：
 * `connectToSQLite` → `createClient` → `expandConfig`），而 libsql 把「没有 scheme
 * 的裸字符串」也按 URL 解析 —— **绝对 Windows 路径 `C:\...\db.sqlite` 会被读成
 * scheme="C:"，当场抛 `URL_SCHEME_NOT_SUPPORTED`**。
 *
 * 原先这里写的是 `.replace(/^file:/, "")`（注释说「drizzle-kit 需要纯路径」），
 * 那正是把绝对地址推进被拒那一形的来源。它长期没暴露只有一个原因：日常开发用的
 * `file:./db.sqlite` 去掉前缀后是 `./db.sqlite`，里面没有冒号，libsql 按相对路径
 * 收下；而运行期装配的地址（`scripts/launcher-core/standalone-runtime-env.mjs` 的
 * `DATABASE_URL`，绝对路径）、以及 `tests/db-migrate-equivalence.test.ts` 临时库
 * 的地址都是绝对形式 —— 换到那一档就整条 `db:push` / `db:migrate` 静默不落地。
 *
 * ⚠️ 更坏的一面：drizzle-kit 在被拒时**仍然 exit 0**（实测两档都是 0 且把堆栈打在
 * stderr），所以退出码在这条链路上不是事实来源，「库里到底有没有表」只能由
 * `scripts/db-push.mjs` / `scripts/db-migrate.mjs` 的查库复核来抓 —— 那两条的失败
 * 话术现在会把 drizzle 的 stderr 一起打出来。
 *
 * 实测两种带前缀的形态都成立（各建出 23 张表、落在各自指定的文件上）：
 * `file:./x.sqlite` 相对 CWD、`file:C:\tmp\x.sqlite` 绝对。锚点与
 * `src/server/db.ts::resolveDbPath` / `scripts/db-schema-state.mjs::resolveSqlitePath`
 * 一致（两者都是「剥掉 `file:` 后按进程 CWD / 项目根解析」），所以不存在
 * 「drizzle 写的库不是应用读的那个库」。
 */
/* 空值也要兜：`SKIP_ENV_VALIDATION=1` 时这一项可能是**空串**而不是未定义，
 * `??` 不兜空串，会得到一个光秃秃的 `file:`（`src/server/db.ts::resolveDbPath` 早已
 * 为这一档写了「或」兜底，两侧口径必须一致，否则「应用连着默认库、drizzle-kit 拿着
 * 一个打不开的地址」又是两条锚点分叉）。写成显式的「拿到的是不是一句真值」，
 * 而不是靠 `||` —— 同一判据在 `scripts/db-schema-state.mjs` 里也是这个形状。 */
const fromEnv =
  typeof process.env.DATABASE_URL === "string" ? process.env.DATABASE_URL : "";
const raw = fromEnv === "" ? "file:./db.sqlite" : fromEnv;

/* scheme 判定要求**至少两个字符**再加冒号：单字母不算 scheme，否则 Windows 盘符
 * （`C:`）会被当成 scheme 原样放过，又回到被拒那一形。`file:` / `libsql:` /
 * `wss:` 这类才是 libsql 认的 scheme，一律原样交给它。 */
const hasScheme = /^[a-z][a-z0-9+.-]+:/i.test(raw);
const url = hasScheme ? raw : `file:${raw}`;

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
