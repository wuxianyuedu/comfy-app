/**
 * 节点 JSON 浮层的行为回归（ISSUE #717）。
 *
 * 用户报的现场：点节点右上角的 `#id` 芯片后，浮层被推到视口之上（实测
 * `top: -174`），头部（标题 / 复制 / 关闭）与 JSON 开头整片裁在窗口外。
 *
 * 根因是**定位口径**：浮层从自搓定位收拢到 `ui/dialog` 时（ISSUE #672），
 * 丢掉了「贴着锚点」这件事 —— `ui/dialog` 的 Popup 基类自带
 * `top-1/2 -translate-y-1/2`，调用处再用 `top-24` 覆盖，两者叠加把浮层推到了
 * 视口上方。`ui/dialog` 的 Popup 里没有 Positioner，**结构上就表达不了锚点定位**。
 *
 * 因此本守卫锁两件事：
 *   ① 浮层走 `ui/popover`，并把锚点交给 Positioner（不是自己算像素、不是
 *      自写视口夹紧）；
 *   ② 关闭语义仍然齐全：Esc / 关闭按钮。
 *
 * **不断言 `style.top` 这类派生像素值** —— 翻转与「视口内收边」是 base-ui
 * Positioner 的契约（与 `seed-mode-button.test.tsx` 同一条口径）。真实浏览器
 * 里的「浮层四边都在视口内」已按 ISSUE #717 手工验过（1295×900 与 820×560
 * 两档：浮层分别落在 170~710 / 164~500）。「点浮层外关闭」由 base-ui 的
 * `outsidePress`（`pointerdown`）负责，jsdom 没有 PointerEvent 语义，
 * 断言不到 —— 硬凑只会得到一条假绿的用例。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { NodeJsonPopover } from "./WorkflowNodeJsonPopover";
import type { NodeJsonViewerRequest } from "./workflow-types";

afterEach(cleanup);

const REQUEST: NodeJsonViewerRequest = {
  anchorRect: {
    x: 120,
    y: 300,
    left: 120,
    top: 300,
    right: 160,
    bottom: 316,
    width: 40,
    height: 16,
  },
  nodeId: "41",
  kind: "node",
};

/** 最小可用的 JSON 数据源：只喂 `class_type`，够渲染标题与正文。 */
const JSON_ENTRY = { class_type: "CLIPTextEncode", inputs: {} };

function renderPopover(overrides?: { onDismiss?: () => void }) {
  const onDismiss = overrides?.onDismiss ?? vi.fn();
  render(
    <NodeJsonPopover
      request={REQUEST}
      getJson={() => JSON_ENTRY}
      getView={() => null}
      onDismiss={onDismiss}
    />,
  );
  return { onDismiss };
}

/** 浮层本体的判据：`ui/popover` 的 Popup（`data-slot="popover-content"`）。 */
function popupSlot(): HTMLElement | null {
  return document.querySelector('[data-slot="popover-content"]');
}

describe("节点 JSON 浮层", () => {
  it("打开后渲染节点 JSON（头部、页签、正文都在）", () => {
    renderPopover();

    expect(popupSlot()).not.toBeNull();
    expect(screen.getByText("节点 JSON")).toBeInTheDocument();
    /* 标题里的 `#41` 与 aria-label 都可能含节点号，故按标题行取。 */
    expect(screen.getByText("#41")).toBeInTheDocument();
    expect(screen.getByText("CLIPTextEncode")).toBeInTheDocument();
    /* 正文按 JSON 序列化渲染（含字段名即证明拿到了条目）。 */
    expect(
      screen.getByText(/"class_type": "CLIPTextEncode"/),
    ).toBeInTheDocument();
  });

  it("浮层由 Positioner 定位（锚点定位，不是视口居中的弹窗）", () => {
    renderPopover();

    const popup = popupSlot();
    expect(popup).not.toBeNull();
    /* `ui/popover` 的 Popup 一定住在 Positioner 内，且本组件把
       `positionerClassName="max-h-[60vh]"` 传给了那一层 —— 用它作为
       「浮层确实挂在 Positioner 里」的判据。
       这同时排除了「回到 ui/dialog + top-24 / -translate-y-1/2」那条曾把
       浮层推到视口之上的写法：dialog 的 Popup 里没有 Positioner 这一层。 */
    const positioner = popup?.parentElement;
    expect(positioner?.className).toContain("z-popup");
    expect(positioner?.className).toContain("max-h-[60vh]");
    /* 模态语义：base-ui 把 Popup 标成 role=dialog（Esc / 点外关闭的前提）。 */
    expect(popup?.getAttribute("role")).toBe("dialog");
  });

  it("Esc 关闭", () => {
    const { onDismiss } = renderPopover();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("点关闭按钮关闭", () => {
    const { onDismiss } = renderPopover();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
