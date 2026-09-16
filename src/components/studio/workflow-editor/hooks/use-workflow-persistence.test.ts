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
  fitToContent?: () => void;
  hostNodeId?: string;
  reloadView?: () => void;
}) {
  const setDetail = vi.fn();
  const mutate = vi.fn();
  const fitToContent = args.fitToContent ?? vi.fn();
  const { result, rerender } = renderHook(
    (props: { detail: WorkflowDetail }) =>
      useWorkflowPersistence({
        workflowId: "wf-1",
        detail: props.detail,
        setDetail,
        setNodes: vi.fn(),
        paramMap: {},
        workflowIO: {},
        fitToContent,
        savePatch: { mutate, mutateAsync: vi.fn() },
        onClose: vi.fn(),
        setSaving: vi.fn(),
        setError: vi.fn(),
        reloadView: args.reloadView,
        hostNodeId: args.hostNodeId,
      }),
    {
      initialProps: { detail: args.detail },
      // useWorkflowPersistence 内部要 useToast（保存成功提示），必须包在
      // provider 里；少了它整个 hook 直接抛错。用 createElement 而不是 JSX：
      // 本文件的伴生测试与 hook 同走 kebab-case 命名。
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(ToastProvider, null, children),
    },
  );
  rerender({ detail: args.detail });
  return { result, setDetail, mutate, fitToContent };
}

/** 从 setDetail 的 updater 里取出写回的 positions。 */
function readWrittenPositions(
  setDetail: ReturnType<typeof vi.fn>,
  detail: WorkflowDetail,
) {
  const updater = setDetail.mock.calls.at(-1)?.[0] as
    ((prev: WorkflowDetail | null) => WorkflowDetail | null) | undefined;
  if (!updater) return undefined;
  return updater(detail)?.positions;
}

describe("resetLayout", () => {
  it("重置 = 清除本视图坐标覆盖：向服务端发 resetPositionsScope，本地同步剔除", () => {
    const positions = {
      "1001": [10, 20] as [number, number],
      "1002": [30, 40] as [number, number],
    };
    const detail = makeDetail({ positions });
    const { result, setDetail, mutate } = renderReset({ detail });

    act(() => result.current.resetLayout());

    /* 顶层视图 → 空串 scope。 */
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toEqual({
      id: "wf-1",
      resetPositionsScope: "",
    });
    /* 本地坐标整片清掉：重拉之前画布也不该继续显示旧覆盖。 */
    expect(readWrittenPositions(setDetail, detail)).toBeNull();
  });

  it("重置必须重新拉取当前视图（否则画布停在本地剔除后的中间态）", () => {
    const detail = makeDetail({
      positions: { "1001": [10, 20] as [number, number] },
    });
    const reloadView = vi.fn();
    const { result, fitToContent } = renderReset({
      detail,
      reloadView,
    });

    act(() => result.current.resetLayout());

    expect(reloadView).toHaveBeenCalledTimes(1);
    /* 有重拉就不再自己 fit：重拉回来的数据会触发一次新的 fit。 */
    expect(fitToContent).not.toHaveBeenCalled();
  });

  it("顶层重置只清裸 id，子图命名空间的键与导轨之外的同层数据原样保留", () => {
    const positions = {
      "4": [100, 100] as [number, number],
      "4:1670": [1000, 1000] as [number, number],
      "grp:bpin:inputs": [0, 0] as [number, number],
    };
    const detail = makeDetail({
      nodes: nodesOf(["4"]),
      positions,
    });
    const { result, setDetail, mutate } = renderReset({
      detail,
    });

    act(() => result.current.resetLayout());

    /* 子图内部节点的坐标属于下钻视图，顶层重置不该碰。 */
    expect(readWrittenPositions(setDetail, detail)).toEqual({
      "4:1670": [1000, 1000],
    });
    expect(mutate.mock.calls[0]![0]).toEqual({
      id: "wf-1",
      resetPositionsScope: "",
    });
  });

  it("没有坐标覆盖时重置是空操作（不发请求、不产生多余状态）", () => {
    const detail = makeDetail({ positions: null });
    const { result, setDetail } = renderReset({ detail });

    act(() => result.current.resetLayout());

    expect(readWrittenPositions(setDetail, detail)).toBeNull();
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
      hostNodeId: "4",
    });

    act(() =>
      result.current.onNodeDragStop(
        {},
        { id: "1001", type: "wfNode", position: { x: 30, y: 0 }, data: {} },
      ),
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
      hostNodeId: "4:5",
    });

    act(() =>
      result.current.onNodeDragStop(
        {},
        { id: "1670", type: "wfNode", position: { x: 10, y: 20 }, data: {} },
      ),
    );

    expect(mutate.mock.calls.at(-1)![0]).toMatchObject({
      positions: { "4:5:1670": [10, 50] },
      mergePositions: true,
    });
  });

  it("子图重置只清本层的拼接键，顶层 wrapper 坐标与导轨坐标都不受影响", () => {
    /* 子图视图下 `positions` 里混着三套东西：wrapper 本体 `4`（顶层视图的
     *  布局）、`4:1670`（本层的拖拽覆盖）、`grp:bpin:*`（外层画布的导轨）。
     *  重置只该清中间那一套。 */
    const positions = {
      "4": [0, 0] as [number, number],
      "4:1001": [1000, 1000] as [number, number],
      "4:1002": [1200, 1000] as [number, number],
      "grp:bpin:inputs": [5, 5] as [number, number],
    };
    const detail = makeDetail({
      id: "wf-1#subgraph:uid",
      nodes: nodesOf(["1001", "1002"]),
      positions,
    });
    const { result, setDetail, mutate } = renderReset({
      detail,
      hostNodeId: "4",
    });

    act(() => result.current.resetLayout());

    expect(mutate.mock.calls.at(-1)![0]).toEqual({
      id: "wf-1",
      resetPositionsScope: "4",
    });
    expect(readWrittenPositions(setDetail, detail)).toEqual({
      "4": [0, 0],
      "grp:bpin:inputs": [5, 5],
    });
  });

  it("嵌套子图只清自己那一层，更深的 `4:5:1670` 留给下层视图", () => {
    const positions = {
      "4:5": [0, 0] as [number, number],
      "4:5:1670": [1000, 1000] as [number, number],
      "4:1671": [700, 700] as [number, number],
    };
    const detail = makeDetail({
      id: "wf-1#subgraph:nested",
      nodes: nodesOf(["1670"]),
      positions,
    });
    const { result, setDetail, mutate } = renderReset({
      detail,
      hostNodeId: "4:5",
    });

    act(() => result.current.resetLayout());

    expect(mutate.mock.calls.at(-1)![0]).toEqual({
      id: "wf-1",
      resetPositionsScope: "4:5",
    });
    expect(readWrittenPositions(setDetail, detail)).toEqual({
      "4:5": [0, 0],
      "4:1671": [700, 700],
    });
  });

  it("子图重置后重新拉取当前视图", () => {
    const detail = makeDetail({
      id: "wf-1#subgraph:uid",
      nodes: nodesOf(["1001"]),
      positions: { "4:1001": [1000, 1000] as [number, number] },
    });
    const reloadView = vi.fn();
    const { result } = renderReset({
      detail,
      hostNodeId: "4",
      reloadView,
    });

    act(() => result.current.resetLayout());

    expect(reloadView).toHaveBeenCalledTimes(1);
  });
});
