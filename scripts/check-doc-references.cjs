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
 *   - kind 'verify'（端口/地址）：文档保留直观原样（如 localhost:3100，可读性最佳），
 *     脚本提取文档里出现的 `host:port` 形态，与权威源当前端口族比对；不一致 → 报错。
 *   - kind 'path'：文档保留路径原文，脚本核对路径指向的文件确实存在。
 *   - 台账命令口径：SCOPED_DOCS 里不得出现 npm run / npx 可执行命令
 *     （AGENTS 硬规则 1「只用 pnpm」；说明性引用需带纠正词，见 checkLedgerCommands）。
 *
 * 接入方式：`pnpm doc:check` 手动命令，不接 pre-commit（避免过度打扰提交）。
 * 人类可读映射见 docs/reference-facts.md；FACTS 与提取逻辑见 scripts/doc-facts.cjs
 * （本脚本与 doc:render 共用，避免第二事实）。
 */
const fs = require("node:fs");
const path = require("node:path");
const {
  ROOT,
  SCOPED_DOCS,
  SCOPED_DOC_DIRS,
  SCOPED_DOC_EXEMPTIONS,
  FACTS,
  readText,
  exists,
  extractDevHostPort,
  extractFallbackPorts,
} = require("./doc-facts.cjs");

const problems = [];

function checkFactKeysMatchDocs() {
  if (!exists("docs/reference-facts.md")) { problems.push("缺少 docs/reference-facts.md 登记表"); return; }
  const md = readText("docs/reference-facts.md");
  for (const f of FACTS) if (!md.includes(f.key)) problems.push(`登记表缺少事实 key：${f.key}`);
  const mdKeys = [...md.matchAll(/\| `([a-z][a-z0-9_.]+)` \|/g)].map((m) => m[1]);
  for (const k of mdKeys) if (!FACTS.some((f) => f.key === k)) problems.push(`登记表有多余/脚本未支持 key：${k}`);
}

/* ── 校验范围守卫（ISSUE #316）─────────────────────────────────────────
 * 目的：让「新增规范文档忘了登记 → 静默不校验」这件事变成硬错误。
 *
 * 判定：遍历 SCOPED_DOC_DIRS 下的每个 .md，
 *   - 在 SCOPED_DOCS 里 → 正常校验；
 *   - 在 SCOPED_DOC_EXEMPTIONS 里 → 跳过（但必须附了理由）；
 *   - 两者都不在 → 报错，提示「登记进 SCOPED_DOCS」或「写进豁免名单并附理由」。
 * 同时校验豁免名单本身：理由为空、或指向不存在的文件 → 也算问题（防止名单
 * 变成张贴过期条目的垃圾桶）。
 */
