// 画布 error#008 假告警过滤器（纯函数）—— ISSUE #374
//
// 本画布开着 `onlyRenderVisibleElements`：节点裁剪按每个节点各自与视口求交，
// 而边的裁剪按两端节点的并集包围盒求交。横跨整个画布的长边会因此「可见」，
// 但两端节点各自都在视口外、没有挂载 —— handleBounds 为空，React Flow 打出
// error#008。这类告警该忽略（用户滚过去线就正常了）；而两端都挂载还报错，
// 说明渲染的 handle id 与边引用的 id 不同名，是真 bug，必须继续暴露。

import { describe, expect, it } from "vitest";

import { isEdgeHandleCullingNoise } from "./WorkflowEditorCanvas";

const MSG =
  'Couldn\'t create edge for source handle id: "out:MODEL_1", edge id: e-1512-18-model-0. Help: https://reactflow.dev/error#008';

describe("isEdgeHandleCullingNoise", () => {
  it("端点未挂载 → 判为裁剪噪声（长边跨视口，端点各自在视口外）", () => {
    expect(
      isEdgeHandleCullingNoise({
        message: MSG,
        mountedNodeIds: new Set(["7", "9"]),
        sourceId: "1512",
        targetId: "18",
      }),
    ).toBe(true);
  });

  it("只有一端未挂载也算裁剪噪声", () => {
    expect(
      isEdgeHandleCullingNoise({
        message: MSG,
        mountedNodeIds: new Set(["1512"]),
        sourceId: "1512",
        targetId: "18",
      }),
    ).toBe(true);
  });

  it("两端都挂载还报错 → 真问题，不能吞掉（handle id 不同名）", () => {
    expect(
      isEdgeHandleCullingNoise({
        message: MSG,
        mountedNodeIds: new Set(["1512", "18"]),
        sourceId: "1512",
        targetId: "18",
      }),
    ).toBe(false);
  });

  it("非 error#008 的告警一律放行", () => {
    expect(
      isEdgeHandleCullingNoise({
        message: 'Node type "nope" not found. Using fallback type "default".',
        mountedNodeIds: new Set(),
        sourceId: null,
        targetId: null,
      }),
    ).toBe(false);
  });

  it("边引用的节点已不存在（端点信息缺失）→ 放行，交回 React Flow", () => {
    expect(
      isEdgeHandleCullingNoise({
        message: MSG,
        mountedNodeIds: new Set(["1512"]),
        sourceId: null,
        targetId: "18",
      }),
    ).toBe(false);
    expect(
      isEdgeHandleCullingNoise({
        message: MSG,
        mountedNodeIds: new Set(["1512"]),
        sourceId: "1512",
        targetId: null,
      }),
    ).toBe(false);
  });
});
