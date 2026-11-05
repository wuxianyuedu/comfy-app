#!/usr/bin/env node
/**
 * doc-toc.mjs — 规范文档的**按节定位**入口（`pnpm doc:toc <文档> [关键词]`，ISSUE #2763）
 *
 * ── 它治的那一格 ────────────────────────────────────────────────────────
 *
 * 规范章节的体量已经到了「整篇读一遍」不现实、`grep` 猜词又容易读到半句就下结论的
 * 程度（13 章近百万字节 / 一万行，launch-and-build 七十万字节）。缺的不是搜索，
 * 而是「这一节在第几行到第几行」这一跳 —— 有了它，`Read(offset, limit)` 才能整节读，
 * 而不是把一份一万行的文档整个读进上下文。
 *
 * 所以本入口只回答一件事：**标题 → 行号**（可选关键词过滤），并给出可直接照抄的
 * `Read(offset=…, limit=…)` 区间。
 *
 * ── 输入面只有一份 ──────────────────────────────────────────────────────
 *
 * 认哪些文档 = `scripts/doc-facts.cjs` 的 `SCOPED_DOCS`（`doc:check` / `doc:render`
 * 的同一份清单）。**别在这里另立名单**：新增一章时漏改一处，本入口就会对着一份
 * 没人维护的副本答「没有这份文档」，而那个回答看起来像是「仓库里没有这一章」。
 *
 * ── 源与生成态镜像：行号不是同一个坐标系 ────────────────────────────────
 *
 * `docs/generated/**` 是 `doc:render` 的产物（占位符已被替换成原文），**行号与源不同**。
 * 默认读源；要看镜像（例如核对渲染结果）显式给 `--rendered`（或直接点名
 * `docs/generated/...`）—— 读数里会逐字写明「这里的行号属于哪一份」。这一格必须显式：
 * 两份文件同名、都在盘上，拿镜像的行号去 `Read` 源**不会报错**，只会读回另一个小节。
 *
 * ── 退出码 ──────────────────────────────────────────────────────────────
 *
 *   `0` = 读到了并打出了目录（关键词 0 命中也是 `0`：文档读到了，只是没有这一节）；
 *   `2` = **没读成**（认不出是哪份文档 / 前缀命中多份 / 文件不在盘上 / 旗标不认识）。
 * 「没读成」不是「没有这一节」——两者混成一档，下一步就会去改一份其实存在的章节。
 *
 * 本入口**只读**：不写盘、不建索引、不参与任何门禁（硬规则 27 的四条红线里
 * 「不另立第二套判定」在这里的落法是：目录只从文档正文的标题行现算，不读任何缓存）。
 *
 * ── 用法 ────────────────────────────────────────────────────────────────
 *
 *   pnpm doc:toc 13                    # 13 章的标题树 + 行号
 *   pnpm doc:toc 13 合并前             # 只列标题命中「合并前」的小节（带区间）
 *   pnpm doc:toc launch --rendered     # 生成态镜像（行号属于 docs/generated/**）
 *   pnpm doc:toc --list                # 可认的名字（= SCOPED_DOCS 的 basename）
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ROOT, SCOPED_DOCS, GENERATED_DOCS_DIR, generatedPathFor } = require("./doc-facts.cjs");

/**
 * 从 Markdown 正文里取标题行（跳过围栏代码块里的 `# 注释`）。
 *
 * 为什么必须跳过围栏：规范里大量 bash 示例的第一行就是 `# …`，不跳会把它们当成
 * 章节标题，于是「这一节到哪一行结束」算错、`Read(offset, limit)` 读回来的区间
 * 缺半截或多半截 —— 而读数本身看不出哪里错了。
 *
 * @param {string} text
 * @returns {Array<{level: number, title: string, line: number}>} 行号从 1 起
 */
