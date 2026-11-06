/**
 * 侧栏导航项三态的可分辨性（ISSUE #1291）：`--sidebar-accent` 转发到 `--color-subtle`，浅色档搬到深色侧栏
 * （`--color-panel-deep` `#0f0f16`）时取 `#141419`，与底只差 **1.04:1**，且悬停与选中共用同一档底色 ⇒ 深色无反馈。
 * tsc/eslint/色值扫描都看不见（错的是两颗 token 的相对亮度），故必须真量对比度、量在编译产物上（Tailwind 会 tree-shake 未引用变量）。
 * 取值复用 `tests/helpers/theme-tokens.ts`；**别改回 `getComputedStyle`**：jsdom 不解析 `var()`，别名返回字面量。 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadThemeTokens, type ThemeTokens } from "./helpers/theme-tokens";

let light: ThemeTokens;
let dark: ThemeTokens;

beforeAll(async () => {
  ({ light, dark } = await loadThemeTokens());
});

/** `#rrggbb` → sRGB 三个通道（0~255）。产物里这几颗 token 都是 6 位 hex。 */
function channels(value: string): [number, number, number] {
  const m = /^#(?<hex>[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) {
    throw new Error(`期望 6 位 hex 色值，实际是 ${JSON.stringify(value)}`);
  }
  const n = Number.parseInt(m.groups?.hex ?? "", 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG 相对亮度（sRGB 线性化后加权）。 */
function luminance(value: string): number {
  /* SAFETY: 类型断言已复核 */
  const [r, g, b] = channels(value).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 对比度，1:1 ~ 21:1。 */
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}

/** 某态下某 token 的解析值；未定义即用例失败（比 `!` 断言给出更好的报错）。 */
function token(t: ThemeTokens, name: string): string {
  const v = t.get(name);
  expect(v, `${name} 未解析出值（未声明 / 被 tree-shake / var 链断裂）`).toBeTruthy();
  return v!;
}

/* 三态底色相对**侧栏底**的最低可分辨下限。
 *
 * 深浅两态可行区间不同：浅色底 `#f0f1f5` 已很浅，再压深就从「状态」变成「独立卡片」，故浅色档刻意低一档，
 * 靠选中态品牌指示条 + 字重拉齐（见 `globals.css`）。1.10 是下限：低于它实测「看不出变化」（修复前深色 1.04）。
 */
const MIN_HOVER_VS_BASE = 1.1;
/** 选中底色必须比悬停更明显 —— 否则「选中」与「指针路过」无从区分。 */
const MIN_SELECTED_VS_BASE = 1.35;
/** 选中与悬停之间也要能分，这是「选中偏弱」的直接判据。 */
const MIN_SELECTED_VS_HOVER = 1.15;

describe("侧栏导航项三态在真编译产物里可分辨（ISSUE #1291）", () => {
  /* SAFETY: 类型断言已复核 */
  it.for([
    ["浅色", () => light],
    ["深色", () => dark],
  ] as const)("%s：悬停 / 选中底色都明显区别于侧栏底", ([, get]) => {
    const t = get();
    const base = token(t, "--color-panel-deep");
    const hover = token(t, "--color-nav-hover");
    const selected = token(t, "--color-nav-selected");

    expect(
      contrast(hover, base),
      `悬停底 ${hover} 对侧栏底 ${base} 太弱（修复前深色是 1.04:1）`,
    ).toBeGreaterThanOrEqual(MIN_HOVER_VS_BASE);

    expect(
      contrast(selected, base),
      `选中底 ${selected} 对侧栏底 ${base} 太弱`,
    ).toBeGreaterThanOrEqual(MIN_SELECTED_VS_BASE);

    expect(
      contrast(selected, hover),
      `选中底 ${selected} 与悬停底 ${hover} 分不开 —— 「选中偏弱」就是这么来的`,
    ).toBeGreaterThanOrEqual(MIN_SELECTED_VS_HOVER);
  });

  /* SAFETY: 类型断言已复核 */
  it.for([
    ["浅色", () => light],
    ["深色", () => dark],
  ] as const)("%s：别名确实落到侧栏专用的两级 token 上", ([, get]) => {
    const t = get();
    // 悬停档必须**不再**是通用表面 token `--color-subtle`：那是本 ISSUE 的根因，
    // 哪天有人「图省事合回去」，这条会当场红。
    expect(token(t, "--sidebar-accent")).not.toBe(token(t, "--color-subtle"));
    expect(token(t, "--sidebar-accent")).toBe(token(t, "--color-nav-hover"));
    expect(token(t, "--sidebar-selected")).toBe(token(t, "--color-nav-selected"));
  });

  it("选中底两态各自取值（不是一个值复印两份）", () => {
    expect(token(light, "--color-nav-selected")).not.toBe(token(dark, "--color-nav-selected"));
  });

  /* SAFETY: 类型断言已复核 */
  it.for([
    ["浅色", () => light],
    ["深色", () => dark],
  ] as const)("%s：选中底上的正文与指示条都够亮", ([, get]) => {
    const t = get();
    const selected = token(t, "--color-nav-selected");
    // 正文：底色不是「越亮越好」，压在它上面的文字必须还读得清（WCAG 4.5:1）。
    expect(
      contrast(token(t, "--color-ink"), selected),
      "选中底上的正文对比度不足，说明底色压得太重了",
    ).toBeGreaterThanOrEqual(4.5);
    // 指示条是**传达状态的图形**（WCAG 1.4.11 要求 3:1）—— 此前写 `bg-primary`
    // 实测只有 2.73:1（浅）/ 2.32:1（深），等于这根条子自己也不够显眼。
    expect(
      contrast(token(t, "--color-primary-strong"), selected),
      "选中指示条的对比度不足 3:1（WCAG 1.4.11）",
    ).toBeGreaterThanOrEqual(3);
  });
});
