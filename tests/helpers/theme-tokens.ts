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
 *
 * 判据能覆盖本文件关心的全部失效模式：别名取错态（浅/深相同）、引用成环、
 * 引用到一个未定义的 token。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import postcss, { type Declaration } from "postcss";

const require = createRequire(import.meta.url);
const twModule = require("@tailwindcss/postcss") as {
  default?: () => postcss.AcceptedPlugin;
};
const tailwind =
  twModule.default ?? (twModule as unknown as () => postcss.AcceptedPlugin);

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
    if (!p) return false;
    // 去掉 `:not(.dark)` 这段后，余下必须是**单个**「挂在根上」的简单选择器
    const stripped = p.replace(/:not\([^)]*\)/g, "");
    if (!/^(:root|:host|\.dark)$/.test(stripped)) return false;
    return true;
  });
}

/** 该选择器在指定主题下是否命中 `<html>`。 */
function matchesTheme(selector: string, dark: boolean): boolean {
  return selector.split(",").some((raw) => {
    const p = raw.trim();
    if (!selectsHtml(p)) return false;
    const excludesDark = p.includes(":not(.dark)");
    if (excludesDark) return !dark;
    if (p.includes(".dark")) return dark;
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

/**
 * 这三条 utility 是**判据自己要读的**（`theme-dark-token-cascade.test.ts` 里那三条
 * `css` 正则的来源）。Tailwind v4 只把「在源码里被用到的」类编进产物，所以关掉自动扫描之后
 * 必须显式点名，否则 `.bg-card {}` 那条规则根本不出现、断言全红。
 *
 * ⚠️ 新增一条「某个 utility 编成了什么」的断言时，**来这里补一行类名**，否则那条判据会因为
 * 产物里没有这个类而红 —— 那是正确形态的红（它在告诉你：这条断言依赖的类没被固定住）。
 */
const PINNED_UTILITY_CLASSES = [
  "bg-card",
  "bg-popover",
  "border-border",
] as const;

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
 * 找不到 `@import "tailwindcss"` 那一行时**抛错而不是静默按全量扫描编一遍**：后者会让这条
 * 优化悄悄失效、表现是「某天起 suite 又间歇红」，而那是最难归因的一类。
 */
export function withPinnedSources(cssText: string): string {
  const noAutoScan = cssText.replace(
    /^@import\s+["']tailwindcss["'](?:\s+source\([^)]*\))?\s*;/m,
    '@import "tailwindcss" source(none);',
  );
  if (noAutoScan === cssText) {
    throw new Error(
      'globals.css 里找不到 @import "tailwindcss" 那一行，无法关掉全仓源码扫描。' +
        "本文件的编译特意依赖这一行（理由见 withPinnedSources 的注释）；" +
        "要么把它改回可识别的形态，要么同步这里的匹配式 —— 别放开扫描凑合，那会把 #1336 的耗时请回来。",
    );
  }
  const pins = PINNED_UTILITY_CLASSES.map(
    (cls) => `@source inline("${cls}");`,
  ).join("\n");
  // 把项目自己写的 `@theme` 改成 `@theme static`：v4 默认会**按用法 tree-shake** 主题变量
  // ——「某个 token 有没有进产物」取决于全仓哪里用到了它，而这批用例读的是 token 的取值与
  // 级联，不该被这件事左右（实测反例：关掉扫描后 `--color-primary-strong` 的浅色档消失，
  // `sidebar-state-contrast` 的「浅色：选中底上的正文与指示条都够亮」当场红，而深色档因为
  // 是手写在 `.dark {}` 里的所以还在 —— 这种「一半在、一半被摇掉」的形状比全红更难归因）。
  // static 只**加**声明、不改任何已有值（逐条比对过两态产物：同名不同值 = 0 条）。
  const staticTheme = noAutoScan.replace(
    /@theme(\s+inline)?\s*\{/g,
    "@theme$1 static {",
  );
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

/** 一次拿到浅色 / 深色两态的取值器（`beforeAll` 里 `await` 用）。 */
export async function loadThemeTokens(): Promise<{
  light: ThemeTokens;
  dark: ThemeTokens;
  css: string;
}> {
  const css = await compiledGlobalsCss();
  return {
    light: themeTokens("light", css),
    dark: themeTokens("dark", css),
    css,
  };
}

/** 为指定主题构建 token 取值器。 */
export function themeTokens(
  theme: "light" | "dark",
  cssText: string,
): ThemeTokens {
  const dark = theme === "dark";
  const root = postcss.parse(cssText);

  interface Entry {
    value: string;
    layered: boolean;
    order: number;
  }
  const values = new Map<string, Entry>();
  let order = 0;

  root.walkDecls((decl: Declaration) => {
    const parent = decl.parent;
    if (parent?.type !== "rule") return;
    const rule = parent;
    if (!matchesTheme(rule.selector, dark)) return;
    order += 1;
    // `@layer` 内的声明优先级低于层外声明；同一层内**后写胜出**。
    const atrule = rule.parent;
    const layered =
      atrule?.type === "atrule" && /^layer/i.test(atrule.name ?? "");
    const prev = values.get(decl.prop);
    const wins =
      !prev ||
      (prev.layered && !layered) ||
      (prev.layered === layered && prev.order < order);
    if (wins) values.set(decl.prop, { value: decl.value, layered, order });
  });

  /** 解析 `var()` 链。 */
  function resolve(name: string, seen: Set<string>): string | undefined {
    const entry = values.get(name);
    if (!entry) return undefined;
    if (seen.has(name))
      throw new Error(`token 引用成环：${[...seen, name].join(" → ")}`);
    const next = new Set(seen).add(name);
    return resolveValue(entry.value, next);
  }

  function resolveValue(value: string, seen: Set<string>): string {
    // 逐个替换 `var(--name[, fallback])`
    return value.replace(
      /var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g,
      (_all, ref: string, fallback?: string) => {
        const v = resolve(ref, seen);
        if (v !== undefined && v !== "") return v;
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
