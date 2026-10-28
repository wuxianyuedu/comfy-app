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
 * 用法（三种档，都共用 `renderDocContent()` 这一份「源 → 生成物」计算）：
 *
 *   · `pnpm doc:render`（写入）—— 人的动作，写完照常一并提交；
 *   · `--check`（只比对不写入）—— **平台侧 `.cnb.yml` 的「生成态文档与源同步」**在用
 *     （ISSUE #1975 起；此前挂在 `.githooks/pre-commit` 的 D 组）；
 *   · `--check --autofix` —— 同一份判定，但**红了就地重渲染、再判一次**（ISSUE #1981）。
 *     平台侧跑这一档：红了才多花一次重渲染的钱，而省掉的是「一整轮流水线 + 一个人的
 *     手工动作」。为什么不自己提交、以及这一档凭什么可以自动修，见
 *     `scripts/ci-autofix-duties.mjs` 的文件头（登记表 + 两条前提）。
 *
 * 判据存在的理由：生成态是**提交进 git** 的原文文档，改编辑态却忘了重渲染时，读者看到
 * 的就是过期原文（实测：5 份生成物落后于源、缺整节内容）。判据与写入模式共用
 * `renderDocContent()`，不另写一套比对逻辑。
 * 注意：`docs/generated/**` 是自动生成产物，改编辑文档后重新运行本命令即可；请勿手改产物。
 */
const fs = require("node:fs");
const path = require("node:path");
const docFacts = require("./doc-facts.cjs");

/* 夹具注入（tests/check-doc-references.test.ts 的 autofix 组在用，ISSUE #2415）：
 * 设了 DOC_RENDER_ROOT 时，源文档与生成态目录都落在那个临时夹具仓库里，
 * SCOPED_DOCS 取 DOC_RENDER_SCOPED（逗号分隔）给的子集 —— 用例由此一次也不写
 * 真仓库的入库文件。没设环境变量时行为与从前逐字相同（取 doc-facts 的全量）。
 * FACTS 仍来自真仓库：占位符提取只**读**配置，不会往夹具外的任何地方写。 */
