// @vitest-environment jsdom
/**
 * 「离开这一屏就丢掉现场」的提醒（规范 10.3.1 / 06 §6.7 第 ③ 档）。
 *
 * 这条判据守的是**接线**，不是样式（样式的判据在 `globals.css` 那条选择器上，
 * 真命中要浏览器，见下）：
 * ① 没有信号时**整条不在可见流里**（`display: none`）—— 它可以在任何容器里
 *    无条件渲染，调用处不必先算一遍「现在该不该显示」；
 * ② 有信号时给出的是 `display: inline-block`（摆回来）；
 * ③ `exitReminderSignal(false)` 返回的属性值是 `undefined` —— **属性整条消失**，
 *    与「不写这个 prop」等价；返回 `""` 的话 `[data-dirty="false"]` 照样命中，
 *    那会让提醒在任何地方都常驻（而没有任何东西会报错）。
 *
 * ⚠️ 说清这条**判不出什么**：`:has(~ …)` 的**真命中**要靠浏览器（jsdom 不做
 * `:has()` 的样式解析）。因此「选择器写对了吗」这一半由 globals.css 的文本判据
 * 兜住（同目录的用例读那份 CSS），不是本文件。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { ExitReminder, exitReminderSignal } from "./use-exit-reminder";

afterEach(cleanup);

describe("ExitReminder", () => {
  it("信号缺席时属性整条不出现（不是空串）", () => {
    expect(exitReminderSignal(false)["data-dirty"]).toBeUndefined();
    expect(exitReminderSignal(true)["data-dirty"]).toBe("");
  });

  it("渲染出的是带判据钩子的元素，且文案可读", () => {
    const { container } = render(<ExitReminder>切走会丢内容</ExitReminder>);
    const el = container.querySelector("[data-exit-reminder]");
    expect(el, "判据钩子 data-exit-reminder 没渲染出来").not.toBeNull();
    expect(el?.getAttribute("role")).toBe("status");
    expect(el?.textContent).toBe("切走会丢内容");
  });

  it("列表里也能挂信号：属性会跟着展开到真实 DOM 上", () => {
    const { container } = render(
      <div {...exitReminderSignal(true)}>
        <ExitReminder>提示</ExitReminder>
      </div>,
    );
    const host = container.firstElementChild as HTMLElement;
    expect(host.hasAttribute("data-dirty")).toBe(true);
  });
});
