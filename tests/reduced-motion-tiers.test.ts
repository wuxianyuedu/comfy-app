/**
 * 减弱动态效果的三档分治（规范 06 §6.7 的执行者）。
 *
 * 为什么这条必须有执行者：§6.7 原来写的是「所有 `transition` / `animation` 必须有
 * `prefers-reduced-motion` 降级」，而实测 `src/`+`public/`+`.storybook/` 里
 * `prefers-reduced-motion` **0 命中** —— 一句强制条文挂着零执行者，表现不是红，
 * 是「规范说做了而全绿」（规范 §13.5.8 那一族）。
 *
 * 判的四件事，缺一档都算这条判据在空转：
 * ① 循环动画必须停（含两处**内联 `style`** —— 它们必须带 `!important`，否则静默不降级）；
 * ② 大位移必须去掉位移、保留淡入；
 * ③ 短程 hover/focus **明确豁免** —— 所以降级块里不许出现全局 `*` 或 `transition: none`
 *    这类「一把梭」写法（那条是签字时被否掉的另一档方案）；
 * ④ 降级块点名的每个 `data-slot` **在组件源码里真的存在** —— 组件改名/删掉后，
 *    CSS 里的选择器不会报错，只会静默不再命中任何元素。这一半才是本用例独有的价值。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { collectDataSlots } from "./helpers/data-slots";
const CSS_PATH = fileURLToPath(
  new URL("../src/app/globals.css", import.meta.url),
);
const css = readFileSync(CSS_PATH, "utf8");

const LOOP_SELECTORS = [
  ".animate-spin",
  ".animate-pulse",
  ".wf-wave",
  '[data-slot="progress-bar-indeterminate"]',
  '[data-slot="agent-tool-status-dot"]',
] as const;
const DISPLACEMENT_SELECTORS = [
  '[data-slot="sheet-content"]',
  '[data-slot="navigation-menu-content"]',
] as const;

/**
 * 切出 `@media (prefers-reduced-motion: reduce)` 的**块体**。
 * 用花括号配平而不是「找下一个 `}`」—— 块里还有嵌套规则，粗切会在第一个内层
 * 闭括号就截断（那等于只核到半条规则）。取不到块 / 块内零声明都返回 null，
 * 让调用方判红，而不是「解析到 0 条」当成全绿。
 */
function reduceBlockOf(text: string): string | null {
  const start = text.search(/@media[^{]*prefers-reduced-motion[^{]*\{/);
  if (start < 0) return null;
  let depth = 0;
  for (let i = text.indexOf("{", start); i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(text.indexOf("{", start) + 1, i);
    }
  }
  return null;
}

/** 块体内出现过的 `data-slot` 值（选择器里点名的那些）。 */
function slotsNamedIn(block: string): string[] {
  return [
    ...new Set(
      [...block.matchAll(/\[data-slot="([^"]+)"\]/g)].map((m) => m[1]!),
    ),
  ];
}

const block = reduceBlockOf(css);

describe("prefers-reduced-motion 三档分治（规范 06 §6.7）", () => {
  it("降级块在、且不是空块（条文不许只写在规范里）", () => {
    expect(
      block,
      "globals.css 里找不到 @media (prefers-reduced-motion: reduce) 块",
    ).not.toBeNull();
    expect(
      block!.trim().length,
      "reduce 块是空的 —— 判据在空转",
    ).toBeGreaterThan(40);
  });

  it("① 循环动画一律停掉，内联 style 那两处带 !important", () => {
    const body = block ?? "";
    const missing = LOOP_SELECTORS.filter((s) => !body.includes(s));
    expect(missing, "这些循环动画没被降级：").toEqual([]);
    expect(
      /animation:\s*none\s*!important/.test(body),
      "循环那档必须带 `!important`：progress-bar 与 AgentOverlay 用的是内联 style，" +
        "行内样式压过层外一切规则，不带 !important 就是静默不降级",
    ).toBe(true);
  });

  it("② 大位移去掉位移、保留淡入", () => {
    const body = block ?? "";
    const missing = DISPLACEMENT_SELECTORS.filter((s) => !body.includes(s));
    expect(missing, "这些大位移落点没被降级：").toEqual([]);
    expect(/translate:\s*none/.test(body), "位移没有被归零").toBe(true);
    /* 淡入这条过渡**不能**被一起关掉 —— 关掉之后「面板出现了」就没有任何反馈了。
       所以块里不许出现 transition: none（下面第 ③ 档也从另一个方向钉同一件事）。 */
    expect(
      body,
      "reduce 块不许写 transition: none，那会把淡入一起杀掉",
    ).not.toMatch(/transition:\s*none/);
  });

  it("③ 短程反馈是刻意豁免：不许出现全局一把梭的写法", () => {
    const body = block ?? "";
    expect(
      /(^|\n)\s*\*\s*[,{]/.test(body),
      "reduce 块里出现了裸 `*` 选择器 —— 三档分治否掉了全局降级，" +
        "112 行短程 hover 过渡属第 ③ 档，刻意不降级",
    ).toBe(false);
  });

  it("④ 块里点名的每个 data-slot 在组件源码里真的存在", () => {
    const named = slotsNamedIn(block ?? "");
    // 量具自证：一个都不解析到时，这条会绿得没有意义
    expect(
      named.length,
      "reduce 块里没有 data-slot 选择器 —— 解析失效",
    ).toBeGreaterThan(2);
    const { slots, files } = collectDataSlots();
    expect(files, "一个源码文件都没扫到 —— 扫描面失效").toBeGreaterThan(100);
    const ghosts = named.filter((slot) => !slots.has(slot));
    expect(
      ghosts,
      `这些 data-slot 在源码里已经不存在，降级块指到了空气上：${ghosts.join(", ")}（` +
        "组件改名/删除后 CSS 不会报错，只会静默不再命中任何元素）",
    ).toEqual([]);
  });
});

describe("reduceBlockOf / slotsNamedIn 自身可反证", () => {
  it("块体按花括号配平切：嵌套规则不被截断", () => {
    const fixture = `
      .a { color: red }
      @media (prefers-reduced-motion: reduce) {
        .b { animation: none !important }
        .c { translate: none !important }
      }
      .d { color: blue }`;
    const b = reduceBlockOf(fixture) ?? "";
    expect(b).toContain(".b");
    expect(b, "嵌套规则被第一个内层闭括号截断了").toContain(".c");
    expect(b, "切过头，把块外的规则也吞进来了").not.toContain(".d");
  });

  it("缺块与空块都判不出来（返回 null / 空串），而不是假装通过", () => {
    expect(reduceBlockOf(".a { color: red }")).toBeNull();
    expect(
      reduceBlockOf("@media (prefers-reduced-motion: reduce) {}")!.trim(),
    ).toBe("");
  });

  it("slotsNamedIn 只取选择器里的值，且去重", () => {
    expect(
      slotsNamedIn('[data-slot="x"] , [data-slot="y"], [data-slot="x"] {a:b}'),
    ).toEqual(["x", "y"]);
  });
});
