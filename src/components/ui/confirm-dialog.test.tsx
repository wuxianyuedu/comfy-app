//
// 回归测试：「数据库结构过期 → 点击同步」的确认弹窗打开后是一块空黑框。
//
// 根因：ConfirmDialog 曾把 `overlayClass("modal", …)`（**遮罩层**的
// 「铺满内容区」定位：fixed top-title-bar inset-x-0 bottom-0）传给
// `DialogContent`。那是弹窗**卡片**（base-ui Popup），基元自带
// `fixed top-1/2 left-1/2 -translate-1/2` 居中定位 —— 两套定位打架，卡片被
// 拉伸成整块内容区又被 −50% 平移，真正的 420px 实体卡被甩到视口左上角之外，
// 用户看到的就是一块空黑框。
//
// 这条测试锁的判据：弹窗打开后，**任何元素都不得带遮罩定位 class**
// （`top-title-bar` / `inset-x-0`），且标题与描述要真实渲染出来。
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";

afterEach(() => cleanup());

/** 遮罩层的定位判据类（full-screen-layer 的 OVERLAY_POSITION_CLASS.modal）。 */
const OVERLAY_POSITION_MARKS = ["top-title-bar", "inset-x-0", "bottom-0"];

describe("ConfirmDialog 卡片不得带遮罩定位", () => {
  it("打开后没有元素携带 overlay 定位 class，标题/描述可见", () => {
    render(
      <ConfirmDialog
        open
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        danger
        title="立即执行数据库同步？"
        confirmLabel="同步"
        description={"数据库结构过期\n\n这批变更含「会丢数据」的语句。"}
      />,
    );

    expect(screen.getByTestId("modal-dialog")).toBeTruthy();
    expect(screen.getByText("立即执行数据库同步？")).toBeTruthy();
    expect(screen.getByText(/这批变更含「会丢数据」的语句/)).toBeTruthy();

    /* 弹窗卡片（base-ui Popup）本体不许带遮罩的定位 class：那套定位属于
       Backdrop，落在卡片上就会和基元的居中定位打架 →「空黑框」回归。
       （卡片内部的渐变装饰条用 `absolute inset-x-0`，是合法的局部定位，
       不在本判据范围内。） */
    const popup = document.querySelector<HTMLElement>(
      '[data-slot="dialog-content"]',
    );
    expect(popup).toBeTruthy();
    const popupClass = popup!.className;
    for (const mark of OVERLAY_POSITION_MARKS) {
      expect(
        popupClass.split(/\s+/),
        `弹窗卡片不该带遮罩定位 class「${mark}」`,
      ).not.toContain(mark);
    }

    /* 危险确认按钮仍然渲染（弹窗不只是个壳）。 */
    expect(screen.getByRole("button", { name: "同步" })).toBeTruthy();
  });
});