const ENV_ROOT = process.env.DOC_RENDER_ROOT;
const ROOT = ENV_ROOT || docFacts.ROOT;
const SCOPED_DOCS = ENV_ROOT
  ? (process.env.DOC_RENDER_SCOPED ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : docFacts.SCOPED_DOCS;
const FACTS = docFacts.FACTS;
const GENERATED_DOCS_DIR = docFacts.GENERATED_DOCS_DIR;
const generatedPathFor = docFacts.generatedPathFor;
const readText = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

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
    "\n",
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
      throw new Error(`无法提取 ${f.key}（${e.message}）`, { cause: e });
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

/* 映射只有一处：`doc-facts.cjs` 的 `generatedPathFor`（「源 → 生成态镜像」这条规则
 * 同时被 `check-doc-mirror-pairing.cjs` 用来判「改了源有没有同批带上镜像」——
 * 两边各写一遍就会在「两份源映射到同一个产物名」那类形状上分叉）。 */

/** 一份原文文档的内容（写入模式与 `--check` 共用：判据与实现读同一份「源 → 生成物」计算）。 */
function renderDocContent(docRel, map) {
  return (
    bannerFor(docRel) +
    resolvePlaceholders(stripPlaceholderNote(readText(docRel)), map)
  );
}

/** 换行先归一到 LF 再比对：这条判据问的是「内容是否一致」，行尾由 .gitattributes 与 §13.7 管。 */
function normalizeEol(text) {
  return text.replace(/\r\n/g, "\n");
}

/**
 * 写入模式：把每一份编辑态文档渲染进 `docs/generated/`。返回生成的文件数。
 *
 * `--autofix` 复用的正是它（判定红之后的修复动作 = 跑一遍写入模式）——
 * 「修法」与「写入模式」由同一份实现承担，不另写一条只会漂移的修复路径。
 */
function writeAll() {
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

  console.log(
    `[doc:render] ✓ 已生成 ${generated} 份原文文档到 ${GENERATED_DOCS_DIR}/。`,
  );
  return generated;
}

/**
 * 只比对不写入：生成态是否等于「当前源 + 当前占位符事实」渲染出来的内容。
 *
 * 三个方向都要报，否则漏掉的那一类会静默留在产物目录里：
 *   · 落后 —— 源改了没重渲染（实测 5 份缺整节内容，读者看的是生成物）；
 *   · 缺失 —— 源在 SCOPED_DOCS 里但生成物不在（如新登记文档忘了生成）；
 *   · 多余 —— 生成物在但源已不在 SCOPED_DOCS（源删了/改名了）。
 */
function runCheck() {
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

  /* 报告稿先拼一遍再落两处（stdout 与 autofix 的判据共用）：`--autofix` 要靠**同一个
   * 数组**回答「到底缺哪种不一致」，各自拼一份就是让两处迟早漂开。 */
  const report = [];
  if (drifted.length || missing.length || orphans.length) {
    report.push("✗ 生成态文档与源不一致：");
    for (const d of drifted)
      report.push(`  · ${d.outRel} 落后于源 ${d.docRel}`);
    for (const m of missing)
      report.push(`  · ${m.outRel} 缺失（源仍在 SCOPED_DOCS 里）`);
    for (const o of orphans)
      report.push(`  · ${o} 多余（对应源已不在 SCOPED_DOCS）`);
    report.push(
      "修法：pnpm doc:render 后把重渲染结果一并提交（不要手改生成物）。",
    );
  }
  if (!report.length) {
    console.log(`${tag} ✓ 生成态文档与源一致（${expected.size} 份）。`);
    return { ok: true, drifted, missing, orphans };
  }
  for (const line of report) console.error(`${tag} ${line}`);
  return { ok: false, drifted, missing, orphans, report };
}

/**
 * `--check --autofix`：**先判一次，红了就地重渲染，再判一次**（ISSUE #1981）。
 *
 * 为什么第二次判定不能省：自动修的价值全在「修完真的对了」这一句上。只跑一遍写入模式
 * 就退 0，等于把一次未经复核的写入报成「通过」—— 而写入模式本身不判任何东西
 * （它只写）。所以这一档的结论**永远来自 `runCheck()`**，写入只是它中间那一步。
 *
 * ⚠️ **它不改动 git**：提交与重跑 CI 仍由人 / 代理那一侧做（平台侧能否回写分支是另一条
 * 决策，见 `scripts/ci-autofix-duties.mjs` 头注第 1 条）。失败时把「照抄就能用」的命令
 * 打出来，别让人从零拼。
 */
function checkOrAutofix() {
  const tag = "[doc:render --autofix]";
  const first = runCheck();
  if (first.ok) return true;
  /* 判据红过一次，先把「第一遍红了什么」**再打一遍到 stdout**：这一档的读者最需要的是
   * 「本次自动修改动了哪几份」—— 少了这几行，日志里只剩一句「重新生成了 N 份」，
   * 看不出改了什么（而「改了什么」正是让下一个人决定要不要接受这次自动修的依据）。 */
  console.log(
    `${tag} 上面那份不一致 —— 就地重渲染一遍，再判一次。第一遍的读数：`,
  );
  for (const line of first.report ?? []) console.log(`${tag}   ${line}`);
  const generated = writeAll();
  console.log(`${tag} 重渲染 ${generated} 份，重新比对：`);
  const after = runCheck();
  if (after.ok) {
    console.log(
      `${tag} ✓ 自动修完成。工作区里的 ${GENERATED_DOCS_DIR}/ 已经与源同步，` +
        `把它一并提交即可（不要手改生成物）。`,
    );
    return true;
  }
  /* 「修不好」的两种成因要分开说，因为下一个动作不同：
   *   · **多余 / 缺失** —— 写入模式既不会删孤儿、也不会替一棵不存在的源生成产物。
   *     这不是「忘了重渲染」，重试同一件事没有任何用（`多余` 要靠删产物 + 从
   *     `SCOPED_DOCS` 摘源，`缺失` 要先确认源文件在不在）。
   *   · **落后** —— 重渲染过还是不一样，说明产物那一侧不是由这次渲染决定的
   *     （手改过 / 两份源映射到同一个产物名），同样不该重试。 */
  const kinds = [];
  if (after.drifted.length) kinds.push("落后");
  if (after.missing.length) kinds.push("缺失");
  if (after.orphans.length) kinds.push("多余");
  console.error(
    `${tag} ✗ 重渲染之后仍不一致（${kinds.join(" / ")}）—— 这不是「忘了重渲染」，` +
      `别再重试同一件事。\n` +
      `${tag}   重渲染只写「源 → 产物」这一条路：孤儿产物要手工删、缺失要先确认源文件在不在、` +
      `产物被手改过则要回源重新生成。`,
  );
  return false;
}

const ARGS = new Set(process.argv.slice(2));
const AUTOFIX = ARGS.has("--autofix");

if (ARGS.has("--check")) {
  const ok = AUTOFIX ? checkOrAutofix() : runCheck().ok;
  if (!ok) process.exit(1);
} else {
  writeAll();
}
