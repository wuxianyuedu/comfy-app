// 故事「面」的判据（供 tests/storybook-story-surface.test.ts 与门禁
// `scripts/storybook-check.mjs` 共用）。
//
// ## 它补的是哪一格
//
// 覆盖率的台账（`coverage-ledger.mjs`）只看**文件名 ↔ 故事文件**：一个
// `ui/x.tsx` 只要被某份 story `import` 到了就算「看过」。而「看过」有四种，
// 漏起来都不报错：
//
//  ① **没有 `title`** —— Storybook 的 `title` 是**可选**的，缺了它的故事会
//     按文件路径自动生成一个条目（`UI/Button` 或 `ui/button`…），落在侧栏的
//     哪个分组里取决于推导规则。于是「按 UI/Studio/Workshop 分组浏览」这件事
//     只在**大家都知道要写 title** 时成立 —— 漏一份，那份就飘到别处（或者与
//     别人的 title 撞车），而构建、覆盖率数字、画布渲染全都正常。
//  ② **没有把真组件接上** —— `component:` 缺，或者连的是 story 内部自造的适配件
//     而适配件又**不渲染真组件**（自己拼了一堆 div）。前者让 Args 面板与自动文档
//     （`addon-docs`）的表格全空；后者更隐蔽：画布上看着挺像，而它证明的是「适配件
//     长这样」，不是「组件长这样」。
//     两者要分开判：适配件**是正当写法**（受控状态、把值源解析成 props、
//     把复合件摆成一行都要它，见 §16.2.3.6），正当与否只有一个判据 ——
//     **它最终渲染的是不是那个真组件**。所以本模块按「本目录的组件 import 了这个
//     文件、且文件里真的用到了它的某个绑定」判，不看 `component:` 那一行连了谁。
//  ③ **组件的必填 props 一个 `args` 都不给** —— 这不是「args 少了」，是组件会
//     **在画布上抛**（`Cannot read properties of undefined`）：story 的加载期抛错
//     与 §16.2.3.4 那轮踩的坑同形，表现同样是「侧栏有故事、画布一片空白」。
//     必填 = 出参类型里没有 `?`、且联合里不含 `undefined`。
//  ④ **同一目录两套分组前缀** —— 分组是靠人写 `title:` 的字符串维系的，
//     而没有任何东西会告诉你「这一份写的是 `UI/JsonViewer`、隔壁写的是
//     `JsonViewer`」。判据取**多数**当口径、逐条点名偏离项，于是「新写的那一份
//     与邻居不一致」在提交时就被看见，不需要谁记得住这张表。
//
// ## 为什么是「单向」：现有 86 份故事不补 args
//
// ③ 只要求**新增 / 新动过**的故事文件满足（`--changed` 那一档），存量不补。
// 理由不是「来不及」，是这批故事的表达方式**已经是对的**：
//
//  · 组件大量用「子件 + 默认值」把 required props 兜住了（`Badge` 的 `children`、
//    `Card` 的各 slot、`Dialog` 的 `open`…），画布上画得出来、Args 面板也调得动；
//  · 早期那批（`button` / `alert`…）走的是**组件自己的 argTypes**，`args` 里
//    本来就没写几项；
//  · 真正吃数据的走注入层（`args.sourceName` + `resolveSource()`，
//    见 §16.2.3.6）—— 那份 `sourceName` 就是它的 args。
//
// 给 86 份文件逐条补 `args` 是把 337 张画布的输入形状**重写一遍**，而它换来的
// 只是「Args 面板里多几个初始值」。判据的价值在「**下一个**新增的故事别漏」，
// 所以口径定成：盘点照实报（供人看），阻断只落在新动过的那一份上。
//
// ## 已知边界（刻意不判）
//
//  · **只读文本与 AST，不做类型分析**：② 判的是「本目录的组件有没有被 import 进来
//    并用到」（与 `coverage-ledger.mjs` 的 `componentTargetsOf` 同一口径的说明符解析），
//    不做符号解析 —— 于是「import 了但只在注释里提到」会判成没接上（误报方向是
//    要人补一句真实使用，代价小）；
//  · **必填项读的是「自己写出 props 接口」的那一族**：接口在**兄弟模块**里
//    （`FilePickerProps` 住在 `file-picker.tsx`、组件只解构它的字段）也认，
//    靠「字段名在组件文件里出现过」连起来。包裹过的形态
//    （`PropsWithChildren` / `Omit<…>` / `ComponentProps<"div">`）读不到就不判 ——
//    宁可漏，不可误伤。
import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

