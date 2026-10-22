#!/usr/bin/env node
/**
 * CP936 字形归一化 —— 让「本来是符号」的字符在平台日志里不再显示成 `?`。
 *
 * ## 它补的是哪一格
 *
 * 平台抓取 stage 输出那一跳读的是**不与宿主设置联动的 CP936**，仓库侧的对策是
 * `scripts/ci-cp936-exit.mjs`：把子进程的 UTF-8 输出按 CP936 重发，平台按它解，
 * 于是中文可读（那个文件的头注记着整件事的判读过程与它踩过的坑）。
 *
 * 但 **CP936 不是 Unicode 全集** —— 它只有两万多个字形。**落在字表之外**的字符，
 * .NET 的编码器默认 fallback 会把它写成**一个问号**（单字节 `0x3F`）——
 * 于是那个符号在日志里变成 `?`，而它与「原文里本来就有的问号」**逐字同形**。
 *
 * ## 为什么这件事值得单独做一层
 *
 * 因为**被吃掉的往往不是装饰，是判决**：
 *
 *   · vitest 的**绿色通过标记**是 `✓`（U+2713）—— CP936 里没有 ⇒ 日志里「这一条过了」
 *     打印成一个问号，而**红色失败标记是 `×`，CP936 里有、活得好好的**。于是「绿」与「红」
 *     在日志上差着一个看不出所以然的问号；
 *   · 本仓文案里最常见的 `⇒`（U+21D2）同样没有字形，而 `→`（U+2192）有 ——
 *     同一句话里两个箭头**一个活一个死**，读的人只能猜哪个是哪个。
 *
 * ## 这一层做什么
 *
 * 把**不可编码**的字符换成**读得出来的等价写法**，再交给 CP936 转码：
 *
 *   · 有等义字形的（`✓` → `√`、`✗` → `×`、`⇒` → `→`）⇒ 换成那个字形，
 *     **视觉几乎不变**，而它们都在 CP936 里；
 *   · 零宽类（零宽空格 / 变体选择符 / BOM / 软连字符 / 零宽连接符）⇒ **删掉**
 *     （它们本来就不占地方；变体选择符只是 emoji 后缀，删掉 emoji 本体照样在）；
 *   · 其余 ⇒ 写成 `\uXXXX`（纯 ASCII，**信息不丢**：那个位置本来是什么字符仍读得出来）。
 *
 * ## 判定从哪来
 *
 * 「这个字符在 CP936 里有没有字形」由 **.NET 那一侧的编码器**说了算（真正发出去的是它编的
 * 字节）。本文件在 Node 侧**自建**同一张表：GBK 双字节区用 `TextDecoder("gbk")` 逐码位解出，
 * GB18030 四字节区（码点 U+10000 以上）**整段可编码**、按公式判。
 *
 * 两处已知差异：`²` 与 `µ` —— .NET 能编，而 Node 这张 GBK 表解不出来 ⇒ 列入「明确保留」，
 * 不动它们。
 *
 * ## 边界
 *
 *   · **非 Windows 不走这一跳**（`ci-cp936-exit.mjs` 在那里原样转出）⇒ 本文件在那台机器上
 *     只是个纯函数库，不改变任何行为；
 *   · **代理对不拆**：遍历按**码点**走；
 *   · **幂等**：归一化过一次的内容再归一化，结果不变（替代物都在 CP936 里）。
 */

/** 中文 Windows 的 ANSI 代码页 —— 平台那一跳读的就是它。 */
export const CP936_CODE_PAGE = 936;

/**
 * 这个字符的码位（空串按 0 算 —— 它不该出现，但类型上不留 `undefined`）。
 *
 * @param {string} ch
 * @returns {number}
 */
function codePointOf(ch) {
  return ch.codePointAt(0) ?? 0;
}

/**
 * Node 侧自建的 **CP936 可编码字符集**。
 *
 * 两段拼起来：GBK 双字节区（`0x81-0xFE` × `0x40-0xFE`，跳过 `0x7F`）+ ASCII。
 * GB18030 的四字节区**不在 CP936 里**（那是 GB18030 才有的一档，emoji 落在那儿 ⇒
 * emoji 在日志里同样会变成问号），所以这里**不含**它。
 *
 * 懒建 + 缓存：本模块被每个 stage 的转码外壳加载一次，而建表要跑两万多次解码。
 */
/** @type {Set<string> | null} */
let cachedSet = null;

/**
 * @returns {Set<string>} 能在 CP936 里编出来的字符
 */
