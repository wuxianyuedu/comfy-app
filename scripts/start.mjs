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
import { existsSync } from "node:fs";
import path from "node:path";
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
import { buildStandaloneRuntimeEnv } from "./launcher-core/standalone-runtime-env.mjs";

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

/* **构建是 standalone 时不能跑 `next start`**（ISSUE #1977）。
 *
 * `next.config.js` 里 `output: "standalone"`，而 Next 16 明确拒绝这对组合：
 *
 *   `Error: "next start" does not work with "output: standalone" configuration.`
 *   `       Use "node .next/standalone/server.js" instead.`
 *
 * （这三行是**报错原文**，按 §12.4.6 的「错误原文保留英文」处置，用反引号包住 ——
 * `check-comment-language.cjs` 的启发式只把**反引号外的**英文成句算进来。）
 *
 * 这条链此前**从来没跑到过**（E2E 那一档在自托管路径上一直断在更早的 stage），
 * 于是「README 里的 `pnpm start`」与「配置里的 standalone」这对矛盾一直没露出来。
 * 平台侧第一次真跑到 E2E 时，它就是那条红（CI 档 webServer 正是 `pnpm start`）。
 *
 * 两个形态的正确性都不是新知识，仓里都已有出处：
 *   · **产物在**（`pnpm build` 之后）→ 起 `.next/standalone/server.js`，环境由
 *     `buildStandaloneRuntimeEnv()` 给（桌包链用的是同一份，见 standalone-runtime.mjs
 *     ——`NODE_ENV` / `PORT` / `HOSTNAME` / `DATABASE_URL` / 那对 OAuth 占位符一项
 *     都不能少，少一项是运行期某条路由 500）；
 *   · **产物不在**（没构建过）→ 保留 `next start` 的身份，让 Next 自己报那句
 *     「先 next build」——那正是**这台机器该做的事**，替它换个错的入口只会把
 *     真因藏起来。
 *
 * 判据只看「盘上有没有 server.js」这一件事：它由 `next build` 决定，不看环境变量，
 * 也就不可能两处说法不一致。 */
const standaloneServer = path.join(root, ".next", "standalone", "server.js");
const useStandalone = existsSync(standaloneServer);

// 与 dev.mjs 同一口径：pnpm 的可执行形态由 shell.mjs 判定（规范 §2.1.1）。
// 写死 `pnpm.cmd` 在 Windows 上会选中 Node 起不来的批处理，`status` 为 null
// 会被 `?? 0` 读成成功退出，服务静默消失（ISSUE #576）。
const invocation = useStandalone
  ? {
      command: process.execPath,
      args: [standaloneServer],
      /* standalone server.js 启动即 `process.chdir(__dirname)`（实测
       * `.next/standalone/server.js:12`），运行期锚点是**那一层**而不是检出根 ——
       * 所以 `appRoot` 要给 `.next/standalone`，与桌包链同口径。 */
      env: buildStandaloneRuntimeEnv({
        appRoot: path.join(root, ".next", "standalone"),
        port,
      }),
    }
  : pnpmInvocation(["exec", "next", "start", "-p", String(port)]);
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
  /* standalone 那条路的环境由 `buildStandaloneRuntimeEnv()` 一整套给（少一项
   * 就是运行期 500，理由见那个函数的头注）；`next start` 那条路只需要 PORT
   * （它自己读 config 与 .env）。 */
  env: invocation.env ?? { ...process.env, PORT: String(port) },
});
if (result.error) {
  process.stderr.write(
    `[start.mjs] ✗ 起 pnpm 失败（${result.error.code ?? "UNKNOWN"}）：${result.error.message}\n` +
      `[start.mjs]   实际命令：${formatCommandLine(invocation.command, invocation.args)}\n`,
  );
  process.exit(1);
}
process.exit(result.status ?? 1);
