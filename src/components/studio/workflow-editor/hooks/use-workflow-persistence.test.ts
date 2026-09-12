// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import type { WorkflowDetail } from "@/components/studio/workflow-types";
import { ToastProvider } from "../../ToastProvider";
import { useWorkflowPersistence } from "./use-workflow-persistence";

/* 「重置布局」的回归护栏。
 *
 * 这条用例钉的是一个曾经静默失效的路径：快照与当前视图来自**不同的
 * id 命名空间**时，`Object.keys(positions).length < nodes.length` 这种
 * 跨命名空间计数会把完整的快照误判成「残缺」，于是重置退化成
 * 「清空本地 positions + Kahn 重排」—— 用户拖动过的节点纹丝不动，按钮看起来
 * 完全没反应。 */

function makeDetail(over: Partial<WorkflowDetail> = {}): WorkflowDetail {
  return {
    id: "wf-1",
    name: "wf",
    taskType: "txt2img",
    graph: {},
    nodes: [],
    paramMap: {},
    workflowIO: {},
    positions: null,
    groups: null,
    notes: null,
    rawNodes: [],
    ...over,
  };
}

function nodesOf(ids: string[]): WorkflowDetail["nodes"] {
  return ids.map((id) => ({
    id,
    class_type: "KSampler",
    title: id,
    raw_inputs: [],
  }));
}

function renderReset(args: {
  detail: WorkflowDetail;
  scopeDetail: WorkflowDetail;
  fitToContent?: () => void;
  hostNodeId?: string;
}) {
  const setDetail = vi.fn();
  const mutate = vi.fn();
  const fitToContent = args.fitToContent ?? vi.fn();
  const { result, rerender } = renderHook(
    (props: { detail: WorkflowDetail; scopeDetail: WorkflowDetail }) =>
      useWorkflowPersistence({
        workflowId: "wf-1",
        detail: props.detail,
        setDetail,
        scopeDetail: props.scopeDetail,
        setNodes: vi.fn(),
        paramMap: {},
        workflowIO: {},
        fitToContent,
        savePatch: { mutate, mutateAsync: vi.fn() },
        onClose: vi.fn(),
        setSaving: vi.fn(),
        setError: vi.fn(),
        hostNodeId: args.hostNodeId,
      }),
    {
      initialProps: { detail: args.detail, scopeDetail: args.scopeDetail },
      // useWorkflowPersistence 内部要 useToast（保存成功提示），必须包在
      // provider 里；少了它整个 hook 直接抛错。用 createElement 而不是 JSX：
      // 本文件的伴生测试与 hook 同走 kebab-case 命名。
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(ToastProvider, null, children),
    },
  );
  rerender({ detail: args.detail, scopeDetail: args.scopeDetail });
  return { result, setDetail, mutate, fitToContent };
}

/** 从 setDetail 的 updater 里取出写回的 positions。 */
function readWrittenPositions(setDetail: ReturnType<typeof vi.fn>, detail: WorkflowDetail) {
  const updater = setDetail.mock.calls.at(-1)?.[0] as
    | ((prev: WorkflowDetail | null) => WorkflowDetail | null)
    | undefined;
  if (!updater) return undefined;
  return updater(detail)?.positions;
}

