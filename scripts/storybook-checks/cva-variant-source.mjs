// 故事文件的「枚举从 cva 返回值上取」判据（供 tests/storybook-cva-variant-source.test.ts
// 与门禁 scripts/storybook-check.mjs 共用）。
//
// 为什么要这条：`cva()` 返回的是一个 `(props?) => string` 的**函数**，`.variants`
// 只存在于 TS 泛型里、运行时没有。写成 `Object.keys(buttonVariants.variants.variant)`
// 时 tsc 会红，而 Storybook 的表现是**加载期**抛 `Cannot read properties of
// undefined` —— 侧栏列着故事、画布上一片空白，与「这个 story 挂了」的直觉对不上。
// 首轮的 3 份 story 就是这么写的，靠逐 story 截图核出来的。
//
// 只认形态，不认名字：基底是文件内 `const X = cva(…)` 的绑定名，**或**从别处
// import 进来的名字（后者正是踩坑原形态 —— 故事 import 组件的 export 变体表）。
// 判据不该要求人改名；改名就能绕过的门禁等于没有。
import ts from "typescript";

/**
 * 遍历一棵 AST。
 * @param {ts.Node} root
 * @param {(node: ts.Node) => void} fn
 * @returns {void}
 */
function walk(root, fn) {
  fn(root);
  ts.forEachChild(root, (child) => walk(child, fn));
}

/**
 * `cva` 的返回值在文件里的绑定名（`const X = cva(…)` 的 X）。
 * @param {ts.SourceFile} source
 * @returns {Set<string>}
 */
export function cvaBindings(source) {
  /** @type {Set<string>} */
  const out = new Set();
  walk(source, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === "cva"
    ) {
      out.add(node.name.text);
    }
  });
  return out;
}

/**
 * 本文件从别处 import 进来的具名绑定（`import { buttonVariants } from "./button"`）。
 *
 * 为什么它也要算：真实的踩坑写法正是「故事文件 import 组件的 export 变体表、
 * 再在它上面点 `.variants`」（`buttonVariants` / `badgeVariants` 都是组件导出的）。
 * 只认文件内 `const X = cva(…)` 会整条漏掉这一类 —— 而它恰是首轮踩坑的形态。
 * @param {ts.SourceFile} source
 * @returns {Set<string>}
 */
export function importedNames(source) {
  /** @type {Set<string>} */
  const out = new Set();
  walk(source, (node) => {
    if (
      ts.isImportDeclaration(node) &&
      node.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      for (const el of node.importClause.namedBindings.elements) {
        out.add(el.name.text);
      }
    }
  });
  return out;
}

/**
 * `X.variants` / `X["variants"]` 且 X 可能是 cva 的返回值 → 返回该访问的起点标识符。
 *
 * 「可能是」= 文件内 `const X = cva(…)` 的绑定名，**或**从别处 import 进来的名字。
 * 后者宽一些（import 进来的理论上可能有不是 cva 的东西），但代价方向是对的：
 * 误报只需看一眼，漏报则是「侧栏有故事、画布一片空白」再来一次。
 * @param {ts.Node} node
 * @param {Set<string>} cvaNames
 * @returns {ts.Identifier | null}
 */
function variantsAccessBase(node, cvaNames) {
  /**
   * @param {ts.Expression} expr
   * @returns {boolean}
   */
  const isCandidate = (expr) =>
    ts.isIdentifier(expr) && cvaNames.has(expr.text);
  if (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === "variants" &&
    isCandidate(node.expression)
  ) {
    // 判过 isCandidate（内含 isIdentifier）之后收窄成 Identifier。
    return ts.isIdentifier(node.expression) ? node.expression : null;
  }
  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression !== undefined &&
    ts.isStringLiteral(node.argumentExpression) &&
    node.argumentExpression.text === "variants" &&
    isCandidate(node.expression)
  ) {
    return ts.isIdentifier(node.expression) ? node.expression : null;
  }
  return null;
}

/**
 * 文件里所有「从 cva 返回值上取变体表」的写法。
 * @param {ts.SourceFile} source
 * @returns {{ name: string, line: number, text: string }[]}
 */
export function findCvaVariantAccess(source) {
  const cvaNames = new Set([...cvaBindings(source), ...importedNames(source)]);
  /** @type {{ name: string, line: number, text: string }[]} */
  const hits = [];
  if (cvaNames.size === 0) return hits;
  walk(source, (node) => {
    const base = variantsAccessBase(node, cvaNames);
    if (base === null) return;
    const pos = source.getLineAndCharacterOfPosition(base.getStart(source));
    hits.push({
      name: base.text,
      line: pos.line + 1,
      text: node.getText(source).split("\n")[0] ?? "",
    });
  });
  return hits;
}

/**
 * 文件里「`type X = … ComponentProps<typeof C>["轴"] …`」声明的轴名。
 * 这是正确写法的形态（从 props 派生），也是「哪些轴本来该被枚举出来」的依据。
 * @param {ts.SourceFile} source
 * @returns {Map<string, string>} 别名 → 轴名
 */
export function derivedAxisNames(source) {
  /** @type {Map<string, string>} */
  const byAlias = new Map();
  walk(source, (node) => {
    if (
      !ts.isTypeAliasDeclaration(node) ||
      !ts.isTypeReferenceNode(node.type) ||
      node.type.typeArguments === undefined
    ) {
      return;
    }
    for (const arg of node.type.typeArguments) {
      if (!ts.isIndexedAccessTypeNode(arg)) continue;
      const key = arg.indexType;
      if (ts.isLiteralTypeNode(key) && ts.isStringLiteral(key.literal)) {
        byAlias.set(node.name.text, key.literal.text);
      }
    }
  });
  return byAlias;
}

