#!/usr/bin/env node
// @ts-nocheck
/**
 * check-doc-references.cjs — 文档引用一致性校验（pnpm doc:check）
 *
 * 解决 ISSUE #242「文档里的硬编码值/路径与代码脱钩，改动易遗漏」。
 * 核心思路（单一事实）：真实值只存在于源码/配置，本脚本运行时从权威源动态提取，
 * 再与文档比对。不依赖任何"手工登记值"。
 *
 * 校验模式：
 *   - kind 'placeholder'（文件名值，如 exe 名 / splash）：文档应使用占位符替代裸值；
 *     若文档出现裸值 → 报错引导改用占位符（防回潮）。占位符语义可读（见登记表 meaning）。
 *   - kind 'verify'（端口/地址）：文档保留直观原样（如 localhost:3000，可读性最佳），
 *     脚本提取文档里出现的 `host:port` 形态，与权威源当前端口族比对；不一致 → 报错。
 *   - kind 'path'：文档保留路径原文，脚本核对路径指向的文件确实存在。
 *
 * 接入方式：`pnpm doc:check` 手动命令，不接 pre-commit（避免过度打扰提交）。
 * 人类可读映射见 docs/reference-facts.md；本文件 FACTS 与其 key 一一对应。
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

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
  const launcher = readText("scripts/dev-launcher.ps1");
  const pMatch = launcher.match(/-p\s+(\d+)/);
  const launcherPort = pMatch ? Number(pMatch[1]) : null;
  if (launcherPort !== port) {
    throw new Error(`端口权威源冲突：tauri.conf.json devUrl=${port} 但 dev-launcher.ps1 -p=${launcherPort}`);
  }
  return { host, port };
}
function extractFallbackPorts() {
  const launcher = readText("scripts/dev-launcher.ps1");
  const m = launcher.match(/foreach \(\$port in @\(([^)]+)\)\)/);
  if (!m) throw new Error("无法从 dev-launcher.ps1 提取端口清理列表");
  const { port: mainPort } = extractDevHostPort();
  return m[1].split(",").map((s) => Number(s.trim()))
    .filter((n) => !Number.isNaN(n) && n > 0 && n !== mainPort).map(String);
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

const problems = [];

function checkFactKeysMatchDocs() {
  if (!exists("docs/reference-facts.md")) { problems.push("缺少 docs/reference-facts.md 登记表"); return; }
  const md = readText("docs/reference-facts.md");
  for (const f of FACTS) if (!md.includes(f.key)) problems.push(`登记表缺少事实 key：${f.key}`);
  const mdKeys = [...md.matchAll(/\| `([a-z][a-z0-9_.]+)` \|/g)].map((m) => m[1]);
  for (const k of mdKeys) if (!FACTS.some((f) => f.key === k)) problems.push(`登记表有多余/脚本未支持 key：${k}`);
}

function bareValueOccurs(text, value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w.-])${escaped}(?![\\w.-])`, "g").test(text);
}

function extractDocHostPorts(text) {
  const ports = new Set();
  const re = /(?:localhost|127\.0\.0\.1):(\d+)/g;
  let m;
  while ((m = re.exec(text))) ports.add(Number(m[1]));
  return [...ports];
}

function checkVerify(text, docPath, f) {
  const kind = f.key;
  try {
    if (kind === "dev.host") return; // host 双形态等价
    if (kind === "dev.port" || kind === "dev.port.fallback") {
      const { port } = extractDevHostPort();
      const candidates = extractFallbackPorts().map(Number);
      const allowed = new Set([port, ...candidates]);
      const docPorts = extractDocHostPorts(text);
      if (!docPorts.length) return;
      const hasDevFam = docPorts.some((p) => allowed.has(p));
      if (hasDevFam && !docPorts.includes(port)) {
        problems.push(
          `[${docPath}] 文档 dev 地址端口 ${docPorts.filter((p) => allowed.has(p)).join(" / ")} 未包含权威主端口 ${port}。请核对端口是否变更。`
        );
      }
    }
  } catch (e) {
    problems.push(`[${docPath}] 无法核对 ${f.key}（${e.message}）`);
  }
}

function checkDoc(docPath) {
  if (!exists(docPath)) { problems.push(`试点文档不存在：${docPath}`); return; }
  const text = readText(docPath);
  for (const f of FACTS) {
    if (f.kind === "placeholder") {
      let realValue;
      try { realValue = f.extract(); } catch (e) { problems.push(`[${docPath}] 无法提取 ${f.key}（${e.message}）`); continue; }
      const vals = Array.isArray(realValue) ? realValue : [realValue];
      for (const rv of vals) {
        if (!rv) continue;
        if (bareValueOccurs(text, rv)) {
          problems.push(`[${docPath}] 发现裸值 "${rv}"（对应 ${f.key}，应改用占位符 ${f.placeholder}）。见 docs/reference-facts.md。`);
        }
      }
    } else if (f.kind === "verify") {
      checkVerify(text, docPath, f);
    }
  }
}

function checkPaths() {
  for (const f of FACTS) {
    if (f.kind === "path" && !exists(f.source)) {
      problems.push(`路径引用失效：${f.source}（key ${f.key}）。请核对登记表`);
    }
  }
}

function main() {
  checkFactKeysMatchDocs();
  checkPaths();
  for (const doc of SCOPED_DOCS) checkDoc(doc);

  if (problems.length > 0) {
    console.error("\n[doc:check] 发现文档引用一致性问题：\n");
    for (const p of problems) console.error("  ✗ " + p);
    console.error(`\n共 ${problems.length} 项。请对照 docs/reference-facts.md 更新文档。`);
    process.exit(1);
  }
  console.log("[doc:check] ✓ 文档引用与权威源一致。");
}

main();
