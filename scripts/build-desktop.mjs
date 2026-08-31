#!/usr/bin/env node
/**
 * build-desktop.mjs — Tauri 桌面壳生产构建脚本
 *
 * 职责（供 tauri.conf.json 的 beforeBuildCommand 调用，随后执行 pnpm tauri build）：
 *   1) pnpm build：Next.js 输出 standalone（.next/standalone，含 server.js + 裁剪版 node_modules）
 *   2) 组装 src-tauri/static：
 *        - .next/standalone/*        → static/（server 本体）
 *        - .next/static/*            → static/.next/static（前端静态资源，standalone 不自动带）
 *        - public/*                  → static/public
 *        - 生成 index.html（sidecar 就绪前的过渡加载页）
 *   3) 复制当前 Node 运行时为 Tauri sidecar：src-tauri/binaries/node-<target-triple>.exe
 *      （bundle.externalBin = ["binaries/node"]，打包后资源中名为 node.exe）
 *
 * 产物被 src-tauri/.gitignore 忽略，不入库。
 */
import { execSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const nextOut = join(root, ".next", "standalone");
const staticDir = join(root, "src-tauri", "static");
const binDir = join(root, "src-tauri", "binaries");

function targetTriple() {
  if (process.platform === "win32") {
    return process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  }
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  return process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
}

function fail(msg) {
  console.error(`[build-desktop] 错误：${msg}`);
  process.exit(1);
}

// ── 1/4 next build（standalone）────────────────────────────
console.log("[build-desktop] 1/4 执行 pnpm build（Next standalone 输出）...");
execSync("pnpm build", { stdio: "inherit", cwd: root });
if (!existsSync(join(nextOut, "server.js"))) {
  fail(".next/standalone/server.js 不存在，请确认 next.config.js 已配置 output: 'standalone'");
}

// ── 2/4 组装 src-tauri/static ──────────────────────────────
console.log("[build-desktop] 2/4 组装 src-tauri/static ...");
rmSync(staticDir, { recursive: true, force: true });
mkdirSync(staticDir, { recursive: true });

// ── 2.1 §10.2 自动同步启动脚本 ─────────────────────────────
// dev-launcher.ps1 是手工维护的主脚本（scripts/dev-launcher.ps1）在
// Tauri 打包内的同步副本。原本靠人工维护，这里改为构建时自动覆盖，
// 保证 §10.2「改主脚本须同步副本」由构建流程保证，不再依赖手动同步。
const launcherSrc = join(root, "scripts", "dev-launcher.ps1");
if (existsSync(launcherSrc)) {
  const launcherDestDir = join(staticDir, "scripts");
  mkdirSync(launcherDestDir, { recursive: true });
  copyFileSync(launcherSrc, join(launcherDestDir, "dev-launcher.ps1"));
  console.log("[build-desktop]   §10.2 已自动同步 scripts/dev-launcher.ps1 → static/scripts/dev-launcher.ps1");
}

cpSync(nextOut, staticDir, { recursive: true, dereference: true }); // server.js + 裁剪 node_modules（解引用 symlink，避免 Windows 无开发者权限时 EPERM）
cpSync(join(root, ".next", "static"), join(staticDir, ".next", "static"), { recursive: true });
if (existsSync(join(root, "public"))) {
  cpSync(join(root, "public"), join(staticDir, "public"), { recursive: true });
}

// 启动页：Tauri 窗口初始 URL 为 splash.html（tauri.conf.json windows[0].url）。
// public/splash.html 在 Next.js dev 模式下由 localhost:3000/splash.html 服务；
// 生产构建时把它复制到 static 根，让 Tauri 内置服务器直接提供。
const splashSrc = join(root, "public", "splash.html");
if (existsSync(splashSrc)) {
  copyFileSync(splashSrc, join(staticDir, "splash.html"));
}

// fallback index.html：与 splash.html 内容一致，避免直接访问根路径时出现旧 spinner
const splashHtml = existsSync(splashSrc) ? readFileSync(splashSrc, "utf8") : `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Comfy APP</title></head>
<body style="background:#0A0A0F;color:#E5E5E7;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui,sans-serif;">Comfy APP 正在启动…</body></html>`;
writeFileSync(join(staticDir, "index.html"), splashHtml, "utf8");

console.log("[build-desktop]   static 组装完成（standalone + .next/static + public + splash.html + index.html fallback）");

// ── 3/4 Node 运行时 sidecar ────────────────────────────────
console.log("[build-desktop] 3/4 复制 Node 运行时为 sidecar ...");
mkdirSync(binDir, { recursive: true });
const sidecar = join(binDir, `node-${targetTriple()}.exe`);
copyFileSync(process.execPath, sidecar);
console.log(`[build-desktop]   sidecar: ${sidecar} (${(statSync(sidecar).size / 1024 / 1024).toFixed(1)} MB)`);

// ── 4/4 完成 ───────────────────────────────────────────────
console.log("[build-desktop] 4/4 完成。请执行 pnpm tauri build 打出安装包。");