describe("resetLayout", () => {
  it("快照只含顶层 id、当前视图是子图内部节点时，仍按完整快照还原（不再误判 sparse）", () => {
    /* 服务端 positions 并存两套命名空间：顶层 `4`（wrapper 本体）与
     * `4:1001`（wrapper 内部节点）。当前视图只渲染内部节点。 */
    const positions = {
      "4": [100, 100] as [number, number],
      "4:1001": [1000, 1000] as [number, number],
      "4:1002": [1200, 1000] as [number, number],
    };
    const detail = makeDetail({ positions });
    const scopeDetail = makeDetail({
      nodes: nodesOf(["4:1001", "4:1002"]),
      positions,
    });
    const { result, setDetail, mutate } = renderReset({ detail, scopeDetail });

    // 快照在首次见到 detail.id 时抓取 —— 此刻 positions 已是「原始坐标」。
    act(() => result.current.resetLayout());

    const written = readWrittenPositions(setDetail, detail);
    expect(written).toEqual({
      "4:1001": [1000, 1000],
      "4:1002": [1200, 1000],
    });
    // 顶层命名空间的坐标不能被顺手抹掉。
    expect(written).not.toHaveProperty("4");
    // 同一个 payload 也落库（merge，保住另一命名空间）。
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toMatchObject({
      id: "wf-1",
      positions: { "4:1001": [1000, 1000], "4:1002": [1200, 1000] },
      mergePositions: true,
    });
  });

  it("快照里一个键都不属于当前视图时，按「无快照」走 Kahn 兜底（不写库）", () => {
    const detail = makeDetail({ positions: { "4": [100, 100] as [number, number] } });
    const scopeDetail = makeDetail({
      nodes: nodesOf(["4:1001", "4:1002"]),
      positions: { "4": [100, 100] as [number, number] },
    });
    const { result, setDetail, mutate } = renderReset({ detail, scopeDetail });

    act(() => result.current.resetLayout());

    expect(readWrittenPositions(setDetail, detail)).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("快照真的残缺（本视图节点缺坐标）时，不写库、只清本地走 Kahn", () => {
    const positions = { "1001": [0, 0] as [number, number] };
    const detail = makeDetail({ positions });
    const scopeDetail = makeDetail({
      nodes: nodesOf(["1001", "1002", "1003"]),
      positions,
    });
    const { result, setDetail, mutate } = renderReset({ detail, scopeDetail });

    act(() => result.current.resetLayout());

    expect(readWrittenPositions(setDetail, detail)).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("完整快照：全部节点坐标写回并落库", () => {
    const positions = {
      "1001": [10, 20] as [number, number],
      "1002": [30, 40] as [number, number],
    };
    const detail = makeDetail({ positions });
    const scopeDetail = makeDetail({
      nodes: nodesOf(["1001", "1002"]),
      positions,
    });
    const { result, setDetail, mutate } = renderReset({ detail, scopeDetail });

    act(() => result.current.resetLayout());

    expect(readWrittenPositions(setDetail, detail)).toEqual({
      "1001": [10, 20],
      "1002": [30, 40],
    });
    expect(mutate.mock.calls[0]![0]).toMatchObject({ mergePositions: true });
  });

  it("可拖动的边界导轨坐标一并还原，不因裁剪而丢失", () => {
    const positions = {
      "1001": [10, 20] as [number, number],
      "grp:bpin:inputs": [0, 0] as [number, number],
      "grp:bpin:outputs": [900, 0] as [number, number],
    };
    const detail = makeDetail({ positions });
    const scopeDetail = makeDetail({
      nodes: nodesOf(["1001"]),
      positions,
    });
    const { result, setDetail } = renderReset({ detail, scopeDetail });

    act(() => result.current.resetLayout());

    expect(readWrittenPositions(setDetail, detail)).toEqual({
      "1001": [10, 20],
      "grp:bpin:inputs": [0, 0],
      "grp:bpin:outputs": [900, 0],
    });
  });
});

/* 子图视图的 id 命名空间。
 *
 * 下钻后画布上的节点 id 是**裸内部 id**（`1670`），而 `positions` 列存的
 * 是 `宿主:内部` 拼接键（`4:1670`，见 extractPositions）。两套键各写各的时
 * 会出现「子图里拖的位置顶层看不到、下钻回来又被当成原始坐标盖掉真正的原始
 * 位置」—— 用户看到的就是「重置布局回不到原始工作流，再改一次却回归到一个
 * 错误位置」。下面两条钉住写入与还原都必须走同一个拼接口径。 */
describe("resetLayout · 子图 id 命名空间", () => {
  it("子图内拖动内部节点时，落库的键是 `宿主:内部` 而不是裸内部 id", () => {
    const detail = makeDetail({
      id: "wf-1#subgraph:uid",
      nodes: nodesOf(["1001", "1002"]),
      positions: { "4:1001": [1000, 1000], "4:1002": [1200, 1000] },
    });
    const { result, mutate } = renderReset({
      detail,
      scopeDetail: detail,
      hostNodeId: "4",
    });

    act(() =>
      result.current.onNodeDragStop(
        {},
        { id: "1001", type: "wfNode", position: { x: 30, y: 0 } }
      )
    );

    /* 锚点反演：wfNode 的 y 要加回 NODE_TITLE_H(30)。 */
    expect(mutate.mock.calls.at(-1)![0]).toMatchObject({
      positions: { "4:1001": [30, 30] },
      mergePositions: true,
    });
  });

  it("嵌套子图（宿主链 `4:5`）拼接成 `4:5:内部id`，与运行期口径一致", () => {
    const detail = makeDetail({
      id: "wf-1#subgraph:nested",
      nodes: nodesOf(["1670"]),
      positions: { "4:5:1670": [100, 100] },
    });
    const { result, mutate } = renderReset({
      detail,
      scopeDetail: detail,
      hostNodeId: "4:5",
    });

    act(() =>
      result.current.onNodeDragStop(
        {},
        { id: "1670", type: "wfNode", position: { x: 10, y: 20 } }
      )
    );

    expect(mutate.mock.calls.at(-1)![0]).toMatchObject({
      positions: { "4:5:1670": [10, 50] },
      mergePositions: true,
    });
  });

  it("子图还原只写本视图的拼接键，顶层 wrapper 坐标与导轨坐标都不受影响", () => {
    /* 子图细节（buildSubgraphDetail 的产物）里 positions 是**裸内部 id**，
     * 服务端顶层列里同时躺着 wrapper 本体 `4` 与导轨 `grp:bpin:*`。 */
    const positions = {
      "4": [0, 0] as [number, number],
      "1001": [1000, 1000] as [number, number],
      "1002": [1200, 1000] as [number, number],
      "grp:bpin:inputs": [5, 5] as [number, number],
    };
    const detail = makeDetail({
      id: "wf-1#subgraph:uid",
      nodes: nodesOf(["1001", "1002"]),
      positions,
    });
    const { result, setDetail, mutate } = renderReset({
      detail,
      scopeDetail: detail,
      hostNodeId: "4",
    });

    act(() => result.current.resetLayout());

    /* 本视图还原时把内部 id 拼成与落库同口径的 `宿主:内部`；导轨属于本视图，
     * 原样保留；wrapper 本体 `4` 与当前视图无关，不能被顺手抹掉。 */
    expect(readWrittenPositions(setDetail, detail)).toEqual({
      "4:1001": [1000, 1000],
      "4:1002": [1200, 1000],
      "grp:bpin:inputs": [5, 5],
    });
    expect(mutate.mock.calls.at(-1)![0]).toMatchObject({ mergePositions: true });
  });
});
