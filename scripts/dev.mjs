#!/usr/bin/env node
// 统一的 dev server 启动入口：解析应用端口（.env 的 COMFYAPP_PORT，缺省按
// 检出路径推导，见 scripts/app-port.mjs）作为 Next.js dev 端口。
//
// 两条调用链都经本脚本，端口解析只此一处（launch-and-build.md §1.1）：
//   - `pnpm dev`（开发者 / Linux / CI，不依赖任何 .ps1）
//   - tauri.conf.json 的 beforeDevCommand（`pnpm tauri dev`）
// Windows 双击链路（dev-launcher.ps1）会显式传 `-p <port> -H 127.0.0.1`，
// 此时以命令行参数为准（见下方 parseArgs）——启动器已经算过端口，重算一遍
// 只会制造两个事实源。
//
// 「pnpm dev 也要经这里」的原因是端口契约：裸 `next dev` 会用 Next 的默认
// 3000，而 .env / 路径推导 / Playwright / 启动器全都按解析出的端口（缺省
// 3200..3999 区间）找服务 —— 两边不一致时表现为「服务起来了但连不上」。
// `pnpm start` 已因同类问题修过（scripts/start.mjs），这里补齐 dev 一侧。
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAppPort } from "./app-port.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 解析透传参数：-p/--port 覆盖端口，-H/--hostname 指定监听地址。
 *  未显式给出时都用解析值/默认值，保证「开发者手工 pnpm dev」与
 *  「启动器 pnpm dev -p N」走同一条命令构造路径。 */
function parseArgs(argv) {
  let port = null;
  let hostname = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-p" || a === "--port") port = argv[i + 1] ?? port;
    else if (a.startsWith("--port=")) port = a.slice("--port=".length);
    else if (a === "-H" || a === "--hostname") hostname = argv[i + 1] ?? hostname;
    else if (a.startsWith("--hostname=")) hostname = a.slice("--hostname=".length);
  }
  return { port, hostname };
}

const { port: portArg, hostname } = parseArgs(process.argv.slice(2));
// 命令行显式端口优先（启动器已经算好）；否则走 .env → 路径推导 → 兜底。
const parsed = Number.parseInt(portArg ?? "", 10);
const port =
  Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535
    ? parsed
    : resolveAppPort(root);
process.stdout.write(
  `[dev.mjs] COMFYAPP_PORT=${port}${hostname ? ` host=${hostname}` : ""}\n`,
);

const nextArgs = ["exec", "next", "dev", "--turbo", "-p", String(port)];
// 显式指定监听地址时透传：Windows 上不固定 127.0.0.1 会被解析到 ::1（IPv6），
// 导致按 127.0.0.1 做的健康检查失败（启动器传 -H 127.0.0.1 即为此）。
if (hostname) nextArgs.push("-H", hostname);

// Next.js dev 读取 PORT 环境变量；显式透传给 next dev 子进程
const result = spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", nextArgs, {
  stdio: "inherit",
  env: { ...process.env, PORT: String(port) },
});
process.exit(result.status ?? 0);