export function parseHeadings(text) {
  const lines = String(text).split("\n");
  /** @type {Array<{level: number, title: string, line: number}>} */
  const out = [];
  /** @type {string | null} 当前围栏的标记（```` ``` ```` / `~~~`） */
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fenceMark = /^\s*(?<fenceMark>`{3,}|~{3,})/.exec(line)?.groups?.fenceMark;
    if (fenceMark !== undefined) {
      if (fence === null) {
        fence = fenceMark;
      } else if (fenceMark[0] === fence[0] && fenceMark.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence !== null) {
      continue;
    }
    /* 最多三个前导空格是 Markdown 对 ATX 标题的合法缩进；本仓规范把子小节写在
     * 列表项里（两个空格），少了这一段，`13.6.2.1` 这一层会整层消失 ——
     * 目录照样完整、只是少了几小节，而「少的那几节」恰好是最常被问到的细则。
     * 四个空格起是缩进代码块，按 Markdown 的定义不是标题。 */
    const m = /^ {0,3}(?<hashes>#{1,6})[ \t]+(?<title>.+?)[ \t]*$/.exec(line);
    if (!m) {
      continue;
    }
    const hashes = m.groups?.hashes ?? "";
    /* ATX 标题允许以 `#` 收尾（`## 标题 ##`），那些是装饰不是标题的一部分。 */
    const title = (m.groups?.title ?? "").replace(/[ \t]+#+[ \t]*$/, "").trim();
    if (title === "") {
      continue;
    }
    out.push({ level: hashes.length, title, line: i + 1 });
  }
  return out;
}

/**
 * 一个小节的区间：从自己的标题行，到下一个**同级或更高级**标题的前一行。
 *
 * 「同级或更高级」是 Markdown 结构的定义：子小节属于父小节，兄弟小节不属于。
 * 拿「下一个标题」当边界会让父小节只剩标题那一行 —— 用那个 `limit` 去 `Read`，
 * 读到的是目录，不是被问的那一节。
 *
 * @param {Array<{level: number, title: string, line: number}>} headings
 * @param {number} index
 * @param {number} totalLines
 * @returns {{start: number, end: number, limit: number}}
 */
export function sectionRange(headings, index, totalLines) {
  const h = headings[index];
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- headings 下标在 noUncheckedIndexedAccess 下可 undefined，这处守卫真的走得到
  if (h === undefined) {
    return { start: 1, end: 0, limit: 0 };
  }
  let end = totalLines;
  for (let j = index + 1; j < headings.length; j++) {
    const next = headings[j];
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- headings 下标在 noUncheckedIndexedAccess 下可 undefined，这处守卫真的走得到
    if (next !== undefined && next.level <= h.level) {
      end = next.line - 1;
      break;
    }
  }
  return { start: h.line, end, limit: Math.max(1, end - h.line + 1) };
}

/**
 * 把用户给的名字解析成 `SCOPED_DOCS` 里的一条。
 *
 * 接受的形态（优先级从上到下）：完整仓库路径 → 镜像路径 → basename 全等 →
 * basename 唯一前缀（`13` / `launch`）。**前缀命中多份时退 2 并列出候选**，
 * 不替人挑一份：挑错的那一份也有标题树、也带行号，看起来就像证据。
 *
 * @param {string} name
 * @returns {{ok: true, src: string, rendered: boolean} | {ok: false, reason: string, candidates?: string[]}}
 */
export function resolveDoc(name) {
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- name 是人给的命令行参数，类型按 string 标窄
  const raw = String(name ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//, "");
  if (raw === "") {
    return { ok: false, reason: "缺少文档名（例：`pnpm doc:toc 13`）" };
  }
  const bare = raw.replace(/\.md$/i, "");
  const docs = SCOPED_DOCS.map((/** @type {string} */ src) => ({
    src,
    key: path.basename(src, ".md"),
  }));

  const asSource = docs.find((d) => d.src.replace(/\.md$/i, "") === bare);
  if (asSource) {
    return { ok: true, src: asSource.src, rendered: false };
  }

  const asMirror = docs.find(
    (d) => generatedPathFor(d.src).replaceAll("\\", "/").replace(/\.md$/i, "") === bare,
  );
  if (asMirror) {
    return { ok: true, src: asMirror.src, rendered: true };
  }

  const flat = bare.split("/").pop() ?? bare;
  const exact = docs.filter((d) => d.key === flat);
  if (exact.length === 1 && exact[0]) {
    return { ok: true, src: exact[0].src, rendered: false };
  }
  const prefixed = docs.filter((d) => d.key.startsWith(flat));
  if (prefixed.length === 1 && prefixed[0]) {
    return { ok: true, src: prefixed[0].src, rendered: false };
  }
  if (prefixed.length > 1) {
    return {
      ok: false,
      reason: `「${name}」命中 ${prefixed.length} 份文档，入口不替你挑一份`,
      candidates: prefixed.map((d) => d.key),
    };
  }
  return {
    ok: false,
    reason: `「${name}」不在 SCOPED_DOCS 里（本入口只认登记过的文档）`,
  };
}

/**
 * 打印一份目录（或关键词过滤后的命中清单）。
 *
 * @param {object} input
 * @param {string} input.rel 实际读的那份（源或镜像）
 * @param {boolean} input.rendered
 * @param {Array<{level: number, title: string, line: number}>} input.headings
 * @param {number} input.totalLines
 * @param {string} input.keyword
 * @returns {void}
 */
function printOutline({ rel, rendered, headings, totalLines, keyword }) {
  const kind = rendered ? "生成态镜像" : "源";
  process.stdout.write(
    `[doc:toc] 文档：${rel}（${kind}） · ${totalLines} 行 · ${headings.length} 个标题\n`,
  );
  if (rendered) {
    process.stdout.write(
      "[doc:toc] ⚠ 下面的行号属于**生成态镜像**（docs/generated/**，与源文档的行号不同）；" +
        "拿它去 Read 源会读到别的小节。要看源的行号就去掉 --rendered。\n",
    );
  }

  if (keyword === "") {
    for (const h of headings) {
      const indent = "  ".repeat(h.level - 1);
      process.stdout.write(
        `${String(h.line).padStart(6)}  ${indent}${"#".repeat(h.level)} ${h.title}\n`,
      );
    }
    return;
  }

  const needle = keyword.toLowerCase();
  const hits = headings
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h.title.toLowerCase().includes(needle));
  if (hits.length === 0) {
    process.stdout.write(
      `[doc:toc] 关键词「${keyword}」在 ${headings.length} 个标题里 0 命中` +
        "（文档读到了，只是没有这一节）\n",
    );
    return;
  }
  process.stdout.write(
    `[doc:toc] 关键词「${keyword}」命中 ${hits.length} 个小节（共 ${headings.length} 个标题）：\n`,
  );
  for (const { h, i } of hits) {
    const r = sectionRange(headings, i, totalLines);
    process.stdout.write(
      `${String(h.line).padStart(6)}  ${"#".repeat(h.level)} ${h.title}\n` +
        `        @ ${r.start}–${r.end}（${r.limit} 行） → Read(${rel}, offset=${r.start}, limit=${r.limit})\n`,
    );
  }
}

/**
 * @param {string[]} argv
 * @returns {number} 退出码
 */
function main(argv) {
  const flags = new Set(["--rendered", "--mirror", "--list"]);
  const unknown = argv.filter((a) => a.startsWith("--") && !flags.has(a));
  if (unknown.length > 0) {
    process.stderr.write(
      `[doc:toc] 不认识的参数：${unknown.join(" / ")} —— 本入口认 ` +
        "--rendered / --mirror / --list，以及 `<文档> [关键词]`（退 2 = 没读成）\n",
    );
    return 2;
  }
  if (argv.includes("--list")) {
    process.stdout.write(
      `[doc:toc] 可认的文档（SCOPED_DOCS，共 ${SCOPED_DOCS.length} 份；前缀唯一时只写前几位也行）：\n`,
    );
    for (const src of SCOPED_DOCS) {
      process.stdout.write(`  ${path.basename(src, ".md")}  ${src}\n`);
    }
    return 0;
  }

  const positional = argv.filter((a) => !a.startsWith("--"));
  const docArg = positional[0] ?? "";
  const keyword = positional.slice(1).join(" ").trim();
  if (docArg === "") {
    process.stderr.write(
      "[doc:toc] 缺文档名 —— 例：`pnpm doc:toc 13` / `pnpm doc:toc 13 合并前`；" +
        "`pnpm doc:toc --list` 看可认的名字\n",
    );
    return 2;
  }

  const resolved = resolveDoc(docArg);
  if (!resolved.ok) {
    process.stderr.write(`[doc:toc] ${resolved.reason}\n`);
    if (resolved.candidates) {
      for (const c of resolved.candidates) {
        process.stderr.write(`[doc:toc]   · ${c}\n`);
      }
    } else {
      process.stderr.write(
        "[doc:toc] `pnpm doc:toc --list` 列出可认的文档（= scripts/doc-facts.cjs 的 SCOPED_DOCS）\n",
      );
    }
    return 2;
  }

  const wantRendered =
    resolved.rendered || argv.includes("--rendered") || argv.includes("--mirror");
  /* 输出与 `Read` 参数一律用正斜杠：`generatedPathFor` 走 `path.join`，Windows 上给的是
   * 反斜杠 —— 读数要能原样粘进 `Read(offset=…)` 的说明里，两套分隔符只会制造一次改写。 */
  const rel = (wantRendered ? generatedPathFor(resolved.src) : resolved.src).replaceAll("\\", "/");
  let text;
  try {
    text = fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    process.stderr.write(
      `[doc:toc] 读不到 ${rel} —— ${
        wantRendered
          ? `生成态镜像不在盘上（它不是入库产物），先 \`pnpm run doc:render -- --only ${resolved.src}\`\n`
          : "源文件不在盘上（SCOPED_DOCS 与实际树漂了）\n"
      }`,
    );
    return 2;
  }

  const headings = parseHeadings(text);
  printOutline({
    rel,
    rendered: wantRendered || rel.startsWith(`${GENERATED_DOCS_DIR}/`),
    headings,
    totalLines: text.split("\n").length,
    keyword,
  });
  return 0;
}

/* 只在被直接执行时跑 main（被 import 时只暴露纯函数给用例）。 */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(main(process.argv.slice(2)));
}
