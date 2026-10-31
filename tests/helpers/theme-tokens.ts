/**
 * tests/helpers/theme-tokens.ts — 主题 token 的「真解析」取值器（测试基建）
 * ===========================================================================
 *
 * 为什么不直接用 jsdom 的 `getComputedStyle`：**jsdom 不解析 `var()` 链**。
 * 别名改成 `--card: var(--color-surface)` 之后，jsdom 返回的是字面量
 * `"var(--color-surface)"` 而不是 `#ffffff`，于是「两态取值是否不同」这类
 * 断言会全部误报（实测：`expected 'var(--color-bg)' not to be 'var(--color-bg)'`）。
 * 真实浏览器解析是对的（本文件的做法在 Chromium 里逐一核对过），但那不适合
 * 每个 `pnpm test` 都拉起浏览器。
 *
 * 所以这里自己实现两件事，判据不依赖运行时的级联实现：
 *
 * 1. **级联**：用 Tailwind 的 PostCSS 插件把 `globals.css` 编成产物，按
 *    PostCSS 的节点顺序收集 `:root` / `.dark` / `:root:not(.dark)` /
 *    `:root, :host` 等**能命中 `<html>` 的选择器**里的自定义属性声明，
 *    按「层外声明 > 层内声明」「同层内后写胜出」的规则算出有效值。
 * 2. **引用解析**：`var(--x)` 递归求值，带环检测与 fallback 支持。
 *
 * 编的是**固定输入源**的那份产物（`withPinnedSources`）：既不是「全仓扫类名」那一遍
 * （实测 21109ms → 121ms，且产物不再随无关源码变），也不是源码文本本身 —— 判据读的还是
 * Tailwind 真编出来的级联结果，口径不变。
 * `globals.css` 现在自带**两棵生产扫描根**（`@source`），那两个入口都会先把它们剥掉再钉自己
 * 的输入 —— 不剥就成了「theme 判据顺带扫全 src」，#1336 那笔账会以另一种形状回来。
 *
 * 本文件另有**一个**入口不走这条加工：`compiledCssPinnedTo`，它按参数把扫描面钉回具体目录，
 * 用来回答「这一批文件被扫进产物时会生成哪些类」（token 取值判据不需要它，正文卫生判据需要）。
 *
 * 判据能覆盖本文件关心的全部失效模式：别名取错态（浅/深相同）、引用成环、
 * 引用到一个未定义的 token。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import postcss, { type Declaration } from "postcss";

const require = createRequire(import.meta.url);
const twModule = /* SAFETY: 类型断言已复核 */ require("@tailwindcss/postcss") as {
  default?: () => postcss.AcceptedPlugin;
};
/* SAFETY: 类型断言已复核 */
const tailwind = twModule.default ?? (twModule as unknown as () => postcss.AcceptedPlugin);

const GLOBALS_CSS = path.resolve(__dirname, "../../src/app/globals.css");

/**
 * 选择器能否命中 `<html>`（本项目的主题类挂在这个元素上）。
 *
 * 接受的形态只有四种（编译产物里实际出现的）：
 * - `:root` / `:host`            —— 两态都命中（`@theme` 的浅色默认档）
 * - `.dark`                      —— 仅深色；且必须**不带**后代/子选择器
 * - `:root:not(.dark)`           —— 仅浅色
 * - `:root, :host`（逗号组）      —— 逐个判
 *
 * 带后代 / 子选择器（`.dark select`）的一律不算 —— 那命中的是别的元素。
 */
function selectsHtml(selector: string): boolean {
  return selector.split(",").some((raw) => {
    const p = raw.trim();
    if (!p) {
      return false;
    }
    // 去掉 `:not(.dark)` 这段后，余下必须是**单个**「挂在根上」的简单选择器
    const stripped = p.replace(/:not\([^)]*\)/g, "");
    if (!/^(:root|:host|\.dark)$/.test(stripped)) {
      return false;
    }
    return true;
  });
}

/** 该选择器在指定主题下是否命中 `<html>`。 */
function matchesTheme(selector: string, dark: boolean): boolean {
  return selector.split(",").some((raw) => {
    const p = raw.trim();
    if (!selectsHtml(p)) {
      return false;
    }
    const excludesDark = p.includes(":not(.dark)");
    if (excludesDark) {
      return !dark;
    }
    if (p.includes(".dark")) {
      return dark;
    }
    return true; // 裸 `:root` / `:host`
  });
}

