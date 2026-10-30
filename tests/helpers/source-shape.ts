/**
 * 把「控制流花括号」归一化掉，让「读源码做形态断言」的契约测试对 oxlint `curly`
 * （以及任何会给单语句体加 `{}` 的规则）免疫。
 *
 * 背景：本仓有大量门禁用例读 `scripts/**` / `src/**` 的源码，再用 `toContain` /
 * `toMatch` 比对**字面形态**（见 `tests/helpers/strip-comments.ts` 头注里那类
 * 「拿正则断言源码形状」的用例）。`curly` 把 `if (cond) stmt;` 改成
 * `if (cond) {\n  stmt;\n}`，这种断言就失配 —— 但语义并没变，断言只是在钉
 * 「这条控制流存在」，不在乎有没有括号。
 *
 * 为什么必须走解析器、不能用正则：
 *   · 正则分不清**块括号**和**对象字面量括号**。`if (a) return { x: 1 };` 里的
 *     `{ x: 1 }` 是对象字面量，绝不能剥；而 `if (a) { b(); }` 里的 `{` 是块。
 *     本仓的 `strip-comments` 头注自己就写过「它**不是**词法分析器，够门禁用」。
 *     这里要的是真·分块，所以直接用 `typescript`（已在依赖里）解析 AST，只折
 *     「单语句控制流块」（if / else / for / for-of / for-in / while / do），
 *     对象字面量与多语句块原样保留。
 *
 * 归一化形态：`if (cond) { stmt; }` → `if (cond) stmt;`（单行体），幂等。
 * 多次迭代直到文本稳定，处理嵌套（`if (a) { if (b) { g(); } }` → `if (a) if (b) g();`）。
 *
 * 适用范围：JS / TS 家族源码（`.ts/.tsx/.mjs/.cjs/.js`）。非 JS 家族（`.rs`、`.ps1`）
 * 的源码别调它 —— 直接原样返回，避免被 TS 解析器误当成 JS 而错折。
 *
 * ── 唯一实现（§12.18 复用优先）──────────────────────────────────────────────
 * 本函数是这件事的唯一一份实现，`tests/source-shape-single-source.test.ts` 那条
 * 台账判着：新出现的本地副本直接红。要改行为给它加模式，别再抄一份。
 */
import * as ts from "typescript";

/** 按扩展名选解析器方言（`.tsx`/`.jsx` 走 TSX，其余 JS 家族走 TS/JS）。 */
function scriptKindOf(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx") || fileName.endsWith(".jsx")) return ts.ScriptKind.TSX;
  if (fileName.endsWith(".mjs") || fileName.endsWith(".cjs") || fileName.endsWith(".js")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/**
 * 把源码里所有「单语句控制流块」折成单行体，使 `curly` 这类加括号规则不再影响
 * 字面形态断言。非 JS 家族源码直接原样返回。
 *
 * @param src 读到的源码文本
 * @param fileName 文件名（含扩展名），用于推断解析器方言；默认按 `.ts` 处理
 */
export function normalizeControlFlow(src: string, fileName = "source.ts"): string {
  if (!/\.(tsx?|m?jsx?|m?cjs)$/.test(fileName)) {
    return src;
  }
  const kind = scriptKindOf(fileName);
  const one = (text: string): string => {
    const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
    const edits: Array<{ start: number; end: number; text: string }> = [];
    const collapse = (block: ts.Block): void => {
      if (block.statements.length !== 1) {
        return;
      }
      const printer = ts.createPrinter();
      /* 上面刚判过 `length === 1`，这里再显式兜一次：`noUncheckedIndexedAccess` 下
       * 下标访问的类型是 `Statement | undefined`，不是「已经判过长度」就能收窄的。 */
      const inner = block.statements[0];
      if (!inner) {
        return;
      }
      const printed = printer.printNode(ts.EmitHint.Unspecified, inner, sf).replace(/\s+$/, "");
      edits.push({ start: block.getStart(sf), end: block.getEnd(), text: printed });
    };
    const visit = (node: ts.Node): void => {
      if (ts.isIfStatement(node)) {
        if (ts.isBlock(node.thenStatement)) {
          collapse(node.thenStatement);
        }
        if (node.elseStatement && ts.isBlock(node.elseStatement)) {
          collapse(node.elseStatement);
        }
      } else if (
        ts.isWhileStatement(node) ||
        ts.isForStatement(node) ||
        ts.isForOfStatement(node) ||
        ts.isForInStatement(node) ||
        ts.isDoStatement(node)
      ) {
        if (ts.isBlock(node.statement)) {
          collapse(node.statement);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    const sorted = [...edits].sort((a, b) => a.end - b.end);
    let result = text;
    for (const e of sorted) {
      const delta = e.text.length - (e.end - e.start);
      result = result.slice(0, e.start) + e.text + result.slice(e.end);
      for (const o of sorted) {
        if (o === e) {
          continue;
        }
        if (o.start > e.end) {
          o.start += delta;
          o.end += delta;
        }
      }
    }
    return result;
  };
  let cur = src;
  let prev: string | null = null;
  let guard = 0;
  while (cur !== prev && guard < 16) {
    prev = cur;
    cur = one(cur);
    guard += 1;
  }
  return cur;
}