/**
 * @typedef {{ file: string, title: string | null, component: string | null,
 *   args: string[], group: string | null, matchesDir: boolean }} StorySurfaceEntry
 * @typedef {{ stories: StorySurfaceEntry[], missingTitle: string[],
 *   missingComponent: string[],
 *   groupDeviations: { file: string, group: string, expected: string }[] }} StorySurfaceReport
 */

/**
 * 遍历一棵 AST。
 * @param {ts.Node} root @param {(node: ts.Node) => void} fn @returns {void}
 */
function walk(root, fn) {
  fn(root);
  ts.forEachChild(root, (child) => walk(child, fn));
}

/**
 * `meta` 对象字面量（`const meta = { … } satisfies Meta<…>` 或直接 `export default {…}`
 * 两种写法都认）。
 *
 * 为什么按「含 `title` 或 `component` 的那个对象」找而不是按变量名 `meta`：CSF 的
 * 约定是「default export 就是 meta」，变量名叫什么、有没有 `satisfies` 都不影响。
 * @param {ts.SourceFile} source
 * @returns {ts.ObjectLiteralExpression | null}
 */
export function metaObjectOf(source) {
  /** @type {ts.ObjectLiteralExpression | null} */
  let found = null;
  walk(source, (node) => {
    if (found !== null) return;
    /** @param {ts.Expression} expr */
    const unwrap = (expr) => {
      const inner =
        ts.isSatisfiesExpression(expr) || ts.isAsExpression(expr)
          ? expr.expression
          : expr;
      if (!ts.isObjectLiteralExpression(inner)) return null;
      /* 认「`title` 或 `component` 至少有一个」的对象字面量：CSF 里 `component`
         是可选的（纯属性包 / 复合件那种故事就没有），只要求 `title`；反过来
         `component` 有而 `title` 缺的那一份由「缺 title」那条判据点名。 */
      const keys = inner.properties
        .filter(
          (p) =>
            ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p),
        )
        .map((p) => p.name.getText(source).replace(/^["']|["']$/g, ""));
      return keys.includes("title") || keys.includes("component")
        ? inner
        : null;
    };
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      found = unwrap(node.expression);
      return;
    }
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      found = unwrap(node.initializer);
    }
  });
  return found;
}

/**
 * 把 import 说明符解析成绝对路径（只为比对「是不是同一个文件」）。
 *
 * 只认两种写法：同目录 / 上级的相对路径（`./x`、`../x`）与仓库别名
 * （`~/components/ui/x`）—— 与 `coverage-ledger.mjs` 的 `componentTargetsOf`
 * 同一口径（那一条按同样两种写法算「谁是这个组件的 story」）。
 * @param {string} spec
 * @param {string} fromDir
 * @param {string} repoRoot
 * @returns {string | null}
 */
function resolveSpecifier(spec, fromDir, repoRoot) {
  const base = spec.startsWith("~/")
    ? path.join(repoRoot, "src", spec.slice(2))
    : spec.startsWith(".")
      ? path.resolve(fromDir, spec)
      : null;
  if (base === null) return null;
  const withSlash = base.replace(/\\/g, "/");
  /* 说明符通常不带扩展名，比对的是**文件**：按 `.tsx` / `.ts` 试出真实存在的那份。 */
  for (const ext of ["", ".tsx", ".ts"]) {
    if (fs.existsSync(withSlash + ext)) return fs.realpathSync(withSlash + ext);
  }
  return withSlash;
}

/**
 * 故事文件的「面」：title / 连到 meta 上的组件 / 给了哪些 args。
 *
 * `args` 只取**顶层** 的 `render` / `args` 之外的 args 对象（meta 上的与每个
 * story 上的都算），因为判据问的是「画布被拉起时组件拿到了什么」。
 * @param {ts.SourceFile} source
 * @returns {{title: string | null, component: string | null, args: Set<string>}}
 */
