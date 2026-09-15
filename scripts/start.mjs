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
import { resolveAppPort } from "./app-port.mjs";
import { probeSchemaSync } from "./db-schema-state.mjs";
import { exitIfEnvNotReady } from "./env-preflight.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 显式 `-p` + PORT 双写：前者是 next 的权威参数，后者兜住其它读 PORT 的工具。
const port = process.env.PORT ?? resolveAppPort(root);
process.stdout.write(`[start.mjs] COMFYAPP_PORT=${port}\n`);

// 环境配置预检：失败就**在起 Next 之前**退出并给出可行动作。
// 放在这里的理由见 env-preflight.mjs —— 否则 Next 会先打印「✓ Ready」，
// 用户看到的是「起来了但报错」，而事实是端口无人监听。
exitIfEnvNotReady(root);

if (probeSchemaSync(root) !== "ready") {
  process.stdout.write(
    "[start.mjs] ⚠ 数据库表还没建（db.sqlite 缺失或为空）——真实业务页面会 500。\n" +
      "[start.mjs]   先执行：pnpm db:push（见 docs/standards/launch-and-build.md §9.1）\n",
  );
}

const result = spawnSync(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  ["exec", "next", "start", "-p", String(port)],
  { stdio: "inherit", env: { ...process.env, PORT: String(port) } },
);
process.exit(result.status ?? 0);
