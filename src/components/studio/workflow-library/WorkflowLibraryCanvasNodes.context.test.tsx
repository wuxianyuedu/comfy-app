// 三条 content context 的隔离契约（#4467）：宿主内容里是整张表单，keystroke
// 之间必然变化 —— 拆分后左 / 右两列的 context value 不随之变，memo 的节点
// 组件不该被宿主表单的输入拖着重渲（修复前单一 context 每帧新建，三列整棵
// 重渲、端口多时可感知卡顿）。
//
// 每列按**画布里的真实组合**摆：Provider（不 memo）+ memo 的节点组件。
// Profiler 放在 Provider 之内——它本身会随外层重渲，所以外层再包一层与
// 画布同构的 memo（内容不变即整段 bail out），计数才只反映「这一列真的
// 重渲了」。
import { memo, Profiler, useCallback, type ProfilerOnRenderCallback } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { NodeProps } from "@xyflow/react";

import type { LibraryNodeContent } from "./workflow-library-wire-graph";
import {
  LibraryHostContentContext,
  LibraryHostNode,
  LibraryOutputsContentContext,
  LibraryOutputsNode,
  LibraryParamsContentContext,
  LibraryParamsNode,
} from "./WorkflowLibraryCanvasNodes";

/* SAFETY: 节点组件不读 props（_props），测试里给空对象即可。 */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const EMPTY_NODE_PROPS = {} as unknown as NodeProps;

function makeParamsContent(): LibraryNodeContent["params"] {
  return {
    cards: {
      entries: [],
      io: null,
      isManual: () => false,
      ownersByPin: {},
      resolved: {},
      wiredDotKeys: new Set<string>(),
      wires: [],
    },
    contractEntries: [],
    canWire: false,
    selectedEntryId: null,
    onSelect: vi.fn(),
    onReset: vi.fn(),
  };
}

function makeOutputsContent(): LibraryNodeContent["outputs"] {
  return {
    cards: { isManual: () => false, outputs: [], resolved: {}, wired: false, wires: [] },
    canWire: false,
    selectedOutputId: null,
    onSelect: vi.fn(),
    onReset: vi.fn(),
  };
}

function makeHostContent(label: string): LibraryNodeContent["host"] {
  return { host: <div>{label}</div> };
}

const ParamsSection = memo(function ParamsSection({
  content,
  onRender,
}: {
  content: LibraryNodeContent["params"];
  onRender: ProfilerOnRenderCallback;
}) {
  return (
    <LibraryParamsContentContext.Provider value={content}>
      <Profiler id="params" onRender={onRender}>
        <LibraryParamsNode {...EMPTY_NODE_PROPS} />
      </Profiler>
    </LibraryParamsContentContext.Provider>
  );
});

const HostSection = memo(function HostSection({
  content,
  onRender,
}: {
  content: LibraryNodeContent["host"];
  onRender: ProfilerOnRenderCallback;
}) {
  return (
    <LibraryHostContentContext.Provider value={content}>
      <Profiler id="host" onRender={onRender}>
        <LibraryHostNode {...EMPTY_NODE_PROPS} />
      </Profiler>
    </LibraryHostContentContext.Provider>
  );
});

const OutputsSection = memo(function OutputsSection({
  content,
  onRender,
}: {
  content: LibraryNodeContent["outputs"];
  onRender: ProfilerOnRenderCallback;
}) {
  return (
    <LibraryOutputsContentContext.Provider value={content}>
      <Profiler id="outputs" onRender={onRender}>
        <LibraryOutputsNode {...EMPTY_NODE_PROPS} />
      </Profiler>
    </LibraryOutputsContentContext.Provider>
  );
});

function Harness(props: {
  host: LibraryNodeContent["host"];
  outputs: LibraryNodeContent["outputs"];
  params: LibraryNodeContent["params"];
  renders: Map<string, number>;
}) {
  /* onRender 必须引用稳定：它进各 Section 的 props，内联箭头会让 memo 失效
   *  （正是 #4467 修的那一类问题，测试自己先别犯）。 */
  const onRender: ProfilerOnRenderCallback = useCallback(
    (id) => {
      props.renders.set(id, (props.renders.get(id) ?? 0) + 1);
    },
    [props.renders],
  );
  return (
    <div>
      <ParamsSection content={props.params} onRender={onRender} />
      <HostSection content={props.host} onRender={onRender} />
      <OutputsSection content={props.outputs} onRender={onRender} />
    </div>
  );
}

describe("三列 content context 的隔离（#4467）", () => {
  it("宿主内容变化只重渲宿主列；左 / 右两列的内容不变则不重渲", () => {
    const params = makeParamsContent();
    const outputs = makeOutputsContent();
    const host1 = makeHostContent("第一版");
    const host2 = makeHostContent("第二版");
    const renders = new Map<string, number>();
    const { rerender } = render(
      <Harness host={host1} outputs={outputs} params={params} renders={renders} />,
    );
    /* 首帧挂载：三列各提交一次。 */
    expect(renders.get("params")).toBe(1);
    expect(renders.get("host")).toBe(1);
    expect(renders.get("outputs")).toBe(1);

    /* 宿主内容变化（等价于表单 keystroke）：只有宿主列重渲。 */
    rerender(<Harness host={host2} outputs={outputs} params={params} renders={renders} />);
    expect(renders.get("host")).toBe(2);
    expect(renders.get("params")).toBe(1);
    expect(renders.get("outputs")).toBe(1);

    /* 左列内容变化：只有左列重渲（宿主内容引用保持不变）。 */
    rerender(
      <Harness host={host2} outputs={outputs} params={makeParamsContent()} renders={renders} />,
    );
    expect(renders.get("params")).toBe(2);
    expect(renders.get("host")).toBe(2);
    expect(renders.get("outputs")).toBe(1);
  });
});
