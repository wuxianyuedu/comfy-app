// @vitest-environment jsdom
/* 工作流库画布预览里的**映射编辑** —— ISSUE #355
 *
 * 用户两条要求合一：库里要看得见对外参数与它们的线，**而且线要能改**
 * （「连线要能编辑，现在编辑不了」）。这里走完整链路：
 *
 *   卡片圆点按下 → 拖到宿主行 → 松开 → `onPatchParamMap` 收到落库载荷
 *   （形状 = `source.mode:<模式> = { <entryId>: ioKey }`，与编辑器逐字一致）
 *   → 重新传入该 paramMap 后，卡片与线读回新的落点。
 *
 * 运行相关的副作用（生成 / SSE / 日志弹窗）打桩，避免在 jsdom 里真发请求。 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

vi.mock("@/lib/workshop/generation-client", () => ({
  startLocalGenerate: vi.fn().mockResolvedValue("task-1"),
  watchTask: vi.fn(),
}));
vi.mock("@/lib/workflow-run-store", () => {
  const snapshot = { runs: [] };
  return {
    appendWorkflowRunLog: vi.fn(),
    getWorkflowRunStoreSnapshot: () => snapshot,
    latestRunForWorkflow: () => null,
    patchWorkflowRun: vi.fn(),
    registerWorkflowRun: vi.fn(),
    subscribeWorkflowRunStore: () => () => undefined,
  };
});
vi.mock("../WorkflowRunLogModal", () => ({ WorkflowRunLogModal: () => null }));

import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import { parseParamMapping } from "~/lib/workflow-param-mapping";
import { WorkflowCanvasNodePreview } from "./WorkflowCanvasNodePreview";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  },
);

afterEach(cleanup);

/** 「尺寸」口有宽 / 宽高比 / 像素量 三个候选。 */
const io: WorkflowIOMap = {
  "5::widget::aspect_ratio": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    name: "aspect_ratio",
    label: "宽高比",
    type: "COMBO",
    defaultValue: "16:9",
  },
  "5::widget::megapixels": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    name: "megapixels",
    label: "百万像素",
    type: "FLOAT",
    defaultValue: 1,
  },
  "5::widget::width": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    name: "width",
    label: "宽度",
    type: "INT",
    defaultValue: 1024,
  },
  "5::output::IMAGE": {
    direction: "output",
    kind: "output",
    nodeId: "5",
    name: "images",
    label: "images",
    type: "IMAGE",
  },
};

function rect(
  el: Element,
  r: { left: number; top: number; width: number; height: number },
) {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({
      ...r,
      right: r.left + r.width,
      bottom: r.top + r.height,
    }) as DOMRect;
}

function renderPreview(paramMap: Record<string, unknown>) {
  const onPatch = vi.fn();
  const view = render(
    <WorkflowCanvasNodePreview
      workflowId="wf-1"
      workflowName="测试工作流"
      taskType="t2i"
      workflowIO={io}
      paramMap={paramMap}
      usable
      defaultMode="T2I"
      onPatchParamMap={onPatch}
    />,
  );
  return { ...view, onPatch };
}

