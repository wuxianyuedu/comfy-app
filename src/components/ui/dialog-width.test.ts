/**
 * 居中模态卡片宽度档的回归（ISSUE #720）。
 *
 * 这条回归的现场只有真实浏览器量得出来（jsdom 不做布局，`getComputedStyle`
 * 在 jsdom 里也拿不到 Tailwind 的产出），所以这里的判据取**契约**而不是像素：
 *   1. 加宽档与默认档必须是**不同族**的宽度写法 —— 同族（两个 `max-w-*`）
 *      谁赢由 Tailwind 输出顺序决定，正是「加宽按钮按了没反应」的根因；
 *   2. `ui/dialog` 的弹窗基类里**不许再出现带变体的 `sm:max-w-*`** —— 带变体
 *      的 utility 会被排到所有无变体之后，连调用处跨族的 `w-*` 也压不过它
 *      （实测 1430×900 视口下三种写法量到的都是同一个 384px = 24rem）。
 *
 * 真实的宽度与「加宽真的变宽」由 e2e 在 Chromium 里量（见
 * `e2e/critical-flows.spec.ts` 的「日志弹窗宽度」用例）——两层分工同 §7.23.3。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { MODAL_WIDE_WIDTH, modalWidth } from "./dialog-width";

/** 源码**去掉注释**再判：把「为什么删掉 sm:max-w-sm」写进注释不该让判据失效
 *  （同 §16.2.4.12 的 P9 口径）。 */
const dialogSource = readFileSync(
  path.resolve(__dirname, "dialog.tsx"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

describe("居中模态卡片的宽度档", () => {
  it("加宽档用 width 而不是 max-width（跨族才有确定结论）", () => {
    expect(MODAL_WIDE_WIDTH).toMatch(/\bw-/);
    expect(MODAL_WIDE_WIDTH).not.toMatch(/max-w-/);
    /* 默认档与加宽档分属两个 width 档，不同族才不会与基类的上限打架。 */
    const tone = modalWidth("w-5xl");
    expect(tone.base).not.toBe(tone.wide);
    expect(tone.base).toMatch(/^w-/);
  });

  it("弹窗基类不再有带变体的 max-width（它会压掉调用处的宽度）", () => {
    /* 带变体的 `sm:max-w-sm` 是这条回归的根因：它排在所有无变体 utility 之后，
       调用处写 `max-w-[96vw]` 也好、写 `w-6xl` 也好，量到的都是 `max-w-sm`。 */
    expect(dialogSource).not.toMatch(/sm:max-w-/);
  });

  it("弹窗基类仍保留「不贴满视口」的兜底上限", () => {
    expect(dialogSource).toContain("max-w-[calc(100%-2rem)]");
  });
});
