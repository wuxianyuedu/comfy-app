#!/usr/bin/env node
// 生产启动入口：解析应用端口（.env 的 COMFYAPP_PORT，缺省按检出路径推导）
// 作为 Next.js 监听端口。
//
// 为什么需要它：`next start` 不认 COMFYAPP_PORT（只认 PORT），改端口那次
// （应用默认端口 3000 → 3100）之后，`pnpm start` 会回落到 Next 的默认 3000，
// 而 Playwright / tauri.conf 都按 3100 找服务 —— CI 的 E2E 因此长期起不来
// （「Timed out waiting 180000ms from config.webServer」）。
// 与 `scripts/dev.mjs` 对称：同一套端口解析（scripts/app-port.mjs），
// 保证「一处配置、两条链路一致」，多份检出并行时也各得其所。
import { spawnSync } from "node:child_process";
import {
  APP_PORT_ENV_KEY,
  resolveAppPortWithSource,
  resolveRepoRoot,
} from "./app-port.mjs";
import { applyPendingRestoreAtBoot } from "./db-backup-core.mjs";
import { spawnSchemaSync } from "./db-schema-state.mjs";
import { exitIfEnvNotReady } from "./env-preflight.mjs";
import { echoCommandLine, formatCommandLine } from "./launcher-core/command-echo.mjs";
import { maybeSpawnExecutorHost } from "./launcher-core/executor-host-spawn.mjs";
import { runStamp } from "./launcher-core/log.mjs";
import { pnpmInvocation } from "./launcher-core/shell.mjs";

const root = resolveRepoRoot();

// 显式 `-p` + PORT 双写：前者是 next 的权威参数，后者兜住其它读 PORT 的工具。
// 端口来源一并打印（与 dev.mjs 同口径，ISSUE #821）：两侧对不上时，
// 「是 .env 写的还是路径推出来的」决定了该改哪一处。
const resolved = resolveAppPortWithSource(root);
const fromPortEnv = process.env.PORT;
const port = fromPortEnv ?? resolved.port;
const sourceLabel = fromPortEnv
  ? "环境变量 PORT"
  : { env: `.env 的 ${APP_PORT_ENV_KEY}`, derived: "按检出路径推导（3200~3999）", fallback: "兜底 3100（路径推导不可用）" }[resolved.source];
process.stdout.write(`[start.mjs] COMFYAPP_PORT=${port}（来源：${sourceLabel}）\n`);

// 环境配置预检：失败就**在起 Next 之前**退出并给出可行动作。
// 放在这里的理由见 env-preflight.mjs —— 否则 Next 会先打印「✓ Ready」，
// 用户看到的是「起来了但报错」，而事实是端口无人监听。
exitIfEnvNotReady(root);

/* 待恢复的备份：同 `dev.mjs`，**必须**排在起 Next 之前（那时才满足「应用没在
 * 跑」）。空转是常态。 */
applyPendingRestoreAtBoot(root);

/* schema 自检 + **后台**同步（与 dev.mjs 同一出口，见 db-schema-state.mjs）：
 * 拉了含 schema 变更的代码之后不必记得跑 `pnpm db:push`；这里不等它，
 * 期间由页面自己说「正在同步」。 */
const schema = spawnSchemaSync(root);
if (!schema.started) {
  process.stdout.write(
    `[start.mjs] ⚠ 无法后台核对数据库结构（${schema.reason ?? "原因未知"}）——` +
      "必要时手动跑：pnpm db:push\n",
  );
}

