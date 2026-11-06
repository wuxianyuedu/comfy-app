/**
 * tests/helpers/theme-tokens.ts — 主题 token 的「真解析」取值器（测试基建）。判据：别名取错态、引用成环、
 * 引用到未定义 token。jsdom 不解析 `var()` 链（返回字面量 `var(--x)`，断言全误报），所以用 Tailwind 的
 * PostCSS 插件把 `globals.css` 编成产物，按节点顺序取命中 `<html>` 的声明（层外>层内、同层后写胜出）再递归求值 `var()`。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import postcss, { type Declaration } from "postcss";

const require = createRequire(import.meta.url);
/* SAFETY: 类型断言已复核 */
const twModule = require("@tailwindcss/postcss") as {
  default?: () => postcss.AcceptedPlugin;
};
/* SAFETY: 类型断言已复核 */
const tailwind = twModule.default ?? (twModule as unknown as () => postcss.AcceptedPlugin);

const GLOBALS_CSS = path.resolve(__dirname, "../../src/app/globals.css");

/**
 * 选择器能否命中 `<html>`（本项目的主题类挂在这个元素上）。只接受编译产物里实际出现的四种：
 * `:root` / `:host`（两态都命中）、`.dark`（仅深色，且必须**不带**后代/子选择器）、`:root:not(.dark)`
 * （仅浅色）、`:root, :host` 逗号组（逐个判）。带后代 / 子选择器（`.dark select`）的一律不算 —— 那命中的是别的元素。
 */
function selectsHtml(selector: string): boolean {
  return selector.split(",").some((raw) => {
    const p = raw.trim();
    if (!p) {
      return false;
    }
    // 去掉 `:not(.dark)` 这段后，余下必须是**单个**「挂在根上」的简单选择器
    const stripped = p.replaceAll(/:not\([^)]*\)/g, "");
    if (!/^(?::root|:host|\.dark)$/.test(stripped)) {
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

export type ThemeTokens = {
  /** 取值：解析完整的自定义属性值；未定义为 `undefined`。 */
  get(name: string): string | undefined;
  /** 该 token 是否在某一态下被声明过。 */
  has(name: string): boolean;
  /** 该 token 是否来自层内（`@layer`）声明。 */
  layered(name: string): boolean;
  /** 原始声明（未解析 `var()`），用于看「引用的是谁」。 */
  raw(name: string): string | undefined;
};

let compiled: Promise<string> | null = null;

/** `compiledCssPinnedTo` 的缓存：键 = 扫描面（目录列表 + 点名的类）。 */
const pinnedCompiles = new Map<string, Promise<string>>();

/**
 * 这三条 utility 是**判据自己要读的**（`theme-dark-token-cascade.test.ts` 里那三条 `css` 正则的来源）。
 * Tailwind v4 只把源码里用到的类编进产物，关掉自动扫描后必须显式点名，否则 `.bg-card {}` 不出现。
 * ⚠️ 新增「某个 utility 编成了什么」的断言时来这里补一行类名 —— 那条判据会红，而那是正确形态的红。
 */
/* SAFETY: 类型断言已复核 */
const PINNED_UTILITY_CLASSES = [
  "bg-card",
  "bg-popover",
  "border-border",
  /* 模态遮罩的底色（`--color-scrim` → `bg-scrim`）。`dialog-backdrop-contrast`
     要读「遮罩压在本应用背景上之后还剩多少对比」，就得让这条 utility 真进产物。 */
  "bg-scrim",
] as const;

/**
 * 把 CSS 里**已有的 `@source` 指令全部剥掉**（生产两棵根、`@source inline(...)` 点名、`@source not`）。
 * 为什么必须剥：`globals.css` 自带 `@source "../../src"` 与 `@source "../../.storybook"`；每一遍编译要的不是
 * 「生产扫什么」，而是「我给定的输入会编出什么」—— 留着它，钉成 `docs` 的那一遍会连 src 一起扫，差集判据失效。
 */
export function stripSourceDirectives(cssText: string): string {
  return cssText.replaceAll(/^\s*@source\b[^\n]*\n/gm, "");
}

/**
 * 把「扫全仓」那一行换成「谁都不扫」。两种形状都要接住：文件还没做默认拒绝时改写那一行；文件**已经**写了
 * `source(none)` 时改写是空操作，不能当成「找不到」而抛。真正的失败只有一种：整行 `@import "tailwindcss"`
 * 都不在 —— 静默按别的方式编一遍会让这条优化悄悄失效，表现是「某天起 suite 又间歇红」，最难归因。
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
 * 把「扫全仓找类名」换成「只认上面那几条」（ISSUE #1336）：全量扫描 21109ms（隔离跑 7.2s）会让两个
 * suite 的 `beforeAll` 撞 `hookTimeout` 全红，固定输入源后 121ms 且不再随 src 谁用过哪个类变。
 * 差异不改已有值（同名不同值 = 0 条）：少了 238 条默认调色板变量（曾摇没 `--color-primary-strong` 浅色档），多了 `@theme static`。
 */
export function withPinnedSources(cssText: string): string {
  const noAutoScan = disableAutoScan(stripSourceDirectives(cssText));
  const pins = PINNED_UTILITY_CLASSES.map((cls) => `@source inline("${cls}");`).join("\n");
  // 把项目自己写的 `@theme` 改成 `@theme static`：v4 默认按用法 tree-shake 主题变量 ——
  // 「某个 token 有没有进产物」会取决于全仓哪里用到它，而这批用例读的是取值与级联。
  // 实测反例：关掉扫描后 `--color-primary-strong` 浅色档消失，`sidebar-state-contrast` 当场红，
  // 深色档因手写在 `.dark {}` 里还在 —— 「一半在、一半被摇掉」比全红更难归因。
  // static 只**加**声明、不改已有值（同名不同值 = 0 条）。
  const staticTheme = noAutoScan.replaceAll(
    /@theme(?<inline>\s+inline)?\s*\{/g,
    "@theme$<inline> static {",
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

/**
 * 只钉「扫描目录」、不做别的加工 —— 回答「这一批源文件被扫进产物时会生成哪些类」（`compiledGlobalsCss`
 * 收成 4 条 utility，结构上看不见「某枚 arbitrary 是否被引擎解出来」）。保留 `source(none)`（自动全扫 13–19.5s、满载 70s+）
 * 先剥掉自带的 `@source` 根；不加 `@theme static`、不钉 utility 名。目录按 CSS 所在目录 `src/app` 解析，仓库根写 `../../<dir>`。
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
 * 为什么从 helper 出：`themeTokens` 已解析过同一份产物，判据再拿正则啃选择器会有两套转义/分组口径。
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

  type Entry = {
    layered: boolean;
    order: number;
    value: string;
  };
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
    const layered = atrule?.type === "atrule" && /^layer/i.test(atrule.name);
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
    return value.replaceAll(
      /var\(\s*(?<ref>--[a-zA-Z0-9-]+)\s*(?:,\s*(?<fallback>[^()]*(?:\([^()]*\)[^()]*)*))?\)/g,
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