export function cp936EncodableSet() {
  if (cachedSet) return cachedSet;
  const set = new Set();
  for (let cp = 0; cp < 0x80; cp++) set.add(String.fromCodePoint(cp));
  const decoder = new TextDecoder("gbk", { fatal: false });
  for (let hi = 0x81; hi <= 0xfe; hi++) {
    for (let lo = 0x40; lo <= 0xfe; lo++) {
      if (lo === 0x7f) continue;
      const decoded = decoder.decode(Uint8Array.from([hi, lo]));
      /* 解不出来的那一格（.NET 那边会写成问号）不进表；解出来是两个字的那一格也不进
       * （GBK 里没有「一个字对应两码元」的映射，解出两个字说明这一格是别的意思）。 */
      if (decoded.length === 1 && decoded !== "�") set.add(decoded);
    }
  }
  cachedSet = set;
  return set;
}

/**
 * 这个字符在 CP936 里有没有字形。
 *
 * @param {string} ch 单个码点（调用方按码点遍历，不要传代理对的半截）
 * @returns {boolean}
 */
export function isCp936Encodable(ch) {
  const cp = codePointOf(ch);
  if (cp < 0x80) return true;
  return cp936EncodableSet().has(ch);
}

/**
 * `.NET` 能编、而 Node 这张 GBK 表解不出来的两个字符 —— **明确保留，不动它们**。
 *
 * 它们落在 GBK 的扩展位上（`0xA1` 段里几个少见的码位），Node 的 `TextDecoder("gbk")`
 * 对那几格给出的不是同一个字形 ⇒ 拿 Node 的表判会误伤。
 */
export const GLYPH_KEPT = new Set(["²", "µ"]);

/**
 * 零宽类：**删掉**。
 *
 * 它们在原文里就不占位置，留在日志里既看不见、又会占掉一个问号。
 * 变体选择符（U+FE0F）是 emoji 的后缀，删掉之后 emoji 本体照样在；
 * 零宽连接符（U+200D）会把一组 emoji 连成一个字形，删掉之后它们散成几个独立 emoji
 * —— 视觉上几乎一样，比「一个问号夹在中间」好。
 */
export const GLYPH_DROPPED = new Set([
  "\u200B", /* 零宽空格 */
  "\u200D", /* 零宽连接符 */
  "\u00AD", /* 软连字符 */
  "\uFE0F", /* 变体选择符 */
  "\uFEFF", /* 零宽不换行空格（BOM） */
]);

/**
 * 坏字符的**等价写法** —— 也就是「它在日志里显示成什么」。
 *
 * 挑法的三条口径：
 *
 *   · **视觉几乎不变**：CP936 里有的等义字形优先（`✓`→`√`、`✗`→`×`、`⇒`→`→`、
 *     `▾`→`▼`、`•`→`·`）；这些替代物全都在 CP936 里 ⇒ 归一化是幂等的；
 *   · **没有等义字形时用 ASCII**（`⌘`→`[cmd]`、`↔`→`<->`），宁可糙也不丢信息；
 *   · **表里没有的走 `\uXXXX` 兜底**（见 `normalizeCp936Glyphs`）—— 那不是「随便挑的
 *     替代」，是「如实记下那个位置本来是什么字符」。
 *
 * 这张表同时是**登记表**：`scripts/check-cp936-glyphs.cjs` 判「源码里的坏字符有没有
 * 在这里登记」—— 没登记的那个字符会以 `\uXXXX` 的形态出现在日志里，那正是要提醒的形态。
 */
