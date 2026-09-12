#!/usr/bin/env node
// 生产启动入口：读取 .env 的 COMFYAPP_PORT 作为 Next.js 监听端口。
//
// 为什么需要它：`next start` 不认 COMFYAPP_PORT（只认 PORT），改端口那次
// （应用默认端口 3000 → 3100）之后，`pnpm start` 会回落到 Next 的默认 3000，
// 而 Playwright / tauri.conf 都按 3100 找服务 —— CI 的 E2E 因此长期起不来
// （「Timed out waiting 180000ms from config.webServer」）。
// 与 `scripts/dev.mjs` 对称：dev 读 .env 端口 + `next dev`，这里读 .env 端口
// + `next start`，保证「一处配置、两条链路一致」。
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 从 .env 读端口（与 src/env.js 同目录约定），未配置或非法时回退 3100。
function readPort() {
  try {
    const envRaw = readFileSync(path.join(root, ".env"), "utf8");
    const line = envRaw
      .split(/\r?\n/)
      .find((l) => /^\s*COMFYAPP_PORT\s*=/.test(l));
    if (!line) return 3100;
    const val = line
      .split("=", 2)[1]
      .trim()
      .replace(/^["']|["']$/g, "");
    const port = Number.parseInt(val, 10);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) return port;
  } catch {
    // .env 缺失或不可读时用默认端口。
  }
  return 3100;
}

// 显式 `-p` + PORT 双写：前者是 next 的权威参数，后者兜住其它读 PORT 的工具。
const port = process.env.PORT ?? readPort();
process.stdout.write(`[start.mjs] COMFYAPP_PORT=${port}\n`);

const result = spawnSync(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  ["exec", "next", "start", "-p", String(port)],
  { stdio: "inherit", env: { ...process.env, PORT: String(port) } },
);
process.exit(result.status ?? 0);