describe("库内映射编辑", () => {
  it("从圆点拖到另一个候选行松开 → 该落点被持久化写出", async () => {
    const { container, onPatch } = renderPreview({});
    const dot = container.querySelector<HTMLElement>(
      '[data-wire-anchor="size?megapixels"]',
    )!;
    expect(dot, "尺寸卡的像素量出口应有一颗可拖的圆点").toBeTruthy();
    /* 端点与宿主那一项各钉一个位置（jsdom 不做布局，不钉就量不到，落点判不出来）。
     *  组合控件覆盖的每个端口**各有一项自己的落点**（比例 / 像素 / 倍数各一行）：
     *  拖到哪一项就落到哪个端口上，不是笼统地落到整块控件。 */
    rect(dot, { left: 100, top: 70, width: 12, height: 12 });
    rect(container.querySelector('[data-io-pins="5::widget::megapixels"]')!, {
      left: 300,
      top: 55,
      width: 240,
      height: 20,
    });

    await act(async () => {
      dot.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 106, clientY: 76 }),
      );
    });
    await act(async () => {
      document.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientX: 306, clientY: 66 }),
      );
    });

    expect(onPatch).toHaveBeenCalledTimes(1);
    const payload = onPatch.mock.calls[0]![0] as Record<string, unknown>;
    expect(parseParamMapping(payload).manualByMode).toEqual({
      T2I: { size: "5::widget::megapixels" },
    });
  });

  it("拖到空白处松开 → 不写任何映射（不留悬空线）", async () => {
    const { container, onPatch } = renderPreview({});
    const dot = container.querySelector<HTMLElement>(
      '[data-wire-anchor="size?megapixels"]',
    )!;
    rect(dot, { left: 100, top: 70, width: 12, height: 12 });
    await act(async () => {
      dot.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 106, clientY: 76 }),
      );
    });
    await act(async () => {
      document.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientX: 900, clientY: 900 }),
      );
    });
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("落库后的 paramMap 读回来：卡片页脚说「你改过的线」、恢复默认可用", () => {
    const { container } = renderPreview({
      source: { "mode:T2I": { size: "5::widget::megapixels" } },
    });
    /* 卡片头出现「恢复默认」（只有作者真的改过这条线时才渲染/可用）。 */
    const reset = screen.getByTestId("param-node-reset-size");
    expect(reset.hasAttribute("disabled")).toBe(false);
    /* 被落到的那一颗圆点实心（`opacity: 1`），其余候选淡一档。 */
    const active = container.querySelector<HTMLElement>(
      '[data-wire-anchor="size?megapixels"]',
    )!;
    const other = container.querySelector<HTMLElement>(
      '[data-wire-anchor="size?width"]',
    )!;
    expect(active.style.opacity).toBe("1");
    expect(other.style.opacity).toBe("0.55");
  });

  it("有模式而只读时圆点给出「怎么改」的提示，没有模式则连提示都不给", () => {
    /* 落点覆盖必须归属一个模式 —— 没有模式时写入是无归属的空操作。这里用圆点
     *  上的 title（「拖到工作流参数行上改…的落点」）当判据：它只在可连线时给。
     *  圆点本身刻意不是 role=button 的控件：拖拽没有键盘等价操作，谎报成按钮
     *  只会让读屏用户撞到一个按不动的控件。 */
    const { container, unmount } = renderPreview({});
    const withMode = container.querySelector<HTMLElement>(
      '[data-wire-anchor="size?megapixels"]',
    )!;
    expect(withMode.getAttribute("title")).toContain("落点");
    expect(withMode.getAttribute("role")).toBeNull();
    unmount();

    const { container: noMode } = render(
      <WorkflowCanvasNodePreview
        workflowId="wf-2"
        workflowName="无模式工作流"
        taskType=""
        workflowIO={io}
        paramMap={{}}
        usable
        onPatchParamMap={vi.fn()}
      />,
    );
    const dot = noMode.querySelector<HTMLElement>(
      '[data-wire-anchor="size?megapixels"]',
    )!;
    expect(dot.getAttribute("title")).toBeNull();
  });
});

describe("对外输出参数（节点右侧）—— ISSUE #355", () => {
  it("宿主卡片的输出行带端口圆点（红框里的那一行）", () => {
    /* 用户口径：「红框中的输出端口也要有端口圆点」。项目画布 / 编辑器上的输出
     *  行一直有这颗点（`PortHandle dir="out"`），库内预览此前漏了 —— 补上，
     *  并且它正是右列连线的起点。 */
    const { container } = renderPreview({});
    expect(container.querySelector('[data-port-dot="5::output::IMAGE"]')).toBeTruthy();
  });

  it("节点右侧列出对外输出参数，卡片圆点在卡片左缘", () => {
    const { container } = renderPreview({});
    const column = container.querySelector(
      '[data-testid="workflow-output-param-column"]',
    )!;
    expect(column).toBeTruthy();
    expect(column.getAttribute("aria-label")).toBe("对外输出参数");
    const card = column.querySelector('[data-testid="param-node-5::output::IMAGE"]')!;
    expect(card.textContent).toContain("images");
    const dot = column.querySelector('[data-wire-anchor="5::output::IMAGE?images"]')!;
    expect(dot).toBeTruthy();
    /* 端点槽位在行首（圆点在左）：卡片的左缘才是「线从宿主进来」的那一侧。 */
    expect(
      screen.getByTestId("param-node-out-5::output::IMAGE-0").firstElementChild,
    ).toBe(dot);
  });

  it("右列是只读消费：不给「恢复默认」，也不带拖拽提示", () => {
    const { container } = renderPreview({ source: { "mode:T2I": {} } });
    const card = container.querySelector(
      '[data-testid="param-node-5::output::IMAGE"]',
    )!;
    expect(card.querySelector('[data-testid^="param-node-reset"]')).toBeNull();
    const dot = container.querySelector(
      '[data-wire-anchor="5::output::IMAGE?images"]',
    )!;
    expect(dot.getAttribute("title")).toBeNull();
  });
});
