import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { TaskLogEntry } from "~/lib/workshop/generation-client";
import { LogsCard } from "./ModelTestResultPanel";

const line = (msg: string, t: number): TaskLogEntry => ({ level: "info", msg, t });

/* happy-dom 对 scrollTo 的实现不承载「滚没滚」语义，测试里直接数调用次数：
 * 开 → 每次日志变化滚一次；关 → 一次都不滚。经属性描述符换装，避免直接引用
 * 原型方法（unbound-method）。 */
const scrollToMock = vi.fn();
const scrollToDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTo");

beforeAll(() => {
  Object.defineProperty(Element.prototype, "scrollTo", {
    configurable: true,
    value: scrollToMock,
    writable: true,
  });
});
afterAll(() => {
  if (scrollToDescriptor !== undefined) {
    Object.defineProperty(Element.prototype, "scrollTo", scrollToDescriptor);
  }
});
afterEach(() => {
  cleanup();
  scrollToMock.mockClear();
});

describe("LogsCard 的自动滚动开关（#4743）", () => {
  it("默认开启：挂载与日志追加都滚到底部", () => {
    const view = render(<LogsCard logs={[line("第一条", 1)]} />);
    expect(scrollToMock).toHaveBeenCalledTimes(1);
    view.rerender(<LogsCard logs={[line("第一条", 1), line("第二条", 2)]} />);
    expect(scrollToMock).toHaveBeenCalledTimes(2);
  });

  it("关掉开关后日志追加不再滚底（用户上翻不被拉回）", () => {
    const view = render(<LogsCard logs={[line("第一条", 1)]} />);
    /* 点文字标签（用户真实动作）；直接点勾选框会被 happy-dom 的 label 激活
     * 行为二次转发，不作为判据。 */
    fireEvent.click(screen.getByText("自动滚动"));
    view.rerender(<LogsCard logs={[line("第一条", 1), line("第二条", 2), line("第三条", 3)]} />);
    expect(scrollToMock).toHaveBeenCalledTimes(1);
  });

  it("重新打开后恢复跟随（切回开启本身也立即贴底一次）", () => {
    const view = render(<LogsCard logs={[line("第一条", 1)]} />);
    const label = screen.getByText("自动滚动");
    fireEvent.click(label);
    fireEvent.click(label);
    view.rerender(<LogsCard logs={[line("第一条", 1), line("第二条", 2)]} />);
    /* 挂载 1 + 切回开启立即贴底 1 + 日志追加 1。 */
    expect(scrollToMock).toHaveBeenCalledTimes(3);
  });
});

describe("LogsCard 的大屏查看入口（#4743）", () => {
  it("给了 onOpenScreen 才出现「大屏查看」按钮，点击回调", () => {
    const onOpenScreen = vi.fn();
    const view = render(<LogsCard logs={[line("第一条", 1)]} onOpenScreen={onOpenScreen} />);
    const button = screen.getByRole("button", { name: "大屏查看" });
    fireEvent.click(button);
    expect(onOpenScreen).toHaveBeenCalledTimes(1);

    view.rerender(<LogsCard logs={[line("第一条", 1)]} />);
    expect(screen.queryByRole("button", { name: "大屏查看" })).toBeNull();
  });
});
