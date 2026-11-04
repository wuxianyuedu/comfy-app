/**
 * 把「控制流花括号」归一化，让读源码做形态断言的契约测试对 oxlint `curly`（及任何给单语句体加 `{}` 的规则）免疫 —— 语义没变，只是
 * `if (cond) stmt;` 变带块后字面断言失配。必须走 AST（`typescript`）不能用正则：正则分不清块括号与对象字面量（`if (a) return { x: 1 };`）。
 * 只折 if/else/for(-of/-in)/while/do 的单语句体并迭代到稳定；仅 JS/TS 家族，`.rs`/`.ps1` 原样返回。唯一实现（§12.18），`tests/source-shape-single-source.test.ts` 判本地副本红。
 */
import * as ts from "typescript";

/** 按扩展名选解析器方言（`.tsx`/`.jsx` 走 TSX，其余 JS 家族走 TS/JS）。 */
function scriptKindOf(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx") || fileName.endsWith(".jsx")) {
    return ts.ScriptKind.TSX;
  }
  if (fileName.endsWith(".mjs") || fileName.endsWith(".cjs") || fileName.endsWith(".js")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/**
 * 把所有「单语句控制流块」折成单行体，使 `curly` 这类加括号规则不影响字面形态断言；非 JS 家族原样返回。
 * @param src 源码文本
 * @param fileName 含扩展名的文件名，用于推断解析器方言（默认按 `.ts`）
 */
export function normalizeControlFlow(src: string, fileName = "source.ts"): string {
  if (!/\.(tsx?|m?jsx?|m?cjs)$/.test(fileName)) {
    return src;
  }
  const kind = scriptKindOf(fileName);
  const one = (text: string): string => {
    const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
    const edits: Array<{ end: number; start: number; text: string }> = [];
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
