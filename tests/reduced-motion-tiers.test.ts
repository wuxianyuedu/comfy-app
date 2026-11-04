/** 减弱动态效果三档分治（规范 06 §6.7 的执行者）：要求 transition/animation 都有 `prefers-reduced-motion` 降级，实测
 * `src/`/`public/`/`.storybook/` 0 命中 —— 挂零执行者即「规范说做了而全绿」。①循环动画必须停（内联 `style` 须
 * `!important`）②大位移留淡入 ③短程 hover/focus 豁免（禁全局 `*`/`transition: none`）④`data-slot` 须在组件源码存在，
 * 改名即静默失配；⑤新增 `.value-tick`/`[data-exit-reminder]` 各有执行者。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { collectDataSlots } from "./helpers/data-slots";
import { stripComments } from "./helpers/strip-comments";

const SRC_ROOT = fileURLToPath(new URL("../src", import.meta.url));
const CSS_PATH = fileURLToPath(new URL("../src/app/globals.css", import.meta.url));
const css = readFileSync(CSS_PATH, "utf8");

/* SAFETY: 类型断言已复核 */
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
/* SAFETY: 类型断言已复核 */
const DISPLACEMENT_SELECTORS = [
  '[data-slot="sheet-content"]',
  '[data-slot="navigation-menu-content"]',
] as const;

/**
 * 切出 `@media (prefers-reduced-motion: reduce)` 的块体。用花括号配平而非「找下一个 `}`」：块里有嵌套规则，粗切会在
 * 第一个内层闭括号截断（等于只核到半条）。取不到块 / 块内零声明都返回 null，让调用方判红，而不是把「解析到 0 条」
 * 当成全绿。
 */
function reduceBlockOf(text: string): string | null {
  const start = text.search(/@media[^{]*prefers-reduced-motion[^{]*\{/);
  if (start < 0) {
    return null;
  }
  let depth = 0;
  for (let i = text.indexOf("{", start); i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(text.indexOf("{", start) + 1, i);
      }
    }
  }
  return null;
}

/** 块体内出现过的 `data-slot` 值（选择器里点名的那些）。 */
function slotsNamedIn(block: string): Array<string> {
  return [...new Set([...block.matchAll(/\[data-slot="([^"]+)"\]/g)].map((m) => m[1]!))];
}

/** 用到某个 class 的 `.tsx` 清单（只扫 `src/components` 与 `src/app`）。 */
function collectConsumers(cls: string): Array<string> {
  const out: Array<string> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        const text = readFileSync(full, "utf8");
        /* 只认 `className` 里的写法，**并且先剥注释** —— 注释里提到类名
           不算消费。剥注释走共享件（ISSUE #2969），原先这里按「同口径」内联
           抄了一遍无锚的 `//` 全局替换，会把字符串里的 `http://…` 一并截断。 */
        const code = stripComments(text, { trailing: true });
        if (code.includes(cls)) {
          out.push(full);
        }
      }
    }
  };
  walk(SRC_ROOT);
  return out;
}

const block = reduceBlockOf(css);

describe("prefers-reduced-motion 三档分治（规范 06 §6.7）", () => {
  it("降级块在、且不是空块（条文不许只写在规范里）", () => {
    expect(block, "globals.css 里找不到 @media (prefers-reduced-motion: reduce) 块").not.toBeNull();
    expect(block!.trim().length, "reduce 块是空的 —— 判据在空转").toBeGreaterThan(40);
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
    expect(body, "reduce 块不许写 transition: none，那会把淡入一起杀掉").not.toMatch(
      /transition:\s*none/,
    );
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
    expect(named.length, "reduce 块里没有 data-slot 选择器 —— 解析失效").toBeGreaterThan(2);
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
    expect(css, "@keyframes value-tick 不在").toMatch(/@keyframes\s+value-tick\s*\{/);
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
    expect(reduceBlockOf("@media (prefers-reduced-motion: reduce) {}")!.trim()).toBe("");
  });

  it("slotsNamedIn 只取选择器里的值，且去重", () => {
    expect(slotsNamedIn('[data-slot="x"] , [data-slot="y"], [data-slot="x"] {a:b}')).toEqual([
      "x",
      "y",
    ]);
  });
});
