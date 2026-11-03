/** 居中模态卡片宽度档的回归（ISSUE #720）。jsdom 不做布局、`getComputedStyle` 拿不到 Tailwind 产出，所以判据取契约而非像素：
 * ① 加宽档与默认档必须是不同族的宽度写法 —— 同族（两个 `max-w-*`）谁赢由 Tailwind 输出顺序决定，正是「加宽按钮按了没反应」的根因；
 * ② `ui/dialog` 的弹窗基类里不许再出现带变体的 `sm:max-w-*` —— 变体 utility 排在所有无变体之后，连调用处跨族的 `w-*` 也压不过（实测 1430×900 视口下三种写法量到的都是 384px = 24rem）。
 * 真实宽度与「加宽真的变宽」由 e2e 在 Chromium 里量（`e2e/critical-flows.spec.ts` 的「日志弹窗宽度」用例），两层分工同 §7.23.3。 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { MODAL_WIDE_WIDTH, modalWidth } from "./dialog-width";
import { stripComments } from "../../../tests/helpers/strip-comments";

/** 源码**去掉注释**再判：把「为什么删掉 sm:max-w-sm」写进注释不该让判据失效
 *  （同 §16.2.4.12 的 P9 口径）。用唯一实现 `tests/helpers/strip-comments`（ISSUE #2969 的
 *  副本收敛那一格）：本接收者实测两份读法判决无差，但旧形那条不跟引号状态的块注释正则
 *  在同族别的文件上确实吃过真代码。 */
const dialogSource = stripComments(readFileSync(path.resolve(__dirname, "dialog.tsx"), "utf8"));

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
