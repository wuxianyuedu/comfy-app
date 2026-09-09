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
 * 人类可读映射见 docs/reference-facts.md；FACTS 与提取逻辑见 scripts/doc-facts.cjs
 * （本脚本与 doc:render 共用，避免第二事实）。
 */
const { SCOPED_DOCS, FACTS, readText, exists, extractDevHostPort, extractFallbackPorts } = require("./doc-facts.cjs");

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
    if (kind === "mcp.http.port") {
      // 仅当文档确实出现了 MCP 端口时才核对一致性；MCP 与 dev 端口族碰撞会
      // 让端口清理/监听检测把 MCP 误判成 dev server 实例——这是该 fact 的防回归点。
      const mcpPort = Number(f.extract());
      const docPorts = extractDocHostPorts(text);
      if (!docPorts.includes(mcpPort)) return; // 本文档未引用 MCP 端口，跳过
      const { port } = extractDevHostPort();
      const candidates = extractFallbackPorts().map(Number);
      const devFam = new Set([port, ...candidates]);
      if (devFam.has(mcpPort)) {
        problems.push(
          `[${docPath}] MCP HTTP 端口 ${mcpPort} 与 dev 端口族 ${[port, ...candidates].join("/")} 冲突，会将 MCP 监听误判成 dev server。请为 MCP 换独立端口。`
        );
      }
    }
  } catch (e) {
    problems.push(`[${docPath}] 无法核对 ${f.key}（${e.message}）`);
  }
}

function shouldApplyFactToDoc(f, docPath) {
  if (f.onlyDocs && !f.onlyDocs.includes(docPath)) return false;
  if (f.excludeDocs && f.excludeDocs.includes(docPath)) return false;
  return true;
}

function checkDoc(docPath) {
  if (!exists(docPath)) { problems.push(`试点文档不存在：${docPath}`); return; }
  const text = readText(docPath);
  for (const f of FACTS) {
    if (!shouldApplyFactToDoc(f, docPath)) continue; // 事实声明了适用文档范围，未命中则跳过
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
