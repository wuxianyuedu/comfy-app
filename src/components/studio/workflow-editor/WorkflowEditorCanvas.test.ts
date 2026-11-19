// 画布 error#008 假告警过滤器（纯函数）—— ISSUE #374
// 本画布开着 `onlyRenderVisibleElements`：节点裁剪按各自与视口求交，边的裁剪按两端
// 节点的并集包围盒求交。横跨画布的长边因此「可见」，但两端节点都在视口外、没有挂载
// → handleBounds 为空 → error#008，这类告警该忽略（滚过去就正常）；两端都挂载还报错
// 说明渲染的 handle id 与边引用的不同名，是真 bug，必须暴露。

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { isEdgeHandleCullingNoise } from "./WorkflowEditorCanvas";

/* 读取画布源码的相对路径解析（与 WorkflowCanvasNodePreview.wiring.test.tsx 同款）。 */
function readCanvasSource(): string {
  return readFileSync(path.join(import.meta.dirname, "WorkflowEditorCanvas.tsx"), "utf8");
}

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

describe("非受控初值（#4548）", () => {
  it("defaultEdges 必须在场（空数组也算），否则 rf.setEdges 是静默空操作", () => {
    /* jsdom 里 React Flow 渲不出边（ResizeObserver 是桩、量不到 handleBounds），
     * 只能锁源码形态：React Flow 的 `rf.setEdges` 把更新丢进批处理队列，队列只在
     * `hasDefaultEdges` 为真时才写 store —— #4536 改非受控时只传了 defaultNodes，
     * 连线同步全部空转，画布上表现为「连线消失」（#4548）。项目画布 / 库画布
     * （#4541）同一条坑已有同款护栏，这里把编辑器画布也钉住。 */
    const canvas = readCanvasSource();
    expect(canvas).toMatch(/defaultEdges=\{INITIAL_EDGES\}/);
    /* INITIAL_EDGES 必须是模块级常量（保持引用稳定），缺省即丢同一条护栏。 */
    expect(canvas).toMatch(/const INITIAL_EDGES: Array<Edge> = \[\];/);
  });
});