function checkScopeCoverage() {
  const scoped = new Set(SCOPED_DOCS);
  for (const dir of SCOPED_DOC_DIRS) {
    const absDir = path.join(ROOT, dir);
    if (!fs.existsSync(absDir)) {
      problems.push(`校验范围守卫：目录不存在 ${dir}（SCOPED_DOC_DIRS 需与仓库结构一致）`);
      continue;
    }
    const walk = (abs) => {
      for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const full = path.join(abs, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".md")) continue;
        const rel = path.relative(ROOT, full).split(path.sep).join("/");
        if (scoped.has(rel) || rel in SCOPED_DOC_EXEMPTIONS) continue;
        problems.push(
          `校验范围守卫：${rel} 既未登记进 SCOPED_DOCS、也不在豁免名单里——` +
            `新增规范文档必须二选一（登记则参与校验；豁免则须在 scripts/doc-facts.cjs 的 ` +
            `SCOPED_DOC_EXEMPTIONS 里写明理由），不允许静默跳过。见 docs/reference-facts.md §3。`
        );
      }
    };
    walk(absDir);
  }
  for (const [rel, reason] of Object.entries(SCOPED_DOC_EXEMPTIONS)) {
    if (!reason || !reason.trim()) {
      problems.push(`校验范围守卫：豁免名单条目 ${rel} 没有写理由（豁免必须可核验）`);
    }
    if (!exists(rel)) {
      problems.push(`校验范围守卫：豁免名单条目 ${rel} 指向的文件不存在——过期条目应删除`);
    }
  }
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
    if (kind === "dev.port.derived") {
      // 解析链（`pnpm dev` / `pnpm start`：.env → 检出路径推导 → 兜底 3100）的端口。
      // 描述 pnpm dev 语境的文档必须写**本检出真实推导值**，写静态 devUrl 值（兜底
      // 3100）会让人照着打开一个没人监听的端口 = ERR_CONNECTION_REFUSED（ISSUE #489）。
      const derivedPort = String(f.extract());
      const docPorts = extractDocHostPorts(text);
      if (!docPorts.length) return; // 本文档没写具体地址，跳过
      if (!docPorts.map(String).includes(derivedPort)) {
        problems.push(
          `[${docPath}] 文档 dev 地址端口 ${docPorts.join(" / ")} 未包含本检出按路径推导的端口 ${derivedPort}` +
            `（pnpm dev / pnpm start 的实际监听端口，见 scripts/app-port.mjs）。` +
            `照文档地址打开会 ERR_CONNECTION_REFUSED；请改为 ${derivedPort} 或写成「解析值」而非固定数字。`
        );
      }
      return;
    }
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

/* ── 台账命令口径守卫（AGENTS 硬规则 1 / §8.4 事实性漂移专项）──────────
 * 目的：让「台账里写着 npm run / npx，而项目只用 pnpm」这件事变成硬错误。
 *
 * 为什么单列一条：AGENTS 硬规则 1「包管理只用 pnpm，禁止 npx / npm run」，
 * 但文档里的命令不会编译、不会报错，只会静静过期——复核时就得靠人肉逐行读。
 * 台账（guides/ 下的清单/指南类文档）被反复引用为「怎么做」的依据，
 * 过期命令会直接误导执行者（历史上 PRODUCTION-GAPS.md 就写过 npm run test:e2e）。
 *
 * 豁免：允许**描述性引用**——即明确写出「原记录写作 npm 形式」「一律改为 pnpm」
 * 这类说明当前规则的上下文。判据：该行同时出现纠正词（改为/修正/pnpm/禁止/违反）
 * 即视为说明而非可执行命令。
 */
const NPM_CMD_RE = /(^|[\s`(（])(npm\s+run|npx)\b/;
const NPM_CMD_EXPLAIN_RE = /改为|修正|修正为|pnpm|禁止|违反|原记录|不要用|应使用/;

function checkLedgerCommands() {
  for (const doc of SCOPED_DOCS) {
    if (!exists(doc)) continue;
    const lines = readText(doc).split("\n");
    lines.forEach((line, i) => {
      if (!NPM_CMD_RE.test(line)) return;
      if (NPM_CMD_EXPLAIN_RE.test(line)) return; // 说明性引用，放行
      problems.push(
        `[${doc}:${i + 1}] 出现 npm/npx 命令（AGENTS 硬规则 1「包管理只用 pnpm」）。` +
          `请改为 pnpm（如 npm run test → pnpm test）；若是在描述该规则本身，` +
          `补上「改为/修正/pnpm」等纠正词以标明是说明而非可执行命令。`
      );
    });
  }
}

function shouldApplyFactToDoc(f, docPath) {
  // onlyDocs：事实的主适用文档组（未命中即跳过）；otherDocs：额外适用文档，
  // 与主文档组取并集（同一值在另一篇文档里以别的形态出现时用，见 doc-facts.cjs）。
  if (f.onlyDocs && !f.onlyDocs.includes(docPath) && !(f.otherDocs || []).includes(docPath)) return false;
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
  checkScopeCoverage();
  checkLedgerCommands();
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
