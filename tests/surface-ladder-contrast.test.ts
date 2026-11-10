/**
 * 表面阶梯的可分辨性（ISSUE #3519，承接 #3510 / #3495）。
 *
 * 本仓的承载面是一条**阶梯**：页面底 → 卡片 → 卡片内的一行 → 控件（输入框），
 * 另有「通用极浅表面」（悬停底 / chip / ghost 底）这一档。每一档都要与它下面那档
 * **分得开**，否则就是「看不清」：
 *
 *   · 卡片内的行与卡片同色 → 子项糊成一片（#3510，用户现场：卡片底与子项底
 *     逐像素相同，都是 `#16161c`）；
 *   · 控件与卡片只差 1.04:1 → 输入框的底色等于没有，字段只剩一圈发丝描边
 *     （#3519，用户现场：行内数字框未选中时看不到框 —— 取样与行底逐像素相同）；
 *   · 悬停底与卡片同值 → 指针划过时没有任何反馈（「可点」没有提示）。
 *
 * 取值一律从**编译产物**真解析（`tests/helpers/theme-tokens.ts`）—— 别改回
 * `getComputedStyle`（jsdom 不解析 `var()`，别名会返回字面量，断言全误报）。
 * 对比度算法只有一处口径：`tests/helpers/contrast.ts`。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { contrast } from "./helpers/contrast";
import { stripComments } from "./helpers/strip-comments";
import { loadThemeTokens, type ThemeTokens } from "./helpers/theme-tokens";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const INPUT_PRIMITIVE = path.join(ROOT, "src", "components", "ui", "input.tsx");

let light: ThemeTokens;
let dark: ThemeTokens;

beforeAll(async () => {
  ({ light, dark } = await loadThemeTokens());
});

/** 某态下某 token 的解析值；未定义即用例失败（比 `!` 断言给出更好的报错）。 */
function token(t: ThemeTokens, name: string): string {
  const v = t.get(name);
  expect(v, `${name} 未解析出值（未声明 / 被 tree-shake / var 链断裂）`).toBeTruthy();
  return v!;
}

/**
 * 两档表面之间的**最低可分辨下限**（浅深两态不同档，理由见各自注释）。
 *
 * 深色档：1.10 —— 本仓的既有下限（`tests/sidebar-state-contrast.test.ts`：
 * 「低于 1.10 实测看不出变化；修复前深色 1.04」）。
 * 浅色档：1.08 —— 浅色色板本身压得扁（卡片离页面底只有 1.06:1），这一档是
 * 「AA 还能过」与「分得开」的交点（控件再深一档，弱文字 `#6b6b76` 就不够 4.5:1）。
 */
const MIN_SURFACE_PAIR_DARK = 1.1;
const MIN_SURFACE_PAIR_LIGHT = 1.08;

/** 行与卡片之间留的余量（行是 #3510 刚补上的一档，取值比下限高半档）。 */
const MIN_ROW_VS_CARD_DARK = 1.15;

/** 压在表面上的文字仍要过 WCAG AA（普通字号 4.5:1）。 */
const MIN_TEXT_VS_SURFACE = 4.5;

/** 需要分得开的表面对（谁 vs 谁）。 */
const SURFACE_PAIRS = [
  { a: "--color-surface-1", b: "--color-surface-row", why: "卡片 vs 卡片内的一行" },
  { a: "--color-surface-1", b: "--color-surface-2", why: "卡片 vs 控件（输入框）" },
  { a: "--color-surface-row", b: "--color-surface-2", why: "卡片内的一行 vs 其中的控件" },
  { a: "--color-surface-1", b: "--color-subtle", why: "卡片 vs 悬停底（可点性提示）" },
] as const;

describe("表面阶梯：每一档都要与下面那档分得开（ISSUE #3519）", () => {
  /* SAFETY: 类型断言已复核 */
  it.for([
    ["浅色", () => light, MIN_SURFACE_PAIR_LIGHT],
    ["深色", () => dark, MIN_SURFACE_PAIR_DARK],
  ] as const)("%s：%s", ([, get, min]) => {
    const t = get();
    for (const pair of SURFACE_PAIRS) {
      const a = token(t, pair.a);
      const b = token(t, pair.b);
      expect(
        contrast(a, b),
        `${pair.why}：${pair.a}（${a}）与 ${pair.b}（${b}）只差 ${contrast(a, b).toFixed(
          3,
        )}:1 —— 两档表面看起来是同一块`,
      ).toBeGreaterThanOrEqual(min);
    }
  });

  it("深色：卡片内的一行比下限还高半档（它是刚补上的一档，留了余量）", () => {
    expect(
      contrast(token(dark, "--color-surface-row"), token(dark, "--color-surface-1")),
      "行表面与卡片表面的对比度余量不足",
    ).toBeGreaterThanOrEqual(MIN_ROW_VS_CARD_DARK);
  });

  /* SAFETY: 类型断言已复核 */
  it.for([
    ["浅色", () => light],
    ["深色", () => dark],
  ] as const)("%s：压在每一档表面上的正文都过 AA", ([, get]) => {
    const t = get();
    for (const name of [
      "--color-surface-1",
      "--color-surface-row",
      "--color-surface-2",
      "--color-subtle",
    ]) {
      const surface = token(t, name);
      expect(
        contrast(token(t, "--color-ink"), surface),
        `${name}（${surface}）上的正文对比度不足 4.5:1`,
      ).toBeGreaterThanOrEqual(MIN_TEXT_VS_SURFACE);
    }
  });
});

describe("输入框基类不许用变体底色压掉调用点（ISSUE #3519）", () => {
  it("`ui/input.tsx` 的基类里没有 `dark:bg-*` / `light:bg-*`", () => {
    /* 注释里正当会出现被禁的叙述（「此前基类带 `dark:bg-input/30`」），拿原文
       匹配就是自打自 —— 先剥注释再判形状（`tests/helpers/strip-comments.ts`）。
       判据只拦**常态**的主题变体底色（`dark:bg-` / `light:bg-`）：状态变体
       （`dark:disabled:bg-`）只在禁用态生效，不压常态底色。 */
    const src = stripComments(readFileSync(INPUT_PRIMITIVE, "utf8"), { trailing: true });
    const offenders = [...src.matchAll(/["`](?<text>[^"`]*)["`]/g)]
      .map((m) => m.groups?.text ?? "")
      .flatMap((text) => text.split(/\s+/))
      .filter((token) => /^(?:dark|light):bg-/.test(token));
    expect(
      offenders,
      "输入框基类带了主题变体底色 —— 它会压掉调用点的底色（深色下字段底色与容器同色就是这么来的）",
    ).toEqual([]);
  });
});
