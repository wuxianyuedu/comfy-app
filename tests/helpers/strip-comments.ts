/**
 * 去掉源码里的注释、只留代码，供「拿正则断言源码形状」的门禁用例：注释里正当会出现被禁的叙述（「漏了 `trim()`」），拿原文匹配就是自打自。
 * 块注释整段去掉，行注释默认只去整行的；`trailing: true`（ISSUE #2453）才连行尾一起去，`syntax: "hash"`（ISSUE #2934）用 `#` 剥 ps1/Cargo.toml。
 * 实现是一遍字符扫描（ISSUE #2925）：正则版不跟引号状态，字符串里的 `/*` 会吃掉真实代码 → `not.toMatch` 得**假绿**；不识别正则字面量、模板 `${}` 嵌套会提前收尾；输出形状被 31 份用例依赖。
 */
export function stripComments(
  src: string,
  opts: { syntax?: "js" | "hash"; trailing?: boolean } = {},
): string {
  /* `hash` 档只换「行注释从哪个字符开始」与「有没有块注释」这两处，其余共用一份状态机。 */
  const hashSyntax = opts.syntax === "hash";
  const out: Array<string> = [];
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
      /* 单/双引号**按行重算**：JS 里这两种串不能跨行，行末一律退出该状态。这是 #2925 的后半 —— 正则字面量里
       * 常有落单引号（`/["']\s+/`），跨行传染会把后面**真正的块注释**当成代码留下（实测 `scripts/base-check/
       * hook-steps.mjs:203`，旧版全局状态机在这里走偏，导致注释里的 `shell: true` 被 `spawn-shell-scan` 报违规）。
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

    /* `#` 档没有块注释语法：`/*` 在那两份接收者里就只是两个普通字符。 */
    if (!hashSyntax && c === "/" && next === "*") {
      inBlock = true;
      i += 1;
      continue;
    }

    if (hashSyntax ? c === "#" : c === "/" && next === "/") {
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
