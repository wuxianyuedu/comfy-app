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
 * 编译 `globals.css`（带缓存）。Tailwind 的 PostCSS 插件是**异步**的
 * （`LazyResult.sync()` 会抛 `Use process(css).then(cb)`），所以这里返回
 * Promise；调用方通常在 `beforeAll` 里 `await` 一次。
 */
export function compiledGlobalsCss(): Promise<string> {
  if (compiled === null) {
    const source = readFileSync(GLOBALS_CSS, "utf8");
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
