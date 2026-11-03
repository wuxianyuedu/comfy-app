/**
 * 「离开这一屏就丢掉现场」的提醒（规范 10.3.1 / 06 §6.7 第 ③ 档）。
 * 守接线：无信号时整条 `display: none`（调用处可无条件渲染）、有信号时 `display: inline-block`；`exitReminderSignal(false)` 返回 `undefined`（属性整条消失），返回 `""` 会让 `[data-dirty="false"]` 常驻。
 * ⚠️ `:has(~ …)` 的真命中要靠浏览器（jsdom 不做 `:has()` 样式解析），「选择器写对了吗」由 globals.css 的文本判据兜住。
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
    /* SAFETY: 类型断言已复核 */
    const host = container.firstElementChild as HTMLElement;
    expect(host.dataset.dirty !== undefined).toBe(true);
  });
});
