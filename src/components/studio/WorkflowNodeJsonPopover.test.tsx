/**
 * 节点 JSON 浮层的行为回归（ISSUE #717）：点 `#id` 芯片后浮层被推到视口之上（实测 `top: -174`），
 * 根因是从自搓定位改到 `ui/dialog` 时丢了「贴锚点」—— 其 `top-1/2 -translate-y-1/2` 基类结构上
 * 表达不了锚点。守卫锁「走 `ui/popover`、锚点交 Positioner」与「Esc / 关闭按钮齐全」，不断言派生像素。
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
      getJson={() => JSON_ENTRY}
      getView={() => null}
      onDismiss={onDismiss}
      request={REQUEST}
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
    expect(screen.getByText(/"class_type": "CLIPTextEncode"/)).toBeInTheDocument();
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

  it("两个页签里只有一个处于选中态（旧写法 `active` 恒真，两枚永远同时高亮）", () => {
    renderPopover();

    const view = screen.getByRole("tab", { name: "RAW · 节点视图" });
    const saved = screen.getByRole("tab", { name: "执行 · 节点条目" });
    /* 初始是 `view`（RAW），只有它选中。旧实现的 `const active = tab === tab`
     * 是自比较恒真 ⇒ 两枚都 `aria-selected="true"`，用户看不出当前是哪个视图
     * ——这正是 ISSUE #1925 复查时抓到的那个 bug（比「悬停翻色」更硬）。 */
    expect(view).toHaveAttribute("aria-selected", "true");
    expect(saved).toHaveAttribute("aria-selected", "false");
  });

  it("切到另一半后选中态对调（一次只动一枚）", () => {
    renderPopover();

    fireEvent.click(screen.getByRole("tab", { name: "执行 · 节点条目" }));
    expect(screen.getByRole("tab", { name: "执行 · 节点条目" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "RAW · 节点视图" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("点关闭按钮关闭", () => {
    const { onDismiss } = renderPopover();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
