// @vitest-environment jsdom
/**
 * 「控件后行为」面板的视口翻转回归（ISSUE #349）。
 *
 * 面板从触发器向下弹，而 seed 行恰是参数表单的最后一行 —— 画布节点贴着窗口
 * 下沿时，过去固定向下弹会让最后一个选项落到视口之外（截图里只露出前三项）。
 * 这里锁住两条行为：
 *   1. 下方放不下 → 面板翻到触发器上方，底边不越过视口；
 *   2. 下方放得下 → 仍然向下弹（不做无谓翻转），且 maxHeight 封顶。
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";

import { SeedModeButton } from "./WorkflowSeedModeButton";

afterEach(cleanup);

/** 本用例只验定位，选中回调无副作用。 */
function noop(): void {
  /* 故意留空 */
}

/** 冲一遍微任务队列：rAF 校正那一帧在 jsdom 里走的是 setTimeout(0)。 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** 视口 1280×720（jsdom 默认 innerHeight=768，固定成 720 便于算数）。 */
const VIEWPORT = { width: 1280, height: 720 };

/** jsdom 不做布局：给某个元素喂确定的矩形。 */
function stubRect(
  el: Element,
  rect: { left: number; top: number; width: number; height: number },
) {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
    }) as unknown as DOMRect;
}

/** 渲染一颗触发按钮，返回触发器元素。 */
function renderButton() {
  const view = render(<SeedModeButton mode="fixed" onPick={noop} />);
  const trigger = view.container.querySelector("button")!;
  return { view, trigger };
}

/** 打开面板并返回面板元素（面板是 portal 到 body 的 `fixed` 卡片）。 */
async function openPanel(trigger: Element) {
  await act(async () => {
    fireEvent.click(trigger);
  });
  await settle();
  return document.querySelector<HTMLElement>('div[style*="max-height"]')!;
}

describe("SeedModeButton 视口翻转（ISSUE #349）", () => {
  it("下方放不下时翻到触发器上方，底边不越过视口", async () => {
    Object.defineProperty(window, "innerWidth", {
      value: VIEWPORT.width,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: VIEWPORT.height,
      configurable: true,
    });

    const { trigger } = renderButton();
    /* 触发器贴着窗口下沿（bottom=630，下方只剩 76px），面板高 270px。
     * jsdom 量不到真实高度，按源码的兜底值 270 参与判定。 */
    stubRect(trigger, { left: 300, top: 600, width: 80, height: 30 });

    /* 面板是 portal 出去的 `fixed` 卡片；jsdom 不布局，offsetHeight 恒为 0，
     * 源码此时退回兜底高度 270 —— 正是本 ISSUE 的场景。 */
    const panel = await openPanel(trigger);

    const top = Number.parseFloat(panel.style.top);
    // 翻到上方：600 - 6(间距) - 270(高) = 324
    expect(top).toBe(324);
    expect(top + 270).toBeLessThanOrEqual(VIEWPORT.height);
    // 高度封顶（视口高 - 两侧留白）——最后一个选项不会被推出视口。
    expect(Number.parseFloat(panel.style.maxHeight)).toBe(VIEWPORT.height - 16);
    // 右对齐触发器右沿（380 - 280 = 100）。
    expect(Number.parseFloat(panel.style.left)).toBe(100);
  });

  it("下方放得下时保持向下弹出", async () => {
    Object.defineProperty(window, "innerWidth", {
      value: VIEWPORT.width,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: VIEWPORT.height,
      configurable: true,
    });

    const { trigger } = renderButton();
    stubRect(trigger, { left: 300, top: 100, width: 80, height: 30 });

    const panel = await openPanel(trigger);

    // 130 + 6 = 136：向下弹，不翻转。
    expect(Number.parseFloat(panel.style.top)).toBe(136);
  });
});
