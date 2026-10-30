/**
 * 去掉源码里的注释，只留代码 —— 给「拿正则断言源码形状」那类门禁用例用。
 *
 * 为什么必须有这一步：这类判据针对的是**代码**，而注释里正当会出现被禁的
 * 叙述本身（「漏了 `trim()`」、「不再有 `s.emitter.emit`」都是解释为什么要改），
 * 拿原文去匹配就是自打自——判据会红在一行注释上，而那一行恰恰是文档。
 *
 * 取舍与既有各处内联版本一致：
 *   · 块注释整段去掉（`/* … *\/` 非贪婪）；
 *   · 行注释只去「整行都是注释」的，避免误伤 `http://127.0.0.1` 这类
 *     字符串里的 `//`，也不去碰行尾注释（那需要真正的词法分析）。
 * 也就是说它**不是** JS 词法分析器：够门禁用，别拿它做代码正确性判断。
 *
 * ── `{ trailing: true }` 那一档（ISSUE #2453 加的模式，默认关）──────────────
 *
 * 默认档把 `const a = 1; // 别写 shell: true` 这行的**行尾注释留着**，于是
 * 「源码里不许出现 `shell:`」那类判据会红在一段**正在教人别这么写**的注释上 ——
 * 那是自打自的另一种形状（不是红在整行注释上，是红在行尾）。
 * 要这一档就显式传 `{ trailing: true }`：它在**逐字符跟过引号状态**之后才切，
 * 所以 `const url = "http://a"; use(x);` 里的 `//` 不会被当成注释起点。
 *
 * 为什么是「加一个模式」而不是调用方自己再写一份：本文件是这件事的**唯一实现**
 * （`tests/strip-comments-single-source.test.ts` 那条台账判着：新出现的本地副本直接红），
 * 而那条判据的失败文案写的就是「它不满足你的形状就**给它加一个模式**，别再抄一份」。
 */
export function stripComments(src: string, opts: { trailing?: boolean } = {}): string {
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  if (opts.trailing !== true) {
    return stripped;
  }
  return stripped.split("\n").map(dropTrailingComment).join("\n");
}

/**
 * 切掉一行里**行尾**的 `// …`（引号内的 `//` 不算注释起点）。
 *
 * 为什么逐字符跟引号：`const url = "http://a"; use(x);` 这种行若按「第一个 `//`」切，
 * `use(x)` 会被切掉 —— 于是「源码里不许出现 `use(`」那类断言**假绿**（那正是
 * `strip-comments-single-source.test.ts` 里 NAIVE 台账点名的缺陷形状）。
 *
 * 边界：不识别正则字面量与模板串里的 `${}` —— 那两种里出现 `//` 会被当成注释起点。
 * 它只影响 `trailing: true` 这一档的调用方，默认档不走这里。
 *
 * @param line 单行源码
 * @returns 切掉行尾注释后的那一行
 */
function dropTrailingComment(line: string): string {
  let quote: null | "'" | '"' | "`" = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote !== null) {
      if (c === "\\") {
        i += 1;
        continue;
      }
      if (c === quote) {
        quote = null;
      }
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      continue;
    }
    if (c === "/" && line[i + 1] === "/") {
      return line.slice(0, i);
    }
  }
  return line;
}
