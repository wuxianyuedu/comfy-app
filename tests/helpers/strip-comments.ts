/**
 * 去掉源码里的注释，只留代码 —— 给「拿正则断言源码形状」那类门禁用例用。
 *
 * 为什么必须有这一步：这类判据针对的是**代码**，而注释里正当会出现被禁的
 * 叙述本身（「漏了 `trim()`」、「不再有 `s.emitter.emit`」都是解释为什么要改），
 * 拿原文去匹配就是自打自——判据会红在一行注释上，而那一行恰恰是文档。
 *
 * 取舍（与既有各处内联版本一致，但**实现是一遍字符扫描**，理由见下）：
 *   · 块注释整段去掉；
 *   · 行注释只去「整行都是注释」的，默认不碰行尾注释。
 *
 * ── `{ trailing: true }` 那一档（ISSUE #2453 加的模式，默认关）──────────────
 *
 * 默认档把 `const a = 1; // 别写 shell: true` 这行的**行尾注释留着**，于是
 * 「源码里不许出现 `shell:`」那类判据会红在一段**正在教人别这么写**的注释上 ——
 * 那是自打自的另一种形状（不是红在整行注释上，是红在行尾）。
 * 要这一档就显式传 `{ trailing: true }`。
 *
 * ── 为什么是**一个字符扫描器**而不是两条 `replaceAll`（ISSUE #2925）──────────
 *
 * 旧形态里 `/\*[\s\S]*?\*\/` 那一条**不跟引号状态**，于是**字符串字面量里的 `/*`**
 * 会被当成块注释起点、一路吃到下一个 `*\/` —— 中间的真实代码整段消失。实测落点
 * （量具 = 逐行比对原文与剥后，只数"那一行本身不含 `//` 也不含 `/*`"的消失行）：
 * `scripts/dev-launcher.mjs` 59 行、`src-tauri/src/lib.rs` 50 行、
 * `scripts/build-desktop.mjs` 33 行、`scripts/standalone-private-inputs.mjs` 33 行
 * **整行消失**，而那几份正是本仓几十格判据的接收者。对正向断言这是"判不到"，
 * 对 `not.toMatch` 就是**假绿**：被禁的写法落进那一段里，判据永远看不见它。
 * `//` 那一半早就逐字符跟引号了，两半严谨度不对称时，弱的那一半决定安全性。
 *
 * 仍**不是** JS 词法分析器，两条边界写清楚：
 *   · 不识别正则字面量 —— 正则里出现「斜杠紧跟星号」那一串时会被当成块注释起点
 *     （本文件旧实现的两条正则正是靠反斜杠把它们拆开写的，写法照那个来）；
 *   · 模板串里的 `${…}` 内层再套反引号会提前结束字符串状态。
 * 也就是说它够门禁用，别拿它做代码正确性判断。
 *
 * 块注释**内部**的换行照旧丢弃：保持与旧实现相同的输出形状，免得
 * `{0,400}` 那一类窗口断言被行数变化带偏（本文件的输出形状被 31 份用例依赖）。
 *
 * @param src 源码全文
 * @param opts `trailing`：连行尾注释一起去（默认关）
 * @returns 只留代码的文本
 */
export function stripComments(src: string, opts: { trailing?: boolean } = {}): string {
  const out: string[] = [];
  let inBlock = false;
  let quote: null | "'" | '"' | "`" = null;
  /** 本行到目前为止还只有空白 —— 只有这种位置上的 `//` 才算「整行注释」。 */
  let blankBefore = true;

  for (let i = 0; i < src.length; i += 1) {
    const c = src[i]!;
    const next = src[i + 1];

    if (inBlock) {
      if (c === "*" && next === "/") {
        inBlock = false;
        i += 1;
      }
      continue;
    }

    if (quote !== null) {
      out.push(c);
      if (c === "\\") {
        // 转义：把下一个字符一并写出，`"\""` 不会被当成字符串结束
        i += 1;
        if (i < src.length) {
          out.push(src[i]!);
        }
        continue;
      }
      if (c === quote) {
        quote = null;
      }
      /* 单/双引号**按行重算**：JS 里这两种串不能跨行，所以行末一律退出该状态。
       * 这一条是 #2925 的后半 —— 正则字面量里常有落单的引号（`/["']\s+/`），
       * 让它跨行传染就会把后面**真正的块注释**当成代码留下（实测
       * `scripts/base-check/hook-steps.mjs:203` 那一行，旧版全局状态机在这里
       * 走偏，导致注释里的 `shell: true` 被 `spawn-shell-scan` 报成违规）。
       * 模板串（反引号）确实能跨行，所以只有它把状态带到下一行。 */
      if (c === "\n") {
        if (quote === "'" || quote === '"') {
          quote = null;
        }
        blankBefore = true;
      } else if (c.trim() !== "") {
        blankBefore = false;
      }
      continue;
    }

    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      out.push(c);
      blankBefore = false;
      continue;
    }

    if (c === "/" && next === "*") {
      inBlock = true;
      i += 1;
      continue;
    }

    if (c === "/" && next === "/") {
      if (blankBefore || opts.trailing === true) {
        // 丢到行尾；换行本身留给下一轮写出，所以行数不漂
        const nl = src.indexOf("\n", i);
        i = nl === -1 ? src.length : nl - 1;
        continue;
      }
      out.push(c);
      blankBefore = false;
      continue;
    }

    out.push(c);
    if (c === "\n" || c.trim() !== "") {
      blankBefore = c === "\n";
    }
  }

  return out.join("");
}
