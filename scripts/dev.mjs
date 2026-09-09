#!/usr/bin/env node
// 统一的 dev server 启动入口：读取 .env 的 COMFYAPP_PORT 作为 Next.js dev 端口，
// 供 tauri.conf.json 的 beforeDevCommand 调用。web/prebuilt 启动链路由
// dev-launcher.ps1 直接传 `-p`，不经过本脚本；这里保证 `pnpm tauri dev` 路径
// 也能用 .env 里配置的端口，避免与其他应用冲突。
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 从 .env 读端口（与 src/env.js 同目录约定），未配置或非法时回退 3100
function readPort() {
  try {
    const envRaw = readFileSync(path.join(root, ".env"), "utf8");
    const line = envRaw.split(/\r?\n/).find((l) => /^\s*COMFYAPP_PORT\s*=/.test(l));
    if (!line) return 3100;
    const val = line.split("=", 2)[1].trim().replace(/^["']|["']$/g, "");
    const port = Number.parseInt(val, 10);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) return port;
  } catch {
    // .env 缺失或不可读时用默认端口
  }
  return 3100;
}

const port = readPort();
process.stdout.write(`[dev.mjs] COMFYAPP_PORT=${port}\n`);

// Next.js dev 读取 PORT 环境变量；显式透传给 next dev 子进程
const result = spawnSync(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  ["exec", "next", "dev", "--turbo", "-p", String(port)],
  { stdio: "inherit", env: { ...process.env, PORT: String(port) } },
);
process.exit(result.status ?? 0);