export const GLYPH_REPLACEMENTS = new Map([
  /* ── 判决类：绿标与红标 ── */
  ["✓", "√"], /* vitest 的通过标记 */
  ["✔", "√"],
  ["✅", "√"],
  ["✗", "×"],
  ["✕", "×"],
  ["✖", "×"],
  ["✘", "×"],
  ["❌", "×"],
  /* ── 方向与箭头 ── */
  ["⇒", "→"],
  ["⇔", "="],
  ["⟺", "="],
  ["⟹", "=>"],
  ["⇄", "→"],
  ["⇆", "→"],
  ["↔", "<->"],
  ["⟵", "<->"],
  ["⟷", "<->"],
  ["↛", "!->"],
  ["↳", "->"],
  ["↩", "enter"],
  ["↵", "enter"],
  ["↺", "->"],
  ["↻", "->"],
  ["↶", "->"],
  ["⇧", "shift"],
  ["⇪", "ctrl+enter"],
  /* ── 提示类 ── */
  ["⚠", "※"],
  ["⚙", "[cfg]"],
  ["⛶", "[max]"],
  ["ℹ", "(i)"],
  ["ⓘ", "(i)"],
  ["✎", "[edit]"],
  ["❯", ">"],
  ["›", ">"],
  ["❮", "<"],
  ["‹", "<"],
  /* ── 几何与记号 ── */
  ["•", "·"],
  ["・", "·"],
  ["−", "-"],
  ["‴", '"'],
  ["⁴", "^4"],
  ["⊆", "subset"],
  ["⊇", "superset"],
  ["⊨", "|="],
  ["⊗", "(x)"],
  ["⊘", "(/)"],
  ["∖", "\\"],
  ["⋮", "..."],
  ["⋯", "..."],
  ["⣷", "..."],
  ["⤓", "->"],
  ["⤢", "->"],
  ["⧉", "[]"],
  ["⨯", "x"],
  ["⛶", "[max]"],
  ["⎯", "-"],
  ["⌊", "{"],
  ["⌋", "}"],
  ["⌄", "v"],
  ["⌈", "{"],
  ["⌉", "}"],
  ["⌫", "bksp"],
  ["⌘", "[cmd]"],
  ["␣", "_"],
  ["⓪", "0"],
  ["⑪", "(11)"],
  ["▾", "▼"],
  ["▸", ">"],
  ["▶", ">"],
  ["►", ">"],
  ["◀", "<"],
  ["◈", "*"],
  ["⬜", "[]"],
  ["⭐", "*"],
  ["✨", "*"],
  ["✱", "*"],
  ["✳", "*"],
  ["✻", "*"],
  ["✚", "+"],
  ["✜", "+"],
  ["❖", "*"],
  ["❥", "*"],
  ["❯", ">"],
  ["⊤", "T"],
  /* ── 时钟与状态 ── */
  ["⏳", "..."],
  ["⏸", "||"],
  ["⏱", "[timer]"],
  ["⏚", "_"],
  ["⏞", "-"],
  ["⏝", "v"],
  ["⏏", "="],
  ["⏤", "|"],
  /* ── emoji（CP936 没有 ⇒ 同样会变成问号）── */
  ["⚪", "o"],
  /* ── 数字与杂项 ── */
  ["٠", "0"],
  ["١", "1"],
  ["٣", "3"],
  ["²", "2"],
  ["µ", "u"],
  ["¶", "P"],
  ["«", "<<"],
  ["»", ">>"],
  ["¬", "!"],
  ["∓", "-"],
  ["⍽", "lr"],
  ["⎔", "|="],
  ["≳", ">="],
  ["∉", "not in"],
  ["⤴", "->"],
  ["⤵", "->"],
  ["⤶", "->"],
  ["�", "?"],
]);

/**
 * 归一化一批文本：把 CP936 编不出来的字符换成读得出来的等价写法。
 *
 * 纯函数（不碰 IO），所以它能被单测直接判；读数由调用方决定怎么打。
 *
 * @param {string} text
 * @returns {{text: string, replaced: Array<{from: string, to: string, count: number}>}}
 *   `text` 是归一化后的文本；`replaced` 按「原字符 → 替代」分组，带处数。
 */
export function normalizeCp936Glyphs(text) {
  if (!text) return { text: text ?? "", replaced: [] };
  const groups = new Map();
  let out = "";
  /* 按**码点**遍历：代理对整体取出（emoji 落在 GB18030 四字节区，CP936 里没有 ⇒
   * 它们同样要换；但绝不能把代理对拆成两半分别处理）。 */
  for (const ch of text) {
    if (GLYPH_KEPT.has(ch)) {
      out += ch;
      continue;
    }
    if (GLYPH_DROPPED.has(ch)) {
      groups.set(ch, { from: ch, to: "", count: (groups.get(ch)?.count ?? 0) + 1 });
      continue;
    }
    if (isCp936Encodable(ch)) {
      out += ch;
      continue;
    }
    const to =
      GLYPH_REPLACEMENTS.get(ch) ??
      `\\u${codePointOf(ch).toString(16).toUpperCase().padStart(4, "0")}`;
    const prev = groups.get(ch);
    groups.set(ch, { from: ch, to, count: (prev?.count ?? 0) + 1 });
    out += to;
  }
  return { text: out, replaced: [...groups.values()] };
}

/**
 * 把归一化明细写成一句**读数**。
 *
 * 这句话本身会被同一个转码层再走一遍 ⇒ 它自己必须**全是 CP936 编得出来的字符**
 * （`→` `√` `×` 都在 CP936 里，其余是 ASCII）—— 否则读数自己会变成问号，
 * 而那正是这一层要治的病。
 *
 * @param {Array<{from: string, to: string, count: number}>} replaced
 * @param {string} [scope] 这批的范围（逐块的那条是「这一批」，收尾那条是「这一跑」）
 * @returns {string}
 */
export function describeGlyphReplacements(replaced, scope = "这一批") {
  if (!replaced.length) return "";
  const parts = replaced
    .map((r) => {
      const from = `U+${codePointOf(r.from).toString(16).toUpperCase().padStart(4, "0")}`;
      const to = r.to === "" ? "(删)" : r.to;
      return `${from} -> ${to} x${r.count}`;
    })
    .join("、");
  const total = replaced.reduce((n, r) => n + r.count, 0);
  return `[cp936-glyph] ${scope}有 ${total} 个字符在 CP936 里没有字形，已换成读得出来的写法：${parts}`;
}