export function storySurface(source) {
  const meta = metaObjectOf(source);
  /** @type {string | null} */
  let title = null;
  /** @type {string | null} */
  let component = null;
  /** @type {Set<string>} */
  const args = new Set();
  /** @param {ts.ObjectLiteralExpression | null} obj */
  const readArgs = (obj) => {
    if (obj === null) return;
    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      if (prop.name.getText(source) !== "args") continue;
      if (!ts.isObjectLiteralExpression(prop.initializer)) continue;
      for (const field of prop.initializer.properties) {
        if (field.name === undefined) continue;
        args.add(propName(field.name.getText(source)));
      }
    }
  };
  if (meta !== null) {
    for (const prop of meta.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const key = propName(prop.name.getText(source));
      if (key === "title" && ts.isStringLiteral(prop.initializer)) {
        title = prop.initializer.text;
      }
      if (key === "component" && ts.isIdentifier(prop.initializer)) {
        component = prop.initializer.text;
      }
      if (key === "args") readArgs(meta);
    }
  }
  /* 每个具名 story 上的 args（`export const X: Story = { args: { … } }`）。 */
  walk(source, (node) => {
    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const decl of node.declarationList.declarations) {
        if (
          decl.initializer !== undefined &&
          ts.isObjectLiteralExpression(decl.initializer)
        ) {
          readArgs(decl.initializer);
        }
      }
    }
  });
  return { title, component, args };
}

/** `"title"` / `title` 归一成不带引号的形态。
 *  @param {string} text @returns {string} */