export interface ThemeTokens {
  /** 取值：解析完整的自定义属性值；未定义为 `undefined`。 */
  get(name: string): string | undefined;
  /** 该 token 是否在某一态下被声明过。 */
  has(name: string): boolean;
  /** 该 token 是否来自层内（`@layer`）声明。 */
  layered(name: string): boolean;
  /** 原始声明（未解析 `var()`），用于看「引用的是谁」。 */
  raw(name: string): string | undefined;
}

let compiled: Promise<string> | null = null;

/** `compiledCssPinnedTo` 的缓存：键 = 扫描面（目录列表 + 点名的类）。 */
const pinnedCompiles = new Map<string, Promise<string>>();

/**
 * 这三条 utility 是**判据自己要读的**（`theme-dark-token-cascade.test.ts` 里那三条
 * `css` 正则的来源）。Tailwind v4 只把「在源码里被用到的」类编进产物，所以关掉自动扫描之后
 * 必须显式点名，否则 `.bg-card {}` 那条规则根本不出现、断言全红。
 *
 * ⚠️ 新增一条「某个 utility 编成了什么」的断言时，**来这里补一行类名**，否则那条判据会因为
 * 产物里没有这个类而红 —— 那是正确形态的红（它在告诉你：这条断言依赖的类没被固定住）。
 */
const PINNED_UTILITY_CLASSES = /* SAFETY: 类型断言已复核 */ [
  "bg-card",
  "bg-popover",
  "border-border",
  /* 模态遮罩的底色（`--color-scrim` → `bg-scrim`）。`dialog-backdrop-contrast`
     要读「遮罩压在本应用背景上之后还剩多少对比」，就得让这条 utility 真进产物。 */
  "bg-scrim",
] as const;

/**
 * 把 CSS 里**已有的 `@source` 指令全部剥掉**（生产的两棵根、`@source inline(...)` 点名、
 * 以及 `@source not`）。
 *
 * 为什么必须剥：`globals.css` 现在自带 `@source "../../src"` 与 `@source "../../.storybook"`
 * （见该文件里的扫描根注释块）。本文件的每一遍编译要的都不是「生产扫什么」，而是
 * 「**我给定的那一点输入**会编出什么」—— 留着那两行，钉成 `docs` 的那一遍会连 src 一起扫进来，
 * 差集判据当场失效；而 #1336 那份「固定输入源」也会退回全量级的耗时与不可复现。
 */
export function stripSourceDirectives(cssText: string): string {
  return cssText.replace(/^\s*@source\b[^\n]*\n/gm, "");
}

/**
 * 把「扫全仓」那一行换成「谁都不扫」。
 *
 * 两种形状都要接住（这是两件事，别合成一条）：
 * - 文件还没做默认拒绝时：改写那一行；
 * - 文件**已经**写了 `source(none)`（现在就是这种）：改写是空操作，不能再当成「找不到」而抛。
 *   真正的失败只有一种：整行 `@import "tailwindcss"` 都不在 —— 那时静默按别的方式编一遍
 *   会让这条优化悄悄失效，表现是「某天起 suite 又间歇红」，而那是最难归因的一类。
 */