/* **这里刻意用 `next start`，不换 `.next/standalone/server.js`**（ISSUE #1977 第十一处）。
 *
 * 有过一次改动把它换成 standalone 入口，依据是启动时这句输出：
 *
 *   `"next start" does not work with "output: standalone" configuration.`
 *
 * 那是一句 **`⚠` 警告，不是拒绝** —— 实测 `next start` 照常起（`✓ Ready in 119ms`）、
 * 静态资源 200、`/api/health` 报 `db: "up"`。而换成 standalone 入口之后 E2E
 * **几乎全档红**，因为**仓库检出里的 standalone 载荷是不完整的**（它只由
 * `build-desktop.mjs` 组装成可分发的形态）：
 *
 *   · `.next/standalone/.next/static` **不存在** —— 页面 HTML 照出（SSR），而
 *     `/_next/static/chunks/*` 全 404、MIME 是 `text/plain`，脚本与样式被浏览器拒绝
 *     执行 ⇒ **整个前端不 hydrate**，交互类断言全部 5s 超时；
 *   · `server.js` 启动即 `chdir(__dirname)`，于是 `DATABASE_URL` 的 `./db.sqlite`
 *     落到 `.next/standalone/db.sqlite` —— 一个**空库**，而 23 张表在检出根
 *     （`pnpm db:push` / `dev.mjs` / CI 的建库那一步建的）。现场是
 *     `/api/health` 报 `db: "empty"`。
 *
 * 所以「谁在起这份产物」这件事在**仓库检出**里只有 `next start` 一个正确取值；
 * standalone 入口是**桌包链**的事（`standalone-runtime.mjs`，那边有完整载荷、
 * 静态资源与数据锚点都由它自己给）。 */
const invocation = pnpmInvocation([
  "exec",
  "next",
  "start",
  "-p",
  String(port),
]);
if (!invocation) {
  process.stderr.write(
    "[start.mjs] ✗ PATH 上找不到可用的 pnpm，无法启动 Next.js server。\n" +
      "[start.mjs]   先跑 `pnpm check:toolchain` 看选中的命令与探测结果。\n",
  );
  process.exit(1);
}

/* 执行器宿主（P3 §5：`COMFY_EXECUTOR=host` 时**必须**有人起它）。
 *
 * 为什么这条链路也要有（它是本文件此前的缺口，也是 e2e CI 档全红的根因）：
 * host 模式下行会被写成 `claimedBy='host'`，而只有宿主会去领它——inline 那一侧
 * 的回收器刻意不跨片误杀（ISSUE #1204）。于是「本入口不起宿主」的现场是
 * **两条 @critical 主链路用例各超时 60s 全红**，而报错话术在说「下游替身没应答」
 * （Playwright 的 CI 档 webServer 跑的就是 `pnpm start`，见 playwright.config.ts）。
 *
 * `dev-launcher.mjs` 的编排 6.5 步与 `standalone-runtime.mjs` 的桌包链都有这一步，
 * 三处共用 `maybeSpawnExecutorHost()` 一份实现（§12.18 / §12.12：不许三处各写一遍）。
 *
 * 位置在起 Next **之前**：宿主自己会按节拍去领行，谁先起来都能收敛，但排在前面
 * 能让「宿主的 boot / inject-ok」先落进 services 日志——e2e 现场排查时那两行与
 * Next 的启动行在时间上可比。 */
maybeSpawnExecutorHost({
  root,
  runTimestamp: runStamp(),
  logLine: (message, level = "INFO") =>
    process.stdout.write(`[start.mjs] ${message}\n`),
  // level 目前只用于调用方的可读性：本入口的通道是 stdout，不区分级别。
});

// 与 dev.mjs 同一口径：起服务前先回显真正要跑的那条命令行。
echoCommandLine(invocation.command, invocation.args);
const result = spawnSync(invocation.command, invocation.args, {
  stdio: "inherit",
  env: { ...process.env, PORT: String(port) },
});
if (result.error) {
  process.stderr.write(
    `[start.mjs] ✗ 起 pnpm 失败（${result.error.code ?? "UNKNOWN"}）：${result.error.message}\n` +
      `[start.mjs]   实际命令：${formatCommandLine(invocation.command, invocation.args)}\n`,
  );
  process.exit(1);
}
process.exit(result.status ?? 1);
