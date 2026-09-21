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
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_PORT_ENV_KEY, resolveAppPortWithSource } from "./app-port.mjs";
import { spawnSchemaSync } from "./db-schema-state.mjs";
import { exitIfEnvNotReady } from "./env-preflight.mjs";
import { echoCommandLine, formatCommandLine } from "./launcher-core/command-echo.mjs";
import { pnpmInvocation } from "./launcher-core/shell.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

// 与 dev.mjs 同一口径：pnpm 的可执行形态由 shell.mjs 判定（规范 §2.1.1）。
// 写死 `pnpm.cmd` 在 Windows 上会选中 Node 起不来的批处理，`status` 为 null
// 会被 `?? 0` 读成成功退出，服务静默消失（ISSUE #576）。
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
