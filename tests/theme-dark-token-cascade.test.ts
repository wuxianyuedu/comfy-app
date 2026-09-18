// @vitest-environment jsdom
/**
 * 主题别名 token 的级联回归（ISSUE #609）。
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
 * 判据（真编译 + 真级联，不是读源码文本）：用 Tailwind 的 PostCSS 插件编
 * 出 `globals.css` 的产物，注入 jsdom，给 `<html>` 加/去 `.dark`，断言
 * `--card` 等别名在深色下取深色值。
 *
 * 环境用 vitest 的 jsdom（`@vitest-environment` 注解）：`document` /
 * `getComputedStyle` 由 vitest 自带类型，不必为一个用例引入 `@types/jsdom`。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import postcss from "postcss";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const twModule = require("@tailwindcss/postcss") as {
  default?: () => postcss.AcceptedPlugin;
};
const tailwind =
  twModule.default ?? (twModule as unknown as () => postcss.AcceptedPlugin);

let css = "";

beforeAll(async () => {
  const source = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
  css = (
    await postcss([tailwind()]).process(source, {
      from: path.join(ROOT, "src/app/globals.css"),
    })
  ).css;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
});

/** 读出 `<html>` 上某个自定义属性在指定主题下的**生效值**。 */
function token(themeClass: string, name: string): string {
  document.documentElement.className = themeClass;
  return window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/* shadcn 语义别名：深色档必须在 `.dark` 下生效。逐条都是 `bg-*` /
 * `text-*` / `border-*` utility 的取值来源。 */
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

describe("主题别名 token 在两态下各自生效（ISSUE #609）", () => {
  it.each(ALIASES)("%s 深色档 != 浅色档（别名确实两态）", (name) => {
    const light = token("", name);
    const dark = token("dark", name);
    expect(light).not.toBe("");
    expect(dark).not.toBe("");
    expect(dark).not.toBe(light);
  });

  it("深色下 --card / --background / --border 取深色值（不被浅色 :root 恒压）", () => {
    expect(token("dark", "--card")).toBe("#16161c");
    expect(token("dark", "--background")).toBe("#0a0a0f");
    expect(token("dark", "--border")).toBe("#26262e");
  });

  it("浅色下（无 .dark）仍取浅色值", () => {
    expect(token("", "--card")).toBe("#ffffff");
    expect(token("", "--background")).toBe("#ffffff");
  });

  it("bg-card/bg-popover/border-border 编成 var(--别名)，本用例覆盖真实取值路径", () => {
    expect(css).toMatch(/\.bg-card\s*{[^}]*background-color:\s*var\(--card\)/);
    expect(css).toMatch(
      /\.bg-popover\s*{[^}]*background-color:\s*var\(--popover\)/,
    );
    expect(css).toMatch(
      /\.border-border\s*{[^}]*border-color:\s*var\(--border\)/,
    );
  });
});
