#!/usr/bin/env node
// @ts-nocheck
/**
 * doc-facts.cjs — 文档引用事实提取共享模块（供 doc:check / doc:render 复用）
 *
 * 单一事实原则：真实值只存在于源码/配置，本模块运行时从权威源动态提取。
 * scripts/check-doc-references.cjs（doc:check）与 scripts/render-doc-placeholders.cjs
 * （doc:render）都从这里取同一份 FACTS —— 避免出现"第二事实"。
 * 人类可读映射见 docs/reference-facts.md，本文件 FACTS 与其 key 一一对应。
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

// 试点文档（被占位符校验/替换的文档集合）
const SCOPED_DOCS = [
  "docs/standards/launch-and-build.md",
  "docs/startup-hotreload.md",
  "docs/guide-non-developer.md",
];

function readJson(p) { return JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")); }
function readText(p) { return fs.readFileSync(path.join(ROOT, p), "utf8"); }
function exists(p) { return fs.existsSync(path.join(ROOT, p)); }
function splitHostPort(url) {
  const m = url.match(/\/\/([^:/]+):(\d+)/);
  if (!m) throw new Error(`无法从 URL 提取 host:port: ${url}`);
  return { host: m[1], port: Number(m[2]) };
}

// ---- 权威值提取（运行时从源码/配置动态读取） ----
function extractDevHostPort() {
  const conf = readJson("src-tauri/tauri.conf.json");
  const { host, port } = splitHostPort(conf.build.devUrl);
  // 端口演进：dev-launcher.ps1 现已从 .env 的 COMFYAPP_PORT 读取（默认 3000），
  // 仓库内唯一权威源是 tauri.conf.json 的 build.devUrl。交叉核对提交的
  // .env.example 里 COMFYAPP_PORT 是否与 devUrl 一致（.env 为本地可覆盖变体）。
  if (exists(".env.example")) {
    const m = readText(".env.example").match(/COMFYAPP_PORT\s*=\s*["']?([0-9]+)["']?/);
    if (m && Number(m[1]) !== port) {
      throw new Error(`端口权威源冲突：tauri.conf.json devUrl=${port} 但 .env.example COMFYAPP_PORT=${m[1]}`);
    }
  }
  return { host, port };
}
function extractFallbackPorts() {
  // fallback 端口由 dev-launcher.ps1 运行时基于 appPort 推导（\$scanPorts = appPort/+1/+2），
  // 源码无字面量可读；据其逻辑按主端口推导返回。见 scripts/dev-launcher.ps1 的 scanPorts。
  const { port: mainPort } = extractDevHostPort();
  return [mainPort + 1, mainPort + 2].map(String);
}
function extractLauncherExe() {
  const spec = readText("tools/start-tauri.spec");
  const m = spec.match(/os\.environ\.get\(\s*['"]LAUNCHER_NAME['"]\s*,\s*['"]([^'"]+)['"]\s*\)/);
  return `${(m ? m[1] : "start-tauri")}.exe`;
}
function extractLauncherExeByName(ps1) {
  const t = readText(ps1);
  const m = t.match(/\$env:LAUNCHER_NAME\s*=\s*["']([^"']+)["']/);
  if (!m) throw new Error(`无法从 ${ps1} 提取 LAUNCHER_NAME`);
  return `${m[1]}.exe`;
}
function extractSplash() {
  const conf = readJson("src-tauri/tauri.conf.json");
  const win = conf.app.windows.find((w) => w.label === "splash") || conf.app.windows[0];
  return win.url;
}

// --------------------------------------------------------------------------
// FACTS：机器可读事实定义（与 docs/reference-facts.md 的 key 一一对应）
//   placeholder 类：文档用占位符替代裸值，doc:check 发现裸值即报错，
//                    doc:render 把占位符替换成真实值。
//   verify 类：文档保留直观值，doc:check 核对权威源当前端口族。
//   path 类：核对路径指向的文件存在。
// --------------------------------------------------------------------------
const FACTS = [
  // 占位符类：文档用占位符替代裸值
  { key: "shell.exe.prebuilt", placeholder: "{{shell.exe.prebuilt}}", kind: "placeholder", extract: extractLauncherExe },
  { key: "shell.exe.dev", placeholder: "{{shell.exe.dev}}", kind: "placeholder", extract: () => extractLauncherExeByName("tools/scripts/build-launcher-dev.ps1") },
  { key: "shell.exe.standalone", placeholder: "{{shell.exe.standalone}}", kind: "placeholder", extract: () => extractLauncherExeByName("tools/scripts/build-launcher-standalone.ps1") },
  { key: "shell.app.exe", placeholder: "{{shell.app.exe}}", kind: "placeholder", extract: () => "app.exe" },
  { key: "shell.splash", placeholder: "{{shell.splash}}", kind: "placeholder", extract: extractSplash },
  // 核对类：文档保留直观值，脚本核对权威源当前端口族
  { key: "dev.host", kind: "verify", extract: () => extractDevHostPort().host },
  { key: "dev.port", kind: "verify", extract: () => String(extractDevHostPort().port) },
  { key: "dev.port.fallback", kind: "verify", extract: extractFallbackPorts },
  // 路径类：核对文件存在
  { key: "path.tauri.conf", kind: "path", source: "src-tauri/tauri.conf.json" },
  { key: "path.lib.rs", kind: "path", source: "src-tauri/src/lib.rs" },
  { key: "path.dev-launcher", kind: "path", source: "scripts/dev-launcher.ps1" },
  { key: "path.start-launcher-py", kind: "path", source: "scripts/start_tauri_launcher.py" },
  { key: "path.spec", kind: "path", source: "tools/start-tauri.spec" },
  { key: "path.build-launcher", kind: "path", source: "tools/scripts/build-launcher.ps1" },
  { key: "path.build-desktop", kind: "path", source: "scripts/build-desktop.mjs" },
  { key: "path.rebuild-static", kind: "path", source: "tools/build/rebuild-static.ps1" },
  { key: "path.build-tauri-release", kind: "path", source: "tools/build/build-tauri-release.ps1" },
  { key: "path.nvmrc", kind: "path", source: ".nvmrc" },
];

// 生成文档输出目录（相对 ROOT）
const GENERATED_DOCS_DIR = "docs/generated";

module.exports = {
  ROOT,
  SCOPED_DOCS,
  FACTS,
  GENERATED_DOCS_DIR,
  readJson,
  readText,
  exists,
  extractDevHostPort,
  extractFallbackPorts,
  extractLauncherExe,
  extractLauncherExeByName,
  extractSplash,
};
