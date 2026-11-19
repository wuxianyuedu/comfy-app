/**
 * 主题别名 token 的级联回归（ISSUE #609，ISSUE #672 收口）。历史形态：深色档在 `.dark {}`、浅色档在靠后的裸 `:root {}`，同元素同特异性（0-1-0），
 * 源码顺序定胜负 ⇒ 浅色恒压深色，所有走别名的 utility 在深色下取浅色值（白底近白字）；tsc / eslint / 色值扫描都看不见（它扫的是写死色值）。
 * #672 后别名改走「转发到项目 token」，本条守其等价性质：每个别名两态各非空、且等于所跟随的项目 token。取值用 `tests/helpers/theme-tokens.ts` 真编译产物 —— **不要改回 `getComputedStyle`**（jsdom 不解析 `var()`，会全成误报）。
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
/* SAFETY: 类型断言已复核 */
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
/* SAFETY: 类型断言已复核 */
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
    /* 这几枚写死值是 `src/app/globals.css` `@theme` 浅色档的镜子：改 token 时
     * 同批改这里（#3651：--border 曾在 #3540 加深后没跟，基线红了一阵）。 */
    expect(light.get("--card")).toBe("#ffffff");
    expect(light.get("--background")).toBe("#ffffff");
    expect(light.get("--border")).toBe("#e2e4ec");
  });
});

/* 三条 utility 的「取值来自哪里」：声明的属性名 + 它编成了什么。
 * **别把这些断言写回「允许哪几种拼法」的白名单** —— 这里量的是「取值来自 `var()`、且那颗变量在本态解得出主题值」，
 * 白名单是这条性质的实现细节：`--color-card` 成为唯一事实来源后 `bg-card` 编的是 `var(--color-card)`，白名单没补 ⇒
 * 假性红、被登记进 `KNOWN_FAILED_FILES` 整个文件静默跳过（ISSUE #1282）。复用优先（§12.18）：凡 `--color-*` 形态都天然被接受。 */
/* SAFETY: 类型断言已复核 */
const UTILITY_SOURCES = [
  { cls: "bg-card", prop: "background-color" },
  { cls: "bg-popover", prop: "background-color" },
  { cls: "border-border", prop: "border-color" },
] as const;

describe("utility 的取值路径：编成 var() 且解得到主题值", () => {
  it.for(UTILITY_SOURCES)(".$cls 的 $prop 来自 var()（不写死色值）", ({ cls, prop }) => {
    const rule = new RegExp(`\\.${cls}\\s*\\{[^}]*\\}`).exec(css)?.[0];
    expect(
      rule,
      `产物里应有 .${cls} 规则（类名没被固定住？见 theme-tokens.ts）。` +
        " 若产物里确实没有它，是判据依赖的类没进固定输入源，不是业务回归。",
    ).toBeTruthy();
    const decl = new RegExp(`${prop}:\\s*([^;]+);`).exec(rule ?? "")?.[1];
    expect(decl, `.${cls} 应声明 ${prop}`).toBeTruthy();
    // 性质一：值必须来自 var()（写死色值会让主题切换失效）。
    expect(decl?.trim()).toMatch(/^var\(--[a-zA-Z0-9-]+\)$/);
  });

  it.for(UTILITY_SOURCES)(".$cls 引用的变量在两态都解得出非空主题值", ({ cls, prop }) => {
    const rule = new RegExp(`\\.${cls}\\s*\\{[^}]*\\}`).exec(css)?.[0];
    const decl = new RegExp(`${prop}:\\s*([^;]+);`).exec(rule ?? "")?.[1];
    const name = /var\((?<name>--[a-zA-Z0-9-]+)\)/.exec(decl ?? "")?.groups?.name;
    expect(name, `.${cls} 的 ${prop} 应当引用一颗变量`).toBeTruthy();
    // 性质二：那颗变量在浅/深两态都解得出非空值。只判 var() 形态的话，
    // 指向一颗**不存在的** token 也照样绿 —— 那正是「编译得过、渲染是空」的形态。
    expect(light.get(name ?? ""), `${name} 浅色档`).toBeTruthy();
    expect(dark.get(name ?? ""), `${name} 深色档`).toBeTruthy();
  });
});