/**
 * `const X: T[] = [...]` 里那条字面量数组的成员文本（去引号）。
 *
 * 返回 `null` 表示文件里没有叫这个名字的变量；返回 `[]` 表示有同名声明但它不是
 * 字面量数组 —— 两者要分开，否则「拼错名字」与「写成计算表达式」会报同一句话，
 * 把下一个人引到错的方向。
 * @param {string} name
 * @param {ts.SourceFile} source
 * @returns {string[] | null}
 */
export function literalArray(name, source) {
  /** @type {string[] | null} */
  let found = null;
  walk(source, (node) => {
    if (
      found !== null ||
      !ts.isVariableDeclaration(node) ||
      !ts.isIdentifier(node.name) ||
      node.name.text !== name
    ) {
      return;
    }
    if (node.initializer === undefined) found = [];
    else if (ts.isArrayLiteralExpression(node.initializer)) {
      found = node.initializer.elements.map((el) =>
        el.getText(source).replace(/^["']|["']$/g, ""),
      );
    }
  });
  return found;
}

/**
 * `argTypes` 里每个轴挂的候选清单：`{ <轴>: { control: "select", options: <标识符> } }`
 * → `Map<轴名, 标识符名>`。
 *
 * 这是「哪个数组属于哪个轴」的**显式**链接 —— 不靠 `ButtonVariant` ⇄ `VARIANTS`
 * 这种命名约定猜（猜错的表现是判据在空转，那正是本条要防的东西）。
 * @param {ts.SourceFile} source
 * @returns {Map<string, string>}
 */
export function controlOptionsByAxis(source) {
  /** @type {Map<string, string>} */
  const out = new Map();
  /**
   * @param {ts.ObjectLiteralExpression} obj
   * @returns {void}
   */
  const readOptions = (obj) => {
    for (const prop of obj.properties) {
      if (
        !ts.isPropertyAssignment(prop) ||
        !ts.isObjectLiteralExpression(prop.initializer)
      ) {
        continue;
      }
      const axisName = unquote(prop.name.getText(source));
      for (const field of prop.initializer.properties) {
        if (
          ts.isPropertyAssignment(field) &&
          field.name.getText(source) === "options" &&
          ts.isIdentifier(field.initializer)
        ) {
          out.set(axisName, field.initializer.text);
        }
      }
    }
  };
  walk(source, (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === "argTypes"
    ) {
      const init = node.initializer;
      if (ts.isObjectLiteralExpression(init)) readOptions(init);
      else if (
        (ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) &&
        ts.isObjectLiteralExpression(init.expression)
      ) {
        readOptions(init.expression);
      }
    }
  });
  return out;
}

/**
 * `"variant"` / `variant` / `'variant'` 都归一成不带引号的形态。
 * @param {string} text
 * @returns {string}
 */
function unquote(text) {
  return text.replace(/^["']|["']$/g, "");
}

/**
 * 组件的变体表：`variants: { <轴>: { … } }`，只认 cva 调用里那一层。
 * @param {ts.SourceFile} source
 * @returns {Map<string, string>} 轴名 → 轴名（集合语义；值只为可读性）
 */
export function cvaVariantAxes(source) {
  /** @type {Map<string, string>} */
  const axes = new Map();
  walk(source, (node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isIdentifier(node.expression) ||
      node.expression.text !== "cva"
    ) {
      return;
    }
    for (const arg of node.arguments) {
      if (!ts.isObjectLiteralExpression(arg)) continue;
      for (const prop of arg.properties) {
        if (
          !ts.isPropertyAssignment(prop) ||
          prop.name.getText(source) !== "variants" ||
          !ts.isObjectLiteralExpression(prop.initializer)
        ) {
          continue;
        }
        for (const axis of prop.initializer.properties) {
          if (ts.isPropertyAssignment(axis)) {
            const name = unquote(axis.name.getText(source));
            axes.set(name, name);
          }
        }
      }
    }
  });
  return axes;
}

/**
 * 组件某个变体轴的档名（`cva` 里那一层的字面量 key）。
 *
 * 与 `cvaVariantAxes` 同源，只是多取一层 —— 判据脚本与用例都要它，
 * 各写一份就是孪生对的起点（§12.12）。
 * @param {ts.SourceFile} source
 * @param {string} axis
 * @returns {string[]}
 */
export function cvaVariantKeys(source, axis) {
  /** @type {string[]} */
  const keys = [];
  walk(source, (node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isIdentifier(node.expression) ||
      node.expression.text !== "cva"
    ) {
      return;
    }
    for (const arg of node.arguments) {
      if (!ts.isObjectLiteralExpression(arg)) continue;
      for (const prop of arg.properties) {
        if (
          !ts.isPropertyAssignment(prop) ||
          prop.name.getText(source) !== "variants" ||
          !ts.isObjectLiteralExpression(prop.initializer)
        ) {
          continue;
        }
        for (const entry of prop.initializer.properties) {
          if (
            !ts.isPropertyAssignment(entry) ||
            unquote(entry.name.getText(source)) !== axis ||
            !ts.isObjectLiteralExpression(entry.initializer)
          ) {
            continue;
          }
          for (const key of entry.initializer.properties) {
            if (key.name === undefined) continue;
            keys.push(unquote(key.name.getText(source)));
          }
        }
      }
    }
  });
  return keys;
}
