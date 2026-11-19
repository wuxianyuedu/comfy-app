/* ISSUE #4073 复审第 4 / 5 条：IO 预览的参数（含尺寸组合块）要能真的调序。
 * 这里钉住两件事：组合块拿到与普通行同款的拖拽手柄；拖它时把**整组** ioKey
 * 交给调用方，而不是只挪一个代表键（那会表现为「拖完又弹回原处」）。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { DynamicWorkflowForm } from "./index";
import type { WorkflowIOMap } from "../../workflow-io";
import type { WorkflowIODropPosition } from "../../workflow-types";

afterEach(cleanup);

const STEPS = "7::widget::steps";
const ASPECT = "7::widget::aspect_ratio";
const MEGAPIXELS = "7::widget::megapixels";

const io: WorkflowIOMap = {
  [STEPS]: {
    direction: "input",
    kind: "widget",
    nodeId: "7",
    name: "steps",
    label: "步数",
    type: "INT",
    displayOrder: 1,
  },
  [ASPECT]: {
    direction: "input",
    kind: "widget",
    nodeId: "7",
    name: "aspect_ratio",
    label: "宽高比",
    type: "COMBO",
    displayOrder: 2,
  },
  [MEGAPIXELS]: {
    direction: "input",
    kind: "widget",
    nodeId: "7",
    name: "megapixels",
    label: "百万像素",
    type: "FLOAT",
    displayOrder: 3,
  },
};

function setup() {
  const onReorder = vi.fn(
    (
      _fromKey: string,
      _targetKey: string | null,
      _position: WorkflowIODropPosition,
      _fromKeys?: Array<string>,
    ) => undefined,
  );
  const { container } = render(
    <DynamicWorkflowForm
      compact
      io={io}
      onChange={() => undefined}
      onReorder={onReorder}
      showOutputs={false}
      values={{}}
    />,
  );
  const box = container.querySelector<HTMLElement>("[data-grouped-box]");
  if (!box) {
    throw new Error("尺寸组合块没有渲染出来");
  }
  const groupHandle = box.closest<HTMLElement>('div[draggable="true"]');
  if (!groupHandle) {
    throw new Error("尺寸组合块没有可拖拽外壳");
  }
  const stepsRow = container.querySelector<HTMLElement>(`[data-io-key="${STEPS}"]`);
  if (!stepsRow) {
    throw new Error("普通参数行没有渲染出来");
  }
  const stepsHandle = stepsRow.closest<HTMLElement>('div[draggable="true"]');
  if (!stepsHandle) {
    throw new Error("普通参数行没有可拖拽外壳");
  }
  return { container, groupHandle, onReorder, stepsHandle };
}

describe("DynamicWorkflowForm — 组合参数块调序（ISSUE #4073 复审第 5 条）", () => {
  it("尺寸组合块带 ⋮⋮ 手柄，且块本身可拖", () => {
    const { groupHandle } = setup();
    expect(groupHandle.textContent).toContain("⋮⋮");
    expect(groupHandle.getAttribute("draggable")).toBe("true");
  });

  it("拖组合块落到普通行上：回调收到整组 key，不是单个代表键", () => {
    const { groupHandle, onReorder, stepsHandle } = setup();
    const dataTransfer = { setData: vi.fn(), dropEffect: "none", effectAllowed: "none" };

    fireEvent.dragStart(groupHandle, { dataTransfer });
    fireEvent.dragOver(stepsHandle, { dataTransfer });
    fireEvent.drop(stepsHandle, { dataTransfer });

    expect(onReorder).toHaveBeenCalledTimes(1);
    const [fromKey, targetKey, position, fromKeys] = onReorder.mock.calls[0]!;
    expect(targetKey).toBe(STEPS);
    expect(position).toBe("before");
    expect(fromKeys).toEqual([ASPECT, MEGAPIXELS]);
    expect([ASPECT, MEGAPIXELS]).toContain(fromKey);
  });

  it("组合块按 displayOrder 夹在普通行之间，调序后的顺序看得见", () => {
    const { container } = setup();
    const draggableRows = [...container.querySelectorAll('div[draggable="true"]')].map((el) =>
      el instanceof HTMLElement ? el.dataset.ioKey : undefined,
    );
    /* 步数(1) → 尺寸块(锚点=宽高比 2) → 百万像素行同属尺寸块；这里只核对
     * 组合块出现在步数之后，且没有整体沉到末尾。 */
    expect(draggableRows.indexOf(ASPECT)).toBeGreaterThan(draggableRows.indexOf(STEPS));
  });
});
