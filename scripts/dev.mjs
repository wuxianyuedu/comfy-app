#!/usr/bin/env node
// 统一的 dev server 启动入口：解析应用端口（.env 的 COMFYAPP_PORT，缺省按
// 检出路径推导，见 scripts/app-port.mjs）作为 Next.js dev 端口，供
// tauri.conf.json 的 beforeDevCommand 调用。web/prebuilt 启动链路由
// dev-launcher.ps1 直接传 `-p`，不经过本脚本；这里保证 `pnpm tauri dev` 路径
// 与启动链路取到同一端口（多份检出并行时互不冲突）。
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAppPort } from "./app-port.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const port = resolveAppPort(root);
process.stdout.write(`[dev.mjs] COMFYAPP_PORT=${port}\n`);

// Next.js dev 读取 PORT 环境变量；显式透传给 next dev 子进程
const result = spawnSync(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  ["exec", "next", "dev", "--turbo", "-p", String(port)],
  { stdio: "inherit", env: { ...process.env, PORT: String(port) } },
);
process.exit(result.status ?? 0);
