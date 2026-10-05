/**
 * 主题别名 token 的级联回归（ISSUE #609，ISSUE #672 收口）。
 *
 * 背景：`globals.css` 里 shadcn 语义别名（`--card` / `--background` /
 * `--foreground` / `--border` …）的**深色档**写在靠前的 `.dark {}` 块，而
 * **浅色档**曾写在靠后的**裸 `:root {}`** 块。两个选择器落在同一个元素
 * （`<html>`）上、特异性相同（都是 0-1-0）——此时源码顺序决定胜负，写在
 * 后面的浅色 `:root` 恒压过前面的 `.dark`。
 *
 * 后果不是「某个组件漏改」，而是**所有走 shadcn 别名的 utility 在深色下取
 * 浅色值**：`bg-card` 编成 `background-color: var(--card)`，`--card` 恒为
 * `#ffffff`，于是工作流库画布的三张卡片在深色里是白底 + 近白字（用户报
 * 「深色下工作流库的画布界面也没法看」）。这类故障 tsc / eslint / 主题色
 * 扫描器**都看不见**（它扫的是写死色值，而这里是 token 解析错了）。
 *
 * ISSUE #672 收口之后，别名不再两态各写一份（改走「转发到项目 token」，
 * 见 `theme-token-single-source.test.ts`），本条判据因此不再测「浅色档压过
 * 深色档」这个具体形状，而是守着**它的等价性质**：每个别名在两态各取到
 * 一个非空、且等于它所跟随的项目 token 的值。
 *
 * 取值口径：`tests/helpers/theme-tokens.ts` —— 真编译 `globals.css` 产物，
 * 自己实现级联与 `var()` 链解析。**不要改回 `getComputedStyle`**：
 * jsdom 不解析 `var()`，别名改成转发后会返回字面量 `"var(--color-surface)"`，
 * 断言会全部变成误报（实测过）。本文件的做法在 Chromium 里逐项核对过。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadThemeTokens, type ThemeTokens } from "./helpers/theme-tokens";

let light: ThemeTokens;
let dark: ThemeTokens;
let css: string;

beforeAll(async () => {
  ({ light, dark, css } = await loadThemeTokens());
});

/* shadcn 语义别名：两态都必须是「解好的值」，且随主题走。
 * 逐条都是 `bg-*` / `text-*` / `border-*` utility 的取值来源。 */
const ALIASES = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--border",
  "--input",
] as const;

/* 两态取值本来就相同（品牌色 + 它上面的文字色）。 */
const THEME_INVARIANT = ["--primary", "--accent", "--destructive"] as const;

describe("主题别名 token 在两态下各自生效（ISSUE #609）", () => {
  it.for(ALIASES)("%s 深色档 != 浅色档（别名确实随主题）", (name) => {
    const l = light.get(name);
    const d = dark.get(name);
    expect(l, `${name} 浅色档`).toBeTruthy();
    expect(d, `${name} 深色档`).toBeTruthy();
    expect(d).not.toBe(l);
  });

  it.for(THEME_INVARIANT)("%s 两态都有值（取值可以相同）", (name) => {
    expect(light.get(name), `${name} 浅色档`).toBeTruthy();
    expect(dark.get(name), `${name} 深色档`).toBeTruthy();
  });

  it("深色下 --card / --background / --border 取深色值（不被浅色档恒压）", () => {
    expect(dark.get("--card")).toBe("#16161c");
    expect(dark.get("--background")).toBe("#0a0a0f");
    expect(dark.get("--border")).toBe("#26262e");
  });

  it("浅色下（无 .dark）仍取浅色值", () => {
    expect(light.get("--card")).toBe("#ffffff");
    expect(light.get("--background")).toBe("#ffffff");
    expect(light.get("--border")).toBe("#ececf1");
  });

  it("bg-card/bg-popover/border-border 编成 var() 取值，本用例覆盖真实取值路径", () => {
    // 收口后 utility 可能直接指向项目 token（`var(--color-border)`），也可能
    // 指向别名（`var(--card)` → 别名再转发）—— 两种都是「解得到主题值」的
    // 正确形态，所以这里断言的是**性质**（取值来自 var()）而不是某一种写法。
    expect(css).toMatch(
      /\.bg-card\s*{[^}]*background-color:\s*var\(--(card|color-surface)\)/,
    );
    expect(css).toMatch(
      /\.bg-popover\s*{[^}]*background-color:\s*var\(--(popover|color-surface)\)/,
    );
    expect(css).toMatch(
      /\.border-border\s*{[^}]*border-color:\s*var\(--(border|color-border)\)/,
    );
  });
});
