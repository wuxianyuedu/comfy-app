/**
 * 模态遮罩（scrim）的可见性 —— 「弹窗背后真的被压暗了吗」（ISSUE #1742）。
 *
 * 背景：`ui/dialog` 的 `DialogContent` 一度**只铺 Portal + Popup**，不渲染带色的
 * `Backdrop` —— 基元自动注入的那层 `InternalBackdrop` 是 `role="presentation"`
 * 的**透明**层（只用于外部点击判定），肉眼看不见。于是绝大多数弹窗背后又亮又像
 * 能点：用户分不清哪块是活的、也看不出「这是个要先处理掉的对话框」。
 *
 * 这类故障 tsc / eslint / 主题色扫描器都看不见 —— 色值全都来自 token、命名也没错，
 * 错的是**遮罩压在本应用背景上之后还剩多少对比**。所以判据必须是「真量」，
 * 并且量在**编译产物**上（Tailwind 会 tree-shake 没被引用的 `@theme` 变量）。
 *
 * 取值口径：复用 `tests/helpers/theme-tokens.ts`（真编译 globals.css + 解析 `var()` 链）。
 * `bg-scrim` 已登记进它的 `PINNED_UTILITY_CLASSES`，产物里必须有这条 utility。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadThemeTokens, type ThemeTokens } from "./helpers/theme-tokens";

let light: ThemeTokens;
let dark: ThemeTokens;
let css: string;

beforeAll(async () => {
  ({ light, dark, css } = await loadThemeTokens());
});

/** 解析 `rgb(r g b / a)` 或 `#rrggbb`（本仓 token 的两种写法）。 */
function parseColor(value: string): { a: number; rgb: [number, number, number]; } {
  const v = value.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = Number.parseInt(hex[1]!, 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], a: 1 };
  }
  const m = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+)\s*)?\)$/.exec(v);
  if (!m) {
    throw new Error(`期望 rgb(r g b / a) 或 #rrggbb，实际是 ${JSON.stringify(value)}`);
  }
  return {
    rgb: [Number(m[1]), Number(m[2]), Number(m[3])],
    a: m[4] === undefined ? 1 : Number(m[4]),
  };
}

/** WCAG 相对亮度（0~1）。 */
function luminance([r, g, b]: [number, number, number]): number {
  const lin = /* SAFETY: 类型断言已复核 */ [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG 对比度，1:1 ~ 21:1。 */
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [x, y] = [luminance(a), luminance(b)];
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}

/** 把半透明遮罩 `src`（α）合成到底色 `bg` 上，返回合成后的 sRGB。 */
function over(
  src: { a: number; rgb: [number, number, number]; },
  bg: [number, number, number],
): [number, number, number] {
  return /* SAFETY: 类型断言已复核 */ src.rgb.map((c, i) =>
    Math.round(c * src.a + bg[i]! * (1 - src.a)),
  ) as [number, number, number];
}

/** 某态下某 token 的解析值；未定义即失败（给出比 `!` 更好的报错）。 */
function token(t: ThemeTokens, name: string): string {
  const v = t.get(name);
  expect(v, `${name} 未解析出值（未声明 / 被 tree-shake / var 链断裂）`).toBeTruthy();
  return v!;
}

/* 「遮罩压暗了多少」的下限。1.35 对应「肉眼明确看出背后被压下去了」——
   此前完全没有遮罩时是 1.00:1（亮着一点没变），这就是那条 ISSUE 的现场。
   量的对象是**这一态里最亮的那个常见表面**（下面 `SURFACES` 里取最亮的一颗）：
   「压暗」这件事对纯黑底本来就没有意义（黑压黑只是更黑），判据要问的是
   「弹窗背后用户真看得见的那层（面板 / 卡片 / 输入框底）有没有被压下去」。 */
const MIN_DIM = 1.35;

/** 弹窗会盖住的常见表面（取最亮的那个做判据，避免挑一个最暗的凑合过）。 */
const SURFACES = /* SAFETY: 类型断言已复核 */ [
  "--color-bg",
  "--color-canvas",
  "--color-panel",
  "--color-surface-1",
  "--color-surface-2",
  "--color-node",
] as const;

describe("模态遮罩在真编译产物里足够可见（ISSUE #1742）", () => {
  it("bg-scrim 这条 utility 真的进了产物（而不是只在源码里写了）", () => {
    expect(
      /\.bg-scrim\s*\{/.test(css),
      "产物里没有 .bg-scrim —— 要么 utility 名写错，要么没登记进 theme-tokens 的固定类名",
    ).toBe(true);
  });

  it.for(
    /* SAFETY: 类型断言已复核 */ [
      ["浅色", () => light],
      ["深色", () => dark],
    ] as const,
  )("%s：遮罩把应用背景压暗到能分辨", ([, get]) => {
    const t = get();
    const scrim = parseColor(token(t, "--color-scrim"));
    /* 取这一态里**最亮**的常见表面：它是最容易「亮着、像能点」的那块，
       遮罩若连它都压不下去，弹窗背后就还是亮的。 */
    const candidates = SURFACES.map(
      (name) => /* SAFETY: 类型断言已复核 */ [name, parseColor(token(t, name)).rgb] as const,
    );
    const [name, bg] = candidates.reduce((a, b) => (luminance(a[1]) >= luminance(b[1]) ? a : b));

    const dimmed = over(scrim, bg);
    expect(
      contrast(bg, dimmed),
      `遮罩压暗不足（最亮表面 ${name} ${bg.join(",")} → ${dimmed.join(",")}，要求 ≥ ${MIN_DIM}:1）`,
    ).toBeGreaterThanOrEqual(MIN_DIM);
  });

  it("两态各自取值（不是一个值复印两份）", () => {
    expect(token(light, "--color-scrim")).not.toBe(token(dark, "--color-scrim"));
  });

  it("dialogBackdropClass() 走的是 bg-scrim 这条语义 token，且让出标题行", async () => {
    const { dialogBackdropClass } = await import("~/components/ui/dialog-overlay");
    const cls = dialogBackdropClass();
    expect(cls).toContain("bg-scrim");
    // 标题行让位的硬规则（ISSUE #310）：判据 `check-title-bar-clearance.cjs` 的同源形态。
    expect(cls).toContain("top-title-bar");
  });
});