function propName(text) {
  return text.replace(/^["']|["']$/g, "");
}

/**
 * 本文件从别处 import 进来的绑定：名字 → 它来自哪个说明符。
 *
 * 用途是判「`component:` 连的是不是**这个组件文件**导出的东西」—— 与
 * `coverage-ledger.mjs` 的 `componentTargetsOf` 同一口径（认同目录相对路径与
 * `~/components/...` 别名），不引入符号解析。
 * @param {ts.SourceFile} source
 * @returns {Map<string, string>} 绑定名 → 模块说明符
 */
export function importedBindings(source) {
  /** @type {Map<string, string>} */
  const out = new Map();
  walk(source, (node) => {
    if (
      !ts.isImportDeclaration(node) ||
      !ts.isStringLiteral(node.moduleSpecifier)
    ) {
      return;
    }
    const spec = node.moduleSpecifier.text;
    const named = node.importClause?.namedBindings;
    if (named !== undefined && ts.isNamedImports(named)) {
      for (const el of named.elements) out.set(el.name.text, spec);
    }
  });
  return out;
}

/**
 * 组件源码里**必填**的 props（出参类型里没有 `?`、联合里也没有 `undefined`）。
 *
 * 只读 `ComponentProps<typeof C>` 上那一层：包裹后的形态（`PropsWithChildren`、
 * 交叉类型）读不到就不判 —— 宁可漏，不可误伤（判错一次，成员会把这条判据删掉）。
 * @param {ts.SourceFile} source
 * @returns {string[]}
 */
export function requiredProps(source) {
  /** @type {string[]} */
  const out = [];
  walk(source, (node) => {
    if (!ts.isTypeAliasDeclaration(node)) return;
    const keys = componentPropKeys(node.type);
    if (keys === null) return;
    for (const key of keys) out.push(key);
  });
  return out;
}

/**
 * 从 `ComponentProps<typeof C>`（可再叠 `["轴"]`）里取**必填**的属性名。
 *
 * 刻意只认这一种形态：包裹过的（`PropsWithChildren<…>` / 交叉类型 / `Omit<…>`）
 * 一律给 `null` 表示「读不到」—— 判据宁可漏，也不能误报（误报一次，成员就会把
 * 它删掉，那比没有判据更糟）。要读穿这些包裹得有类型程序，那是另一层的事。
 * @param {ts.TypeNode} type
 * @returns {string[] | null} 读不到时给 null
 */
function componentPropKeys(type) {
  if (!ts.isTypeReferenceNode(type)) return null;
  const name = type.typeName.getText();
  if (name === "Partial") return []; // 全可选，没有必填项
  /* `ComponentProps<typeof C>` 的成员住在组件的类型上 —— 静态读不到，交给调用处
     按「不判」处理（见文件头的已知边界）。 */
  return null;
}

/**
 * 这个故事文件里**真正用到**的本目录组件（`null` = 一个都没有接上）。
 *
 * 判据分两步，都不引类型程序：
 *  ① 本目录的组件文件里，哪些是**由这个故事文件 import 进来的**；
 *  ② 那些绑定在文件里**被用到**（不是只 import 了没用 —— 那说明它只是个摆设）。
 *
 * 为什么按 import 的模块解析而不按 `component:` 那一行：适配件是正当写法
 * （受控状态 / 值源解析 / 把复合件摆成一行），判「谁连在 meta 上」会把它们
 * 一起判红。真正要拦的是「画布上摆了东西，而它跟这个组件无关」。
 * @param {ts.SourceFile} source
 * @param {string} storyFile
 * @param {string} componentFile 本目录的组件源码（与故事文件同名的那份）
 * @param {string} repoRoot
 * @returns {string | null}
 */
function componentUsedIn(source, storyFile, componentFile, repoRoot) {
  const target = fs.realpathSync(componentFile);
  const imported = importedBindings(source);
  for (const [name, spec] of imported) {
    const resolved = resolveSpecifier(spec, path.dirname(storyFile), repoRoot);
    if (resolved === null || resolved !== target) continue;
    if (identifierUsed(source, name)) return name;
  }
  return null;
}

/**
 * 标识符在文件里被用到（排除 import 那一行本身）。
 *
 * 与 `cva-variant-source.mjs` 的 `importedNames` 同一口径：只认具名 import 的
 * **绑定名**，不看它在哪用 —— 判的是「这个文件有没有真的碰过它」。
 * @param {ts.SourceFile} source
 * @param {string} name
 * @returns {boolean}
 */
function identifierUsed(source, name) {
  let used = false;
  walk(source, (node) => {
    if (used || !ts.isIdentifier(node) || node.text !== name) return;
    /* import 子句里的那几个标识符不算「用到」。 */
    const parent = node.parent;
    if (parent !== undefined && ts.isImportSpecifier(parent)) return;
    if (parent !== undefined && ts.isImportClause(parent)) return;
    used = true;
  });
  return used;
}

/**
 * 组件的**必填 props**（首层）里，这个故事文件一个都没给的。
 *
 * 这是「画布上会抛」那条风险的判据：`interface XProps { title: string }` 而 story
 * 的 `args` 里没有它时，组件在渲染期读到 `undefined`（`Cannot read properties of
 * undefined`），表现与 §16.2.3.4 那轮踩的坑同形 —— 侧栏有故事、画布一片空白。
 *
 * 只认**本文件里**把必填项写得出来的 props 接口（`interface XProps { … }` 里
 * 没有 `?` 且没有 `| undefined` 的那几项）；`ComponentProps<typeof C>` 那一层要
 * 类型程序，读不到就**不判**（宁可漏，不可误伤）。
 * @param {string} storyFile
 * @param {Set<string>} givenArgs 该故事文件给出的 args 名
 * @returns {string[]}
 */
export function missingRequiredArgs(storyFile, givenArgs) {
  const componentFile = componentSourceOf(storyFile);
  if (componentFile === null) return [];
  const component = ts.createSourceFile(
    componentFile,
    fs.readFileSync(componentFile, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  /** 该组件**用到的那些 props 接口**的名字。
   *
   * 两条来源合起来，缺一条都会漏判或误伤：
   *  · 组件文件里**引用了的** `XProps`（`ImageViewerProps` 这种显式写法）；
   *  · 组件文件里**导出、并有用到它某一项**的 `XProps` —— 组件自己不写参数类型是
   *    常见形态（`function FilePicker({ … }: FilePickerProps)` 才显式，而
   *    「接口写在组件里、函数签名靠推断」同样常见），只认引用会让前者那类判据
   *    在**这一批的多数文件上**静默不判（漏报，最坏的一种）。
   *
   * 「有用到它某一项」这一条过滤是必需的：同目录里的**兄弟接口**（`Card` 的
   * 六个 slot、`Sidebar` 的二十来件）也住在同目录，一起算进来的话每个 story 都会
   * 被判「缺 slot」，而那不是 story 的错。 */
  const referenced = referencedPropsInterfaces(component, componentFile);
  if (referenced.size === 0) return [];
  /** @type {string[]} */
  const required = [];
  for (const file of [component, ...siblingTypeSources(componentFile)]) {
    walk(file, (node) => {
      if (!ts.isInterfaceDeclaration(node)) return;
      if (!referenced.has(node.name.text)) return;
      for (const member of node.members) {
        if (!ts.isPropertySignature(member) || member.name === undefined)
          continue;
        if (member.questionToken !== undefined) continue;
        if (member.type !== undefined && typeAllowsUndefined(member.type))
          continue;
        required.push(member.name.getText(file));
      }
    });
  }
  return [...new Set(required)].filter((name) => !givenArgs.has(name));
}

/**
 * 组件文件里**被引用到的** props 接口名（`XProps` / `ComponentProps<typeof C>`）。
 *
 * 覆盖两种写法：显式写 `ImageViewerProps`，或写
 * `ComponentProps<typeof ImageViewer>`（后者解析不到接口名时返回空集 = 不判）。
 * @param {ts.SourceFile} component
 * @param {string} componentFile
 * @returns {Set<string>}
 */
function referencedPropsInterfaces(component, componentFile) {
  /** @type {Set<string>} */
  const out = new Set();
  /* ① 组件文件里被引用的名字（类型注解、`ComponentProps<…>` 里的实参…）。 */
  walk(component, (node) => {
    if (!ts.isIdentifier(node)) return;
    if (TS_PROPS_NAME.test(node.text)) out.add(node.text);
  });
  /* ② 同目录里**导出的** props 接口，且它的字段名在组件文件里出现过
     （`FilePickerProps.onPick` 这种：接口在兄弟模块，组件只解构那几个字段）。 */
  const identifiers = new Set();
  walk(component, (node) => {
    if (ts.isIdentifier(node)) identifiers.add(node.text);
  });
  for (const file of siblingTypeSources(componentFile)) {
    walk(file, (node) => {
      if (!ts.isInterfaceDeclaration(node)) return;
      if (!TS_PROPS_NAME.test(node.name.text)) return;
      if (!hasExportModifier(node)) return;
      const touched = node.members.some(
        (m) =>
          ts.isPropertySignature(m) &&
          m.name !== undefined &&
          identifiers.has(propName(m.name.getText(file))),
      );
      if (touched) out.add(node.name.text);
    });
  }
  return out;
}

/** 节点带 `export` 修饰符。
 *  @param {ts.Node} node @returns {boolean} */
function hasExportModifier(node) {
  /* `modifiers` 只长在 `HasModifiers` 那几个节点上，先判一下再读。 */
  if (!ts.canHaveModifiers(node)) return false;
  return (
    ts
      .getModifiers(node)
      ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}

/** 读同目录里其余 `.ts` 兄弟模块（可能放着 props 接口）。
 *  @param {string} componentFile
 *  @returns {ts.SourceFile[]} */
function siblingTypeSources(componentFile) {
  const dir = path.dirname(componentFile);
  /** @type {ts.SourceFile[]} */
  const out = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".ts")) continue;
    if (entry.endsWith(".d.ts") || entry.endsWith(".test.ts")) continue;
    const full = path.join(dir, entry);
    out.push(
      ts.createSourceFile(
        full,
        fs.readFileSync(full, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      ),
    );
  }
  return out;
}

/** `XProps` 形态的接口名（`Props` 结尾、且不是 `ComponentProps` 那种工具类型）。 */
const TS_PROPS_NAME = /^[A-Z][A-Za-z0-9]*Props$/;

/** 类型里含 `undefined`（`string | undefined` / `undefined`）即视为可缺省。
 *  @param {ts.TypeNode} type @returns {boolean} */
function typeAllowsUndefined(type) {
  let allows = false;
  /** @param {ts.Node} node */
  const check = (node) => {
    if (node.kind === ts.SyntaxKind.UndefinedKeyword) allows = true;
  };
  /** @param {ts.Node} node */
  const visit = (node) => {
    check(node);
    ts.forEachChild(node, visit);
  };
  /* 只往里走一层联合就够了：`X | undefined`，以及 `Partial<…>` 已在外面被排除。 */
  if (ts.isUnionTypeNode(type)) {
    for (const t of type.types) check(t);
    return allows;
  }
  visit(type);
  return allows;
}

/** 故事同目录的组件源码（`badge.stories.tsx` → `badge.tsx`，再试 `.ts`）。
 *  @param {string} storyFile @returns {string | null} */
function componentSourceOf(storyFile) {
  const base = storyFile.replace(/\.stories\.tsx$/, "");
  for (const ext of [".tsx", ".ts"]) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  return null;
}

/**
 * 目录里**多数**故事用的那个分组前缀（`title` 的第一段）。
 *
 * 「多数」而不是「第一个」：一条偏离即可被点名，而口径本身不该由先扫到的那份
 * 决定（目录顺序不稳定，判据就跟着飘）。
 * @param {{file: string, title: string | null}[]} stories
 * @returns {string | null}
 */
export function dominantGroup(stories) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const s of stories) {
    const group = groupOf(s.title);
    if (group === null) continue;
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  /** @type {string | null} */
  let best = null;
  let bestCount = 0;
  /* 计数相同时取字典序小的那个，保证同一输入恒定同结论。 */
  for (const [group, count] of [...counts].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    if (count > bestCount) {
      best = group;
      bestCount = count;
    }
  }
  return best;
}

/** `title` 的第一段（分组前缀）；没有 title 时给 null。
 *  @param {string | null} title @returns {string | null} */
function groupOf(title) {
  if (title === null || !title.includes("/")) return null;
  return title.split("/")[0] ?? null;
}

/**
 * 扫一遍所有故事文件，返回「面」的盘点结果。
 * @param {{componentsRoot: string, repoRoot: string}} input
 * @returns {StorySurfaceReport}
 */
export function storySurfaces({ componentsRoot, repoRoot }) {
  /** @type {string[]} */
  const files = [];
  /** @param {string} dir */
  const collect = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        collect(full);
      } else if (entry.name.endsWith(".stories.tsx")) {
        files.push(full);
      }
    }
  };
  collect(componentsRoot);

  /** @type {StorySurfaceEntry[]} */
  const stories = [];
  for (const file of files.sort()) {
    const rel = path.relative(repoRoot, file).split(path.sep).join("/");
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const surface = storySurface(source);
    /* 本目录的组件是否**真的出现在这个故事文件里**（按 import + 使用判，见文件
       头第 ② 条：适配件是正当写法，判的是「它里面有没有真组件」）。 */
    const storyBase = file.replace(/\.stories\.tsx$/, "");
    const sourceFile = [".tsx", ".ts"]
      .map((ext) => storyBase + ext)
      .find((cand) => fs.existsSync(cand));
    const usesRealComponent =
      sourceFile !== undefined &&
      componentUsedIn(source, file, sourceFile, fs.realpathSync(repoRoot)) !==
        null;
    stories.push({
      file: rel,
      title: surface.title,
      component: surface.component,
      args: [...surface.args].sort(),
      group: groupOf(surface.title),
      matchesDir: usesRealComponent,
    });
  }

  /* 分组口径**逐目录**定：`ui/` 是 `UI/*`、`studio/` 与 `workshop/` 各有自己的前缀
     （它们的组件不属于基元那一族）。 */
  /** @type {Map<string, {file: string, title: string | null}[]>} */
  const byDir = new Map();
  for (const s of stories) {
    const dir = path.dirname(s.file);
    const list = byDir.get(dir) ?? [];
    list.push({ file: s.file, title: s.title });
    byDir.set(dir, list);
  }
  /** @type {{file: string, group: string, expected: string}[]} */
  const groupDeviations = [];
  for (const [, list] of byDir) {
    const expected = dominantGroup(list);
    if (expected === null) continue;
    for (const s of list) {
      const group =
        s.title?.includes("/") === true ? s.title.split("/")[0] : null;
      if (group !== expected) {
        groupDeviations.push({
          file: s.file,
          group: group ?? "（没有 title）",
          expected,
        });
      }
    }
  }

  return {
    stories,
    missingTitle: stories.filter((s) => s.title === null).map((s) => s.file),
    missingComponent: stories.filter((s) => !s.matchesDir).map((s) => s.file),
    groupDeviations,
  };
}
