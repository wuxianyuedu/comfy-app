// @vitest-environment jsdom
/* 为何不留在 DOM 档默认的 happy-dom（本档的例外，口径见规范 §11.17）：与 `option-list-popover.test.tsx` 同因（同一个 base-ui popover 栈的 `getAnimations` 时钟差异）—— happy-dom 不推进动画时钟 ⇒ `useAnimationsFinished` 不 settle ⇒ 面板不卸载，「点选项即收起」那一条永远读到还开着的浮层。 */
/** 「控件后行为」面板的行为回归（ISSUE #349 / #672）。
 * 这个面板曾经自搓过一整套浮层（createPortal + placeFloating 视口翻转 + 遮罩 + 手写 Esc），于是「翻上翻下」「收边」「滚动重定位」「Esc 关闭」四处语义在库里有第二份实现。按规范 16 §16.2.3 P2 收拢到 `ui/popover` 后，定位与关闭不再由本组件负责 —— 那是 base-ui 的 Positioner / Root 的契约（自有上游测试），本文件因此不再断言 `style.top` 这类派生的像素值（旧断言正是「把基元的实现细节当成自己的契约」，基元一换就整片失效）。
 * 现在锁定的是本组件自己欠的语义：四个选项、选中态、点击即回调且关面板。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SeedModeButton } from "./seed-mode-button";

afterEach(cleanup);

/** 本用例只验渲染，选中回调无副作用。 */
function noop(): void {
  /* 故意留空 */
}

describe("SeedModeButton", () => {
  it("触发器显示当前模式的中文标签", () => {
    render(<SeedModeButton mode="increment" onPick={noop} />);
    expect(screen.getByTitle(/控件后行为/)).toHaveTextContent("递增值");
  });

  it("未指定模式时回退到「固定值」", () => {
    render(<SeedModeButton mode={undefined} onPick={noop} />);
    expect(screen.getByTitle(/控件后行为/)).toHaveTextContent("固定值");
  });

  it("点开面板后给出四个模式，且当前项带 aria-selected", () => {
    render(<SeedModeButton mode="random" onPick={noop} />);
    fireEvent.click(screen.getByTitle(/控件后行为/));

    /* 触发器自身也带当前标签，故按 `aria-selected` 数选项（P1 判据口径：
       选项行是 `<Button role="option">`）。 */
    const options = screen.getAllByRole("option");
    expect(options.map((element) => element.textContent?.slice(0, 3))).toEqual([
      "固定值",
      "递增值",
      "递减值",
      "随机值",
    ]);
    const selected = options.filter((element) => element.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent("随机值");
  });

  it("点选项即回调并收起面板", () => {
    const onPick = vi.fn();
    render(<SeedModeButton mode="fixed" onPick={onPick} />);
    fireEvent.click(screen.getByTitle(/控件后行为/));

    fireEvent.click(screen.getByText("递减值"));

    expect(onPick).toHaveBeenCalledWith("decrement");
    /* 面板收了：选项文案不再留在文档里。 */
    expect(screen.queryByText("递减值")).toBeNull();
  });
});
