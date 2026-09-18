#!/usr/bin/env node
// @ts-nocheck
/**
 * render-doc-placeholders.cjs — 生成「原文」文档（pnpm doc:render）
 *
 * 解决 ISSUE #242「文档占位符看不直观，需要看到具体数值」。
 * 与编辑文档的关系：
 *   - 编辑文档（如 docs/standards/launch-and-build.md）：用语义化占位符
 *     {{shell.exe.prebuilt}} 作为单一事实，配合 pnpm doc:check 防裸值回潮。
 *   - 生成文档（本脚本产物，输出到 docs/generated/）：把占位符替换成从源码/
 *     配置动态提取的**真实值**（如 start-tauri.exe），供直接阅读，无需理解占位符。
 *
 * 单一事实：真实值只存在于源码/配置（FACTS 提取，见 scripts/doc-facts.cjs），
 * 本脚本运行时动态提取并替换，不硬编码任何值。
 *
 * 用法：`pnpm doc:render`（写入）。`--check` 只比对不写入（pre-commit 第 26 步）：
 * 生成态是**提交进 git** 的原文文档，改编辑态却忘了重渲染时，读者看到的就是过期原文
 * （实测：5 份生成物落后于源、缺整节内容），因此需要一个判据。判据与写入模式共用
 * `renderDocContent()` 这一份「源 → 生成物」计算，不另写一套比对逻辑。
 * 注意：本文件为自动生成产物，改编辑文档后重新运行本命令即可；请勿手改产物。
 */
const fs = require("node:fs");
const path = require("node:path");
const {
  ROOT,
  SCOPED_DOCS,
  FACTS,
  GENERATED_DOCS_DIR,
  readText,
  exists,
} = require("./doc-facts.cjs");

// 生成文档顶部 banner：标注为自动生成 + 指向源文件
function bannerFor(docRel) {
  return `<!-- ⚠️ 本文件为自动生成产物（\`pnpm doc:render\`），请勿手改。
编辑态文档（单一事实 + 占位符）见：\`${docRel}\`。改动请回源文件，再重新生成。 -->

`;
}

// 移除编辑文档里特有的「占位符约定」引用块：生成文档已显示真实值，该段无意义。
// 匹配以 "> **占位符约定**：" 开头、到空行结束的连续引用行。
function stripPlaceholderNote(text) {
  return text.replace(
    /(?:\n)?> \*\*占位符约定\*\*：[^\n]*(?:\n> [^\n]*)*\n+(?=\n|> |#|$)/g,
    "\n"
  );
}

function buildPlaceholderMap() {
  const map = new Map(); // placeholder -> realValue
  for (const f of FACTS) {
    if (f.kind !== "placeholder" || !f.placeholder) continue;
    let realValue;
    try {
      realValue = f.extract();
    } catch (e) {
      throw new Error(`无法提取 ${f.key}（${e.message}）`);
    }
    const vals = Array.isArray(realValue) ? realValue : [realValue];
    for (const v of vals) {
      if (v) map.set(f.placeholder, v);
    }
  }
  return map;
}

function resolvePlaceholders(text, map) {
  let out = text;
  const sorted = [...map.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [placeholder, realValue] of sorted) {
    out = out.split(placeholder).join(realValue);
  }
  return out;
}

function generatedPathFor(docRel) {
  const base = path.basename(docRel);
  return path.join(GENERATED_DOCS_DIR, base);
}

/** 一份原文文档的内容（写入模式与 `--check` 共用：判据与实现读同一份「源 → 生成物」计算）。 */
function renderDocContent(docRel, map) {
  return (
    bannerFor(docRel) + resolvePlaceholders(stripPlaceholderNote(readText(docRel)), map)
  );
}

/** 换行先归一到 LF 再比对：这条判据问的是「内容是否一致」，行尾由 .gitattributes 与 §13.7 管。 */
function normalizeEol(text) {
  return text.replace(/\r\n/g, "\n");
}

function main() {
  const map = buildPlaceholderMap();
  if (!map.size) {
    console.error("[doc:render] 未找到任何占位符事实，无法生成。");
    process.exit(1);
  }

  const outDir = path.join(ROOT, GENERATED_DOCS_DIR);
  fs.mkdirSync(outDir, { recursive: true });

  let generated = 0;
  for (const docRel of SCOPED_DOCS) {
    if (!exists(docRel)) {
      console.warn(`[doc:render] 跳过不存在的编辑文档：${docRel}`);
      continue;
    }
    const outRel = generatedPathFor(docRel);
    fs.writeFileSync(path.join(ROOT, outRel), renderDocContent(docRel, map));
    console.log(`[doc:render] 生成 ${outRel}（源：${docRel}）`);
    generated++;
  }

  console.log(`[doc:render] ✓ 已生成 ${generated} 份原文文档到 ${GENERATED_DOCS_DIR}/。`);
}

/**
 * 只比对不写入：生成态是否等于「当前源 + 当前占位符事实」渲染出来的内容。
 *
 * 三个方向都要报，否则漏掉的那一类会静默留在产物目录里：
 *   · 落后 —— 源改了没重渲染（实测 5 份缺整节内容，读者看的是生成物）；
 *   · 缺失 —— 源在 SCOPED_DOCS 里但生成物不在（如新登记文档忘了生成）；
 *   · 多余 —— 生成物在但源已不在 SCOPED_DOCS（源删了/改名了）。
 */
function check() {
  const tag = "[doc:render --check]";
  const map = buildPlaceholderMap();
  if (!map.size) {
    console.error(`${tag} 未找到任何占位符事实，判据无法成立。`);
    process.exit(1);
  }

  const outDir = path.join(ROOT, GENERATED_DOCS_DIR);
  const drifted = [];
  const missing = [];
  const expected = new Set();

  for (const docRel of SCOPED_DOCS) {
    if (!exists(docRel)) continue; // 源不在了：交给下面的「多余生成物」报
    const outRel = generatedPathFor(docRel);
    expected.add(path.basename(outRel));
    const outAbs = path.join(ROOT, outRel);
    if (!fs.existsSync(outAbs)) {
      missing.push({ outRel, docRel });
      continue;
    }
    const want = normalizeEol(renderDocContent(docRel, map));
    const got = normalizeEol(fs.readFileSync(outAbs, "utf8"));
    if (got !== want) drifted.push({ outRel, docRel });
  }

  const orphans = fs.existsSync(outDir)
    ? fs
        .readdirSync(outDir)
        .filter((name) => name.endsWith(".md") && !expected.has(name))
        .map((name) => `${GENERATED_DOCS_DIR}/${name}`)
    : [];

  if (!drifted.length && !missing.length && !orphans.length) {
    console.log(`${tag} ✓ 生成态文档与源一致（${expected.size} 份）。`);
    return;
  }

  console.error(`${tag} ✗ 生成态文档与源不一致：`);
  for (const d of drifted) console.error(`  · ${d.outRel} 落后于源 ${d.docRel}`);
  for (const m of missing) console.error(`  · ${m.outRel} 缺失（源仍在 SCOPED_DOCS 里）`);
  for (const o of orphans) console.error(`  · ${o} 多余（对应源已不在 SCOPED_DOCS）`);
  console.error(`${tag} 修法：pnpm doc:render 后把重渲染结果一并提交（不要手改生成物）。`);
  process.exit(1);
}

if (process.argv.includes("--check")) {
  check();
} else {
  main();
}
