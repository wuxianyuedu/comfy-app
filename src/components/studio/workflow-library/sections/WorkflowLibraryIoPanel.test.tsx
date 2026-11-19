import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { WorkflowIOMap, WorkflowIOEntry } from "~/components/studio/workflow-io";
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
  const onModesChange = vi.fn();
  const view = render(
    <WorkflowLibraryIoPanel
      activeMode="t2i"
      defaultMode="t2i"
      modes={["t2i", "i2v"]}
      onActiveModeChange={onActiveModeChange}
      onModesChange={onModesChange}
      onPatchWorkflowIO={onPatchWorkflowIO}
      storedIO={stored}
      workflowIO={enriched}
    />,
  );
  return { onPatchWorkflowIO, onActiveModeChange, onModesChange, view };
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

  it("还没有暴露任何 IO 时给出去编辑器勾选的提示", () => {
    render(
      <WorkflowLibraryIoPanel
        activeMode="t2i"
        defaultMode="t2i"
        modes={["t2i"]}
        onActiveModeChange={vi.fn()}
        onModesChange={vi.fn()}
        onPatchWorkflowIO={vi.fn().mockResolvedValue(undefined)}
        storedIO={{}}
        workflowIO={{}}
      />,
    );
    expect(screen.getByText(/还没有暴露任何 IO/)).toBeInTheDocument();
  });
});

/* ISSUE #3800：IO 预览页签与编辑器 IO 面板同一形式 —— 模式数据用真实 modes
 * （不做 [taskType] 兜底），没配模式时给编辑器同款提示，并就地给「选择模式」
 * 入口（MultiModeSelect），不再指去已不存在的「类型」页签。 */
describe("IO 预览页签与编辑器同形（ISSUE #3800）", () => {
  it("模式行右侧挂「选择模式」就地管理入口（MultiModeSelect）", () => {
    setup();
    expect(screen.getByRole("button", { name: "选择模式" })).toBeInTheDocument();
  });

  it("模式页签不挂删除按钮：增删统一走「选择模式」下拉（ISSUE #4073 复审）", () => {
    setup();
    /* 删除 × 与下拉取消勾选本是同一件事；面板内不再留第二入口，也不再弹
     * 二次确认框。两个模式页签各自只剩一个切换按钮。 */
    expect(screen.queryByRole("button", { name: /移除模式/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    /* 模式管理入口（选择模式下拉）仍在，参数表单照常渲染。 */
    expect(screen.getByRole("button", { name: "选择模式" })).toBeInTheDocument();
    expect(screen.getByText("步数")).toBeInTheDocument();
  });

  it("没有真实模式时：表单不渲染，给编辑器同款提示，且仍可就地选模式", () => {
    render(
      <WorkflowLibraryIoPanel
        activeMode={null}
        defaultMode=""
        modes={[]}
        onActiveModeChange={vi.fn()}
        onModesChange={vi.fn()}
        onPatchWorkflowIO={vi.fn().mockResolvedValue(undefined)}
        storedIO={stored}
        workflowIO={enriched}
      />,
    );
    /* 提示与编辑器 IO 面板同一句（口径只有一份，见面板内注释）。 */
    expect(screen.getByText(/该工作流还没有配置模式/)).toBeInTheDocument();
    expect(screen.getByText(/之后才能在这里配置参数/)).toBeInTheDocument();
    /* 出路就在本页签：选择模式入口照常在。 */
    expect(screen.getByRole("button", { name: "选择模式" })).toBeInTheDocument();
    /* 参数表单不渲染（旧兜底会拿 [taskType] 造一个空模式把表单摆出来）。 */
    expect(screen.queryByText("步数")).not.toBeInTheDocument();
  });
});

/* #4458：storedIO 是服务端事实源（原始 DB 列）。「从 JSON 更新」/「同步」摘除
 * IO 口并失效缓存后，草稿若只在上次挂载时播种，下一次编辑会把已摘除的口
 * 整份写回（复活）。这里钉住：外部事实源变化 → 草稿重播种 → 已摘除的口
 * 不随下一次编辑写回。 */
describe("IO 预览草稿随服务端事实源重播种（#4458）", () => {
  const stepsStored = { direction: "input", kind: "widget", nodeId: "7", name: "steps" };
  const seedStored = { direction: "input", kind: "widget", nodeId: "9", name: "seed" };
  const stepsEnriched: WorkflowIOEntry = {
    ...stepsStored,
    direction: "input",
    label: "步数",
    type: "INT",
    defaultValue: 20,
  };
  const seedEnriched: WorkflowIOEntry = {
    ...seedStored,
    direction: "input",
    label: "种子",
    type: "INT",
    defaultValue: 1,
  };
  const stepsKey = "7::widget::steps";
  const seedKey = "9::widget::seed";

  function renderPanel(props: { storedIO: Record<string, unknown>; workflowIO: WorkflowIOMap }) {
    const onPatchWorkflowIO = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <WorkflowLibraryIoPanel
        activeMode="t2i"
        defaultMode="t2i"
        modes={["t2i"]}
        onActiveModeChange={vi.fn()}
        onModesChange={vi.fn()}
        onPatchWorkflowIO={onPatchWorkflowIO}
        storedIO={props.storedIO}
        workflowIO={props.workflowIO}
      />,
    );
    return { onPatchWorkflowIO, view };
  }

  it("服务端摘除的口：重播种后不再被下一次编辑写回", () => {
    const { onPatchWorkflowIO, view } = renderPanel({
      storedIO: { [stepsKey]: stepsStored, [seedKey]: seedStored },
      workflowIO: { [stepsKey]: stepsEnriched, [seedKey]: seedEnriched },
    });

    /* 作者先改「步数」的必填 —— 草稿带上这条编辑。 */
    fireEvent.click(screen.getAllByRole("button", { name: "可选" })[0]!);
    expect(onPatchWorkflowIO).toHaveBeenCalledTimes(1);
    const firstPayload: unknown = onPatchWorkflowIO.mock.calls[0]![0];
    expect(isPlainRecord(firstPayload)).toBe(true);
    if (!isPlainRecord(firstPayload)) {
      throw new Error("落库载荷不是对象");
    }
    expect(Object.keys(firstPayload)).toContain(stepsKey);

    /* 服务端更新 JSON：steps 口被摘除（事实源里只剩 seed）。 */
    view.rerender(
      <WorkflowLibraryIoPanel
        activeMode="t2i"
        defaultMode="t2i"
        modes={["t2i"]}
        onActiveModeChange={vi.fn()}
        onModesChange={vi.fn()}
        onPatchWorkflowIO={onPatchWorkflowIO}
        storedIO={{ [seedKey]: seedStored }}
        workflowIO={{ [seedKey]: seedEnriched }}
      />,
    );
    expect(screen.queryByText("步数")).not.toBeInTheDocument();

    /* 再编辑「种子」：落库载荷里不应再把已摘除的 steps 写回。 */
    fireEvent.click(screen.getAllByRole("button", { name: "可选" })[0]!);
    expect(onPatchWorkflowIO).toHaveBeenCalledTimes(2);
    const secondPayload: unknown = onPatchWorkflowIO.mock.calls[1]![0];
    expect(isPlainRecord(secondPayload)).toBe(true);
    if (!isPlainRecord(secondPayload)) {
      throw new Error("落库载荷不是对象");
    }
    expect(Object.keys(secondPayload)).toEqual([seedKey]);
  });
});