function disableAutoScan(cssText: string): string {
  if (!/@import\s+["']tailwindcss["']/.test(cssText)) {
    throw new Error(
      'globals.css 里找不到 @import "tailwindcss" 那一行，无法确定扫描面已关闭。' +
        "本文件的编译特意依赖这一行（理由见 withPinnedSources 的注释）；" +
        "要么把它改回可识别的形态，要么同步这里的匹配式 —— 别放开扫描凑合，那会把 #1336 的耗时请回来。",
    );
  }
  return cssText.replace(
    /^@import\s+["']tailwindcss["'](?:\s+source\([^)]*\))?\s*;/m,
    '@import "tailwindcss" source(none);',
  );
}

/**
 * 把「扫全仓找类名」换成「只认上面那几条」，两件事一起解决（ISSUE #1336）：
 *
 * 1. **耗时**：全量扫描下这份编译本机实测 **21109ms**（vitest 里隔离跑也还是要 7.2s），
 *    两个 suite 的 `beforeAll` 各编一遍，满载时排到 `hookTimeout` 之外 ⇒ 整份 suite 红、
 *    里面的用例全被记成 skipped。改成固定输入源之后实测 **121ms**（360819 → 23172 字节）。
 * 2. **可复现**：全量扫描的产物会随「src 里谁用了哪个类」变 —— 判据读的是编译产物，
 *    却间接依赖一批与主题无关的源码。钉住输入源之后，同一份 `globals.css` 永远编出同一份产物。
 *
 * 差异有两项，都不改任何已有值（逐条比对过两态产物：**同名不同值 = 0 条**）：
 *
 * - **少**：不再带「全仓哪里用到过」的默认调色板变量（`--color-red-200` 这类，实测 238 条）。
 *   三个消费方读的都是项目自己的 token，一条都不在里面 —— 但这条是**跑出来的**，不是推出来的：
 *   只做「关扫描 + 钉三条 utility」的第一版把 `--color-primary-strong` 的**浅色档**摇没了
 *   （深色档手写在 `.dark {}` 里所以还在），`sidebar-state-contrast` 当场红一条，正是下一项在补它。
 * - **多**：项目自己 `@theme` 里的变量改成**无条件声明**（`@theme static`），产物不再随
 *   无关源码里的类用法变化 —— 判据读的是 token 的取值与级联，本来就不该依赖「谁用过了它」。
 *
 * 需要「某个 arbitrary 到底有没有被编进产物」那一类判据走的是另一个入口
 * `compiledCssPinnedTo`，它**不**做下面这两件事（`@theme static` 与 utility 钉名都会改变产物形状，
 * 而那类判据要的正是「原样编一遍会出什么」）。
 */
export function withPinnedSources(cssText: string): string {
  const noAutoScan = disableAutoScan(stripSourceDirectives(cssText));
  const pins = PINNED_UTILITY_CLASSES.map((cls) => `@source inline("${cls}");`).join("\n");
  // 把项目自己写的 `@theme` 改成 `@theme static`：v4 默认会**按用法 tree-shake** 主题变量
  // ——「某个 token 有没有进产物」取决于全仓哪里用到了它，而这批用例读的是 token 的取值与
  // 级联，不该被这件事左右（实测反例：关掉扫描后 `--color-primary-strong` 的浅色档消失，
  // `sidebar-state-contrast` 的「浅色：选中底上的正文与指示条都够亮」当场红，而深色档因为
  // 是手写在 `.dark {}` 里的所以还在 —— 这种「一半在、一半被摇掉」的形状比全红更难归因）。
  // static 只**加**声明、不改任何已有值（逐条比对过两态产物：同名不同值 = 0 条）。
  const staticTheme = noAutoScan.replace(/@theme(\s+inline)?\s*\{/g, "@theme$1 static {");
  return `${staticTheme}\n${pins}\n`;
}

/**
 * 编译 `globals.css`（带缓存）。Tailwind 的 PostCSS 插件是**异步**的
 * （`LazyResult.sync()` 会抛 `Use process(css).then(cb)`），所以这里返回
 * Promise；调用方通常在 `beforeAll` 里 `await` 一次。
 */
export function compiledGlobalsCss(): Promise<string> {
  if (compiled === null) {
    const source = withPinnedSources(readFileSync(GLOBALS_CSS, "utf8"));
    compiled = postcss([tailwind()])
      .process(source, { from: GLOBALS_CSS })
      .then((r) => r.css);
  }
  return compiled;
}

/**
 * 只钉「扫描目录」、不做别的加工的编译 —— 回答「这一批源文件被扫进产物时会生成哪些类」。
 *
 * 只有一类判据需要它：**「某枚 arbitrary 候选名到底有没有被引擎解出来」**。
 * `compiledGlobalsCss()` 那份把输入源收成 4 条 utility（#1336 的耗时与可复现），
 * 因此它**结构上看不见**「文档正文里写全一枚会怎样」——那正是这类判据要问的事。
 * 这里保留 `source(none)`（全仓自动扫描空闲实测 19.5s、满载 70s 以上），把扫描面按参数逐目录
 * 钉回去，并且**先把 `globals.css` 自带的两棵生产根剥掉**（`stripSourceDirectives`）——
 * 不剥的话「钉成 docs 的那一遍」会连 src 一起扫，差集判据就在对一个混合面下结论。
 * 同样**不**加 `@theme static`、**不**钉 utility 名：那两个加工都会改变产物形状。
 *
 * 实测本机耗时（同一份 globals.css 只换扫描面，同一台机器两次采样）：src 面 1.6–2.4s、
 * docs+tests 面 4.0s、两棵生产根 1.8–3.5s、空扫描面 + 两条 inline 探针 <0.2s；
 * 而**自动全扫**是 13.0–19.5s（满载时实测 70s 以上）—— 所以默认拒绝顺手也把 CSS 编译
 * 从「十秒级」拉回「两秒级」。缓存按扫描面键，同一次 vitest 里重复取免费。
 *
 * ⚠️ 传进来的目录路径是相对 **本 CSS 文件所在目录**（`src/app`）解析的，
 * 所以仓库根要写成 `../../<dir>` —— 直接传 `docs` 会被解析成 `src/app/docs` 而静默扫空
 * （这条边界由 `docs-candidate-hygiene` 的空跑挡板兜着）。绝对路径也收（临时目录探针在用）。
 */
export function compiledCssPinnedTo(
  dirs: ReadonlyArray<string>,
  inlineClasses: ReadonlyArray<string> = [],
): Promise<string> {
  const key = `${dirs.join("|")}#${inlineClasses.join("|")}`;
  let job = pinnedCompiles.get(key);
  if (!job) {
    const base = disableAutoScan(stripSourceDirectives(readFileSync(GLOBALS_CSS, "utf8")));
    const pins = [
      ...dirs.map((dir) => `@source "${dir}";`),
      ...inlineClasses.map((cls) => `@source inline("${cls}");`),
    ].join("\n");
    job = postcss([tailwind()])
      .process(`${base}\n${pins}\n`, { from: GLOBALS_CSS })
      .then((r) => r.css);
    pinnedCompiles.set(key, job);
  }
  return job;
}

/**
 * 产物 CSS 里每条规则的**复合选择器**原样列出（一条规则一个字符串，逗号分组还在里面）。
 *
 * 为什么从 helper 出：本文件已经为 `themeTokens` 解析过同一份产物，判据再拿正则去啃选择器
 * 就会有两套转义/分组口径。要「哪些类真的被编进产物」那一类判据一律走这里。
 * ⚠️ 选择器里的 CSS 转义**没**还原（产物里怎么写就怎么给）—— 还原属于判据自己的口径。
 */
export function ruleSelectors(cssText: string): Array<string> {
  const out: Array<string> = [];
  postcss.parse(cssText).walkRules((rule: { selector: string }) => {
    out.push(rule.selector);
  });
  return out;
}

/** 一次拿到浅色 / 深色两态的取值器（`beforeAll` 里 `await` 用）。 */
export async function loadThemeTokens(): Promise<{
  css: string;
  dark: ThemeTokens;
  light: ThemeTokens;
}> {
  const css = await compiledGlobalsCss();
  return {
    light: themeTokens("light", css),
    dark: themeTokens("dark", css),
    css,
  };
}

/** 为指定主题构建 token 取值器。 */
export function themeTokens(theme: "light" | "dark", cssText: string): ThemeTokens {
  const dark = theme === "dark";
  const root = postcss.parse(cssText);

  interface Entry {
    layered: boolean;
    order: number;
    value: string;
  }
  const values = new Map<string, Entry>();
  let order = 0;

  root.walkDecls((decl: Declaration) => {
    const parent = decl.parent;
    if (parent?.type !== "rule") {
      return;
    }
    const rule = parent;
    if (!matchesTheme(rule.selector, dark)) {
      return;
    }
    order += 1;
    // `@layer` 内的声明优先级低于层外声明；同一层内**后写胜出**。
    const atrule = rule.parent;
    const layered = atrule?.type === "atrule" && /^layer/i.test(atrule.name ?? "");
    const prev = values.get(decl.prop);
    const wins =
      !prev || (prev.layered && !layered) || (prev.layered === layered && prev.order < order);
    if (wins) {
      values.set(decl.prop, { value: decl.value, layered, order });
    }
  });

  /** 解析 `var()` 链。 */
  function resolve(name: string, seen: Set<string>): string | undefined {
    const entry = values.get(name);
    if (!entry) {
      return undefined;
    }
    if (seen.has(name)) {
      throw new Error(`token 引用成环：${[...seen, name].join(" → ")}`);
    }
    const next = new Set(seen).add(name);
    return resolveValue(entry.value, next);
  }

  function resolveValue(value: string, seen: Set<string>): string {
    // 逐个替换 `var(--name[, fallback])`
    return value.replace(
      /var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g,
      (_all, ref: string, fallback?: string) => {
        const v = resolve(ref, seen);
        if (v !== undefined && v !== "") {
          return v;
        }
        return (fallback ?? "").trim();
      },
    );
  }

  return {
    get: (name) => resolve(name, new Set()),
    has: (name) => values.has(name),
    layered: (name) => values.get(name)?.layered ?? false,
    raw: (name) => values.get(name)?.value,
  };
}
