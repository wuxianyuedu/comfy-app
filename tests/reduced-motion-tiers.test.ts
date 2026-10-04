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
 * ⑤ 本轮新增的两条动效机制（`.value-tick` 与 `[data-exit-reminder]`）**各有执行者**：
 *    前者是「值变了闪一下」，后者是「离开会丢东西」的提示条。它们都不是循环动画，
 *    落在「没停下 / 没命中也不会报错」那一族里 —— 所以除降级外，还要判它们
 *    真的被 CSS 定义过、且被注明的那一条选择器形状没被改写。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { collectDataSlots } from "./helpers/data-slots";
const SRC_ROOT = fileURLToPath(new URL("../src", import.meta.url));
const CSS_PATH = fileURLToPath(
  new URL("../src/app/globals.css", import.meta.url),
);
const css = readFileSync(CSS_PATH, "utf8");

const LOOP_SELECTORS = [
  ".animate-spin",
  ".animate-pulse",
  ".wf-wave",
  /* `.value-tick`（数值变了闪一下）是一次性动画，但**每一秒重播一次** ——
     按 06 §6.7 的分档它归第 ① 档：循环之外「没停下也不会报错、而敏感用户
     会持续看到亮度变化」的那一类。 */
  ".value-tick",
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


/** 用到某个 class 的 `.tsx` 清单（只扫 `src/components` 与 `src/app`）。 */
function collectConsumers(cls: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) {
        const text = readFileSync(full, "utf8");
        /* 只认 `className` 里的写法，**并且先剥注释** —— 注释里提到类名
           不算消费（本仓库已有 18 份内联的剥注释实现，见
           `tests/strip-comments-single-source.test.ts`；这里按同口径内联一遍，
           它的判据是「不许再新增第 19 份」，而本文件是既有的一份）。 */
        const code = text
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:])\/\/.*$/gm, "$1");
        if (code.includes(cls)) out.push(full);
      }
    }
  };
  walk(SRC_ROOT);
  return out;
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

describe("本轮新增的两条动效机制在位（06 §6.7 第 ①/③ 档）", () => {
  /* 这两条都必须有**定义**与**消费者**同时存在：只定义不消费是死 CSS，
     只消费不定义则是「类名写了但什么都没发生 —— 而 tsc / eslint 全绿」。 */
  it(".value-tick 既被定义、也被消费点用上", () => {
    expect(css, "globals.css 里没有 .value-tick 的定义").toMatch(
      /\.value-tick\s*\{[^}]*animation:\s*value-tick/,
    );
    expect(css, "@keyframes value-tick 不在").toMatch(
      /@keyframes\s+value-tick\s*\{/,
    );
    /* 消费点：至少一处视图写了这个类名，否则这条判据在守一个没人用的类。 */
    const consumers = collectConsumers("value-tick");
    expect(
      consumers.length,
      "没有任何视图用 value-tick —— 定义了没人用，等于这条机制不在场",
    ).toBeGreaterThan(0);
  });

  it("[data-exit-reminder] 的命中选择器是 `~`（挂到祖先上就永远命不中）", () => {
    /* `~` 是**后继兄弟**组合子：提示条必须与提供信号的元素平级。
       这一格最容易的失效方式是把信号挂到祖先上（读起来更合理），于是提醒
       永远不亮 —— 而样式表里那条规则照旧「有定义」，没有任何东西会报。 */
    expect(css, "data-exit-reminder 的默认态没写").toMatch(
      /\[data-exit-reminder\]\s*\{\s*display:\s*none/,
    );
    expect(
      css,
      "data-exit-reminder 的命中规则没走 `:has(~ [data-dirty])` —— 兄弟组合子变了",
    ).toMatch(/\[data-exit-reminder\]:has\(~\s*\[data-dirty\]\)/);
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
