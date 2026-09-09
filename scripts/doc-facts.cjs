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

// 纳入「单一事实引用校验」的文档集合（编辑态用占位符/核对，生成态 doc:render 出原文）。
// 试点：启动链路类 3 篇。扩展：纳入含值类引用的其余文档。
const SCOPED_DOCS = [
  "docs/standards/launch-and-build.md",
  "docs/startup-hotreload.md",
  "docs/guide-non-developer.md",
  "docs/standards/Comfy-APP-T3-项目开发规范.md",
  "docs/standards/16-shadcn-ui与表单校验.md",
  "docs/workshop-mcp.md",
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

// ---- 扩展：项目自身"值类"端口（独立单值，非 dev 端口族） ----
function extractRegistryPort() {
  // shadcn 团队 Registry 服务端口，权威源 tools/scripts/start-registry.ps1 的 $Port = <n>。
  const t = readText("tools/scripts/start-registry.ps1");
  const m = t.match(/\$Port\s*=\s*(\d+)/);
  if (!m) throw new Error("无法从 tools/scripts/start-registry.ps1 提取 Port");
  return m[1];
}
function extractMcpHttpPort() {
  // Workshop MCP HTTP 服务端口，权威源 tools/mcp-http.ts 的 MCP_HTTP_PORT ?? 3001。
  const t = readText("tools/mcp-http.ts");
  const m = t.match(/MCP_HTTP_PORT\s*\?\?\s*(\d+)/);
  if (!m) throw new Error("无法从 tools/mcp-http.ts 提取 MCP_HTTP_PORT 默认值");
  return m[1];
}
function extractComfyUIPort() {
  // ComfyUI 默认监听端口，权威源 src/lib/comfyui/client.ts 的
  // `settings.comfyuiPort ... ? settings.comfyuiPort : 8188` 默认分支。
  const t = readText("src/lib/comfyui/client.ts");
  const m = t.match(/settings\.comfyuiPort\s*&&\s*settings\.comfyuiPort\s*>\s*0\s*\?\s*settings\.comfyuiPort\s*:\s*(\d+)/);
  if (!m) throw new Error("无法从 src/lib/comfyui/client.ts 提取 ComfyUI 默认端口");
  return m[1];
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
  // dev 端口族仅对描述 dev 启动链路的文档校验；workshop-mcp.md 的 3001 是 MCP HTTP
  // 端口（非 dev 回落），若参与 verify 会误判「缺 dev 主端口 3000」，故排除该文档。
  { key: "dev.port", kind: "verify", extract: () => String(extractDevHostPort().port), excludeDocs: ["docs/workshop-mcp.md"] },
  { key: "dev.port.fallback", kind: "verify", extract: extractFallbackPorts, excludeDocs: ["docs/workshop-mcp.md"] },
  // 独立单值端口（非 dev 端口族）。此前 MCP 3001 因与 dev 回落端口同号而被排除
  // （占位符/verify 无法区分语义）；现按「独立单值 + 仅限特定文档上下文」纳入，
  // 用占位符替代裸值，规避与 dev 端口族的同号误报（占位符不匹配 host:port 裸值）。
  { key: "registry.port", placeholder: "{{registry.port}}", kind: "placeholder", extract: extractRegistryPort },
  // MCP / ComfyUI 端口是「独立单值」，但其裸值与 dev 回落端口（3001）或 ComfyUI 生态端口
  // （8188）同名，若作为全局 placeholder 会在其它文档（dev 回落 3001、生态 8188）误报。
  // 故用 onlyDocs 限定——仅在校验 workshop-mcp.md 时生效，避免跨文档误判。
  { key: "mcp.http.port", placeholder: "{{mcp.http.port}}", kind: "placeholder", extract: extractMcpHttpPort, onlyDocs: ["docs/workshop-mcp.md"] },
  { key: "comfyui.port", placeholder: "{{comfyui.port}}", kind: "placeholder", extract: extractComfyUIPort, onlyDocs: ["docs/workshop-mcp.md"] },
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
  extractRegistryPort,
};
