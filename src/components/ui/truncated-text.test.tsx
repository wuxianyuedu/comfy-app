import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TooltipProvider } from "./tooltip";
import { TruncatedText } from "./truncated-text";

afterEach(() => {
  cleanup();
  restoreWidthStubs();
  vi.restoreAllMocks();
});

/**
 * jsdom / happy-dom 不做布局：`scrollWidth` / `clientWidth` 恒为 0 ⇒ 判据永远落在
 * 「没截断」那一侧。这里把两种形态桩出来（内容比容器宽 / 内容放得下），判据本身
 * 因此可测。桩直接定义在 `HTMLElement.prototype` 上（不依赖 happy-dom 把这两个
 * getter 挂在哪一级原型），`afterEach` 按原描述符还原。
 */
const WIDTH_STUBS = ["scrollWidth", "clientWidth"] as const;
const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();

function stubWidth(scrollWidth: number, clientWidth: number) {
  for (const [name, value] of [
    ["scrollWidth", scrollWidth],
    ["clientWidth", clientWidth],
  ] as const) {
    if (!originalDescriptors.has(name)) {
      originalDescriptors.set(name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
    }
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => value });
  }
}

function restoreWidthStubs() {
  for (const name of WIDTH_STUBS) {
    const original = originalDescriptors.get(name);
    if (original) {
      Object.defineProperty(HTMLElement.prototype, name, original);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, name);
    }
  }
  originalDescriptors.clear();
}

/** Base UI 的 tooltip 浮层不带 `role="tooltip"`，按 `data-slot` 取那一层。 */
function queryHintPopup() {
  return document.querySelector('[data-slot="tooltip-content"]');
}

describe("TruncatedText", () => {
  it("被截断时悬停出提示，提示里是完整原文", async () => {
    const user = userEvent.setup();
    stubWidth(240, 100);
    render(
      <TooltipProvider delay={0}>
        <TruncatedText className="truncate">一个很长的模型名被容器截断了</TruncatedText>
      </TooltipProvider>,
    );

    const text = screen.getByText("一个很长的模型名被容器截断了");
    /* 完整原文始终在 DOM 里（读屏器读到的是全文，不是省略号）。 */
    expect(text.textContent).toBe("一个很长的模型名被容器截断了");
    expect(text).not.toHaveAttribute("title");

    await user.hover(text);
    const popup = queryHintPopup();
    expect(popup).not.toBeNull();
    expect(popup?.textContent).toBe("一个很长的模型名被容器截断了");
  });

  it("没被截断时不出提示（不对一段完整文字弹浮层）", async () => {
    const user = userEvent.setup();
    stubWidth(100, 100);
    render(
      <TooltipProvider delay={0}>
        <TruncatedText className="truncate">短文案</TruncatedText>
      </TooltipProvider>,
    );

    await user.hover(screen.getByText("短文案"));
    expect(queryHintPopup()).toBeNull();
  });

  it("承载元素就是调用点那个元素：类名原样生效、不多套一层 DOM", () => {
    stubWidth(240, 100);
    render(
      <TooltipProvider delay={0}>
        <TruncatedText className="text-ink truncate text-sm">模型名</TruncatedText>
      </TooltipProvider>,
    );

    const text = screen.getByText("模型名");
    expect(text.tagName).toBe("SPAN");
    expect(text.className).toContain("truncate");
    expect(text.className).toContain("text-ink");
    /* 提示的 trigger 接管的是同一个元素：父节点上没有多出来的包裹层。 */
    expect(text.parentElement?.tagName).toBe("DIV");
  });
});
