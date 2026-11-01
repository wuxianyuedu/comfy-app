/**
 * tw4 两份「CSS 等价改写」工具的**共享扫描内核**。
 *
 * 为什么要有这一份：`tw4-canonical-report.mjs` 与 `tw4-spacing-canonical.mjs` 各自
 * 都做同一件事 ——「把源码里**真正会被应用的**类名字符串取出来问 Tailwind 引擎」。
 * 取出这一步此前两边各写一遍 `STRING_LITERAL` 全局替换，而那个写法有一个共同的
 * 漏子：**它不认注释**。注释里用反引号引用的示例（`` `!row` ``、`` `min-h-[22px]` ``）
 * 与真正的 className 字符串字面量同形，于是被当成候选：
 *
 *   · `--check` 侧：报出一条**改了也影响不到运行时**的候选 ⇒ 判据转红，而代码是合规的；
 *   · `--write` 侧更重：它会真的去改注释里的示例 —— 一句「此前写成 `h-[22px]`」
 *     被改写成「此前写成 `h-5.5`」，**解释与被解释的东西一起漂了**，而那是文档级失真。
 *
 * 修法只有一个方向：扫描前先把注释剥掉。**剥离这一层不再抄第二份** —— 复用
 * `scripts/ui-primitives-engine.cjs` 导出的 `stripComments`（逐字符状态机、保持长度
 * 与换行，报告里的行号因此不漂）。它与本模块要的语义逐字一致：`tests/strip-comments-single-source.test.ts`
 * 把「剥注释的本地实现」按台账守着，**多一份就红**（§12.18 复用优先 / ISSUE #1192），
 * 所以这里只做「取字面量」那一层，剥注释走 require 过来的那一份。
 *
 * 本模块补的是它没有的下一层：直接从剥后文本里取出**字符串字面量的内容与位置**，
 * 调用方拿去按 token 切分即可，不必各自再捕一遍正则。
 *
 * 已知边界（**刻意**不处理，不是漏）：那台状态机不认字符串里的 `//` 与 `/*`。正则
 * 字面量与 URL 里会出现它们，于是「同一行里 URL 之后还有 className」的写法会被少扫一行。
 * 全仓实测这类同行写法 0 处（`grep -rEn 'https?://.*className' src/` 为空），
 * 而换来的是「不必先写一个 JS 词法器」——那才是这里真正的成本。若哪天出现这种行，
 * 处置是给它单独加一条判据，而不是放弃剥离（放弃剥离 = 注释继续被当成候选）。
 */
import { createRequire } from "node:module";

/** `.cjs` 那侧的剥注释实现（纯 Node 门禁层，两边都加载得到）。 */
const requireCjs = createRequire(import.meta.url);
const { stripComments } = requireCjs("./ui-primitives-engine.cjs");

export { stripComments };

/** 字符串字面量：普通串与模板串；模板串里的 `${…}` 作为普通片段保留。 */
const STRING_LITERAL = /(["'`])((?:\\[\s\S]|(?!\1)[^\\])*?)\1/g;

/**
 * 取出 `text` 里**注释之外**的字符串字面量。
 *
 * @param {string} text 文件原文
 * @returns {Array<{quote: string, content: string, index: number}>}
 *   `index` 指向引号本身（与剥后文本同坐标，剥后文本保长）。
 */
export function stringLiterals(text) {
  const code = stripComments(text);
  const out = [];
  for (const m of code.matchAll(STRING_LITERAL)) {
    out.push({ quote: m[1], content: m[2], index: m.index ?? 0 });
  }
  return out;
}

/**
 * 在**注释之外**的字符串字面量上做整 token 改写（`--write` 那一档用）。
 *
 * 与 `stringLiterals()` 同源，所以注释里的示例不会被碰到。改写按 `rewriteContent`
 * 的返回值逐段替换：返回 `null` 表示这一段没变，原样保留（`--write` 的幂等性靠它）。
 *
 * @param {string} text 文件原文
 * @param {(content: string) => string | null} rewriteContent 逐字面量的改写函数
 * @returns {{text: string, changed: number}} 改写后的全文与发生变化的字面量个数
 */
export function rewriteLiterals(text, rewriteContent) {
  const code = stripComments(text);
  let out = "";
  let cursor = 0;
  let changed = 0;
  for (const lit of stringLiterals(code)) {
    const next = rewriteContent(lit.content);
    if (next === null) {
      continue;
    }
    out += text.slice(cursor, lit.index) + lit.quote + next + lit.quote;
    cursor = lit.index + 1 + lit.content.length + 1;
    changed += 1;
  }
  return { text: changed > 0 ? out + text.slice(cursor) : text, changed };
}
