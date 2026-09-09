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
 * 用法：`pnpm doc:render`。生成后产物提交到 git，读者直接看 docs/generated/。
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
    let src = readText(docRel);
    src = stripPlaceholderNote(src);
    const resolved = resolvePlaceholders(src, map);
    const outRel = generatedPathFor(docRel);
    const outAbs = path.join(ROOT, outRel);
    fs.writeFileSync(outAbs, bannerFor(docRel) + resolved);
    console.log(`[doc:render] 生成 ${outRel}（源：${docRel}）`);
    generated++;
  }

  console.log(`[doc:render] ✓ 已生成 ${generated} 份原文文档到 ${GENERATED_DOCS_DIR}/。`);
}

main();
