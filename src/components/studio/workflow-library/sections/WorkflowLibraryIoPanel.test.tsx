import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { WorkflowIOMap } from "~/components/studio/workflow-io";
import { isPlainRecord } from "~/lib/is-record";
import { WorkflowLibraryIoPanel } from "./WorkflowLibraryIoPanel";

afterEach(cleanup);

/** 服务端富化后的条目（带 type / label / defaultValue）。 */
const enriched: WorkflowIOMap = {
  "7::widget::steps": {
    direction: "input",
    kind: "widget",
    nodeId: "7",
    name: "steps",
    label: "步数",
    type: "INT",
    defaultValue: 20,
  },
};

/** 模板原始 DB 列：只有身份字段（富化字段不该由这里写回）。 */
const stored = {
  "7::widget::steps": {
    direction: "input",
    kind: "widget",
    nodeId: "7",
    name: "steps",
  },
};

function setup() {
  const onPatchWorkflowIO = vi.fn().mockResolvedValue(undefined);
  const onActiveModeChange = vi.fn();
  const view = render(
    <WorkflowLibraryIoPanel
      activeMode="t2i"
      modes={["t2i", "i2v"]}
      onActiveModeChange={onActiveModeChange}
      onPatchWorkflowIO={onPatchWorkflowIO}
      storedIO={stored}
      workflowIO={enriched}
    />,
  );
  return { onPatchWorkflowIO, onActiveModeChange, view };
}

describe("工作流库 IO 预览页签（ISSUE #3632）", () => {
  it("渲染富化后的参数行，并以原始 DB 列为落库底稿", () => {
    setup();
    expect(screen.getByText("步数")).toBeInTheDocument();
    /* 类型芯片来自富化条目：证明显示源取的是 workflowIO，不是原始列。 */
    expect(screen.getByText("INT")).toBeInTheDocument();
  });

  it("切换必填：把 required 写进当前模式覆盖并即时落库（不改富化字段）", () => {
    const { onPatchWorkflowIO } = setup();
    /* 「可选 / 必填」是行内带可见文字的编辑态按钮，点它即触发一次整列落库。 */
    fireEvent.click(screen.getByRole("button", { name: "可选" }));

    expect(onPatchWorkflowIO).toHaveBeenCalledTimes(1);
    const payload: unknown = onPatchWorkflowIO.mock.calls[0]![0];
    expect(isPlainRecord(payload)).toBe(true);
    if (!isPlainRecord(payload)) {
      throw new Error("落库载荷不是对象");
    }
    const steps = payload["7::widget::steps"];
    expect(isPlainRecord(steps)).toBe(true);
    if (!isPlainRecord(steps)) {
      throw new Error("steps 条目不是对象");
    }
    expect(steps.modeOverrides).toEqual({ t2i: { required: true } });
    /* 落库底稿里没有富化字段：type / label / defaultValue 没被写回。 */
    expect(steps).not.toHaveProperty("type");
    expect(steps).not.toHaveProperty("defaultValue");
  });

  it("没有模式时表单不渲染，并给出可行动提示", () => {
    render(
      <WorkflowLibraryIoPanel
        activeMode={null}
        modes={[]}
        onActiveModeChange={vi.fn()}
        onPatchWorkflowIO={vi.fn().mockResolvedValue(undefined)}
        storedIO={stored}
        workflowIO={enriched}
      />,
    );
    expect(screen.getByText(/没有配置模式，参数配置暂不可用/)).toBeInTheDocument();
  });

  it("还没有暴露任何 IO 时给出去编辑器勾选的提示", () => {
    render(
      <WorkflowLibraryIoPanel
        activeMode="t2i"
        modes={["t2i"]}
        onActiveModeChange={vi.fn()}
        onPatchWorkflowIO={vi.fn().mockResolvedValue(undefined)}
        storedIO={{}}
        workflowIO={{}}
      />,
    );
    expect(screen.getByText(/还没有暴露任何 IO/)).toBeInTheDocument();
  });
});
