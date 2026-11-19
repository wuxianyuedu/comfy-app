// 参考图挂载编辑态 hook 的行为契约（#4534 / #4547）：
//  1) 编辑态里点击节点 → 标记 / 取消，并即时落库（savePatch）；
//  2) 连点多个节点要能**累积**（#4547 回归）：标记写入先同步编辑器本地
//     paramMap（乐观），下一次点击基于新名单计算 —— 只写服务端不更新本地时，
//     第二次点击读到旧名单，第一次的标记被覆盖（只剩最后点的那个）；
//  3) 被标记节点带 ref-mount-node 高亮类；非编辑态下点击是空操作。
import { useState } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Node } from "@xyflow/react";

import { isRecord } from "~/lib/is-record";

import { useReferenceMountMode } from "./use-reference-mount-mode";
import type { WorkflowSaveInput, WorkflowSaver } from "./use-workflow-save";

/** 落库载荷里的 paramMap 收窄（WorkflowSaveInput 的 paramMap 是 unknown）。 */
function paramMapOf(call: WorkflowSaveInput): Record<string, unknown> {
  return isRecord(call.paramMap) ? call.paramMap : {};
}

const NODES: Array<Node> = [
  { id: "69", data: {}, position: { x: 0, y: 0 } },
  { id: "34", data: {}, position: { x: 100, y: 0 } },
];

const PARAM_MAP = {
  source: { "mode:T2I": { prompt: "1::param::text" } },
};

const mutate = vi.fn<WorkflowSaver["mutate"]>();
const mutateAsync = vi.fn<WorkflowSaver["mutateAsync"]>();
const savePatch: WorkflowSaver = { mutate, mutateAsync };

/* React 合成事件的测试替身：handleNodeClick 不读事件对象，形状满足签名即可。 */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 测试替身，不经类型守卫直取签名形状
const EVENT = new MouseEvent("click") as unknown as React.MouseEvent;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** 挂真实 useState 的 harness：setParamMap 与编辑器一样更新本地 paramMap，
 *  下一次点击据此累积（正是 #4547 修复要验的链路）。 */
function renderMountHook(paramMap: Record<string, unknown> = PARAM_MAP) {
  return renderHook(() => {
    const [localParamMap, setParamMap] = useState(paramMap);
    const ctrl = useReferenceMountMode({
      workflowId: "wf-1",
      paramMap: localParamMap,
      graphNodes: NODES,
      savePatch,
      setParamMap,
    });
    return { ...ctrl, paramMap: localParamMap };
  });
}

function nodeById(id: string): Node {
  const node = NODES.find((n) => n.id === id);
  if (!node) {
    throw new Error(`测试节点缺失：${id}`);
  }
  return node;
}

describe("useReferenceMountMode", () => {
  it("编辑态外点击是空操作：不写本地 paramMap、不落库", () => {
    const { result } = renderMountHook();
    act(() => {
      result.current.handleNodeClick(EVENT, nodeById("69"));
    });
    expect(result.current.paramMap).toEqual(PARAM_MAP);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("编辑态里点击节点 → 标记 + 本地 paramMap 同步 + 即时落库", () => {
    const { result } = renderMountHook();
    act(() => {
      result.current.toggleRefMountMode();
    });
    act(() => {
      result.current.handleNodeClick(EVENT, nodeById("69"));
    });
    expect(result.current.mountedNodeIds).toEqual(["69"]);
    expect(result.current.paramMap.referenceLoaders).toEqual({ mountNodeIds: ["69"] });
    /* 落库的是同一份 paramMap（source 等其余键原样保留）。 */
    expect(mutate).toHaveBeenCalledTimes(1);
    const payload = mutate.mock.calls[0]![0];
    expect(payload.id).toBe("wf-1");
    const payloadMap = paramMapOf(payload);
    expect(payloadMap.source).toEqual(PARAM_MAP.source);
    expect(payloadMap.referenceLoaders).toEqual({ mountNodeIds: ["69"] });
  });

  it("连点两个节点标记累积（#4547 回归：第二次点击基于已同步的本地名单）", () => {
    const { result } = renderMountHook();
    act(() => {
      result.current.toggleRefMountMode();
    });
    act(() => {
      result.current.handleNodeClick(EVENT, nodeById("69"));
    });
    act(() => {
      result.current.handleNodeClick(EVENT, nodeById("34"));
    });
    expect(result.current.mountedNodeIds).toEqual(["69", "34"]);
    expect(mutate).toHaveBeenCalledTimes(2);
    const second = paramMapOf(mutate.mock.calls[1]![0]);
    expect(second.referenceLoaders).toEqual({ mountNodeIds: ["69", "34"] });
  });

  it("再点已标记节点 → 取消标记（列表回到其余标记）", () => {
    const { result } = renderMountHook();
    act(() => {
      result.current.toggleRefMountMode();
    });
    act(() => {
      result.current.handleNodeClick(EVENT, nodeById("69"));
    });
    act(() => {
      result.current.handleNodeClick(EVENT, nodeById("34"));
    });
    act(() => {
      result.current.handleNodeClick(EVENT, nodeById("69"));
    });
    expect(result.current.mountedNodeIds).toEqual(["34"]);
  });

  it("被标记节点带 ref-mount-node 高亮类，未标记节点不带", () => {
    const { result } = renderMountHook();
    act(() => {
      result.current.toggleRefMountMode();
    });
    act(() => {
      result.current.handleNodeClick(EVENT, nodeById("34"));
    });
    const decorated = result.current.decoratedNodes;
    expect(decorated.find((n) => n.id === "34")?.className).toContain("ref-mount-node");
    expect(decorated.find((n) => n.id === "69")?.className).toBeUndefined();
  });
});
