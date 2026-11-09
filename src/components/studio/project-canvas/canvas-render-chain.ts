/**
 * canvas-render-chain — 项目画布（ProjectCanvas + canvas/*）的「渲染链路模块」规则。
 * 公共链路所有节点共用（ProjectCanvas / CanvasNode / canvas-types / canvas-store）；各 kind 追加 workflow / image-video / script / agent / text-picture-movie 模块，未知 kind 只显示公共链路；
 * 供 DebugChainFooter 渲染调试标签。
 */

import type { RenderChainModule } from "../debug/DebugChainFooter";
import type { NodeKind } from "~/lib/project-canvas/canvas-types";

/** 项目画布所有节点共用的渲染链路（不随 kind 变化）。
 *  scope: canvas=画布级（容器/编排/状态层），node=节点级（节点渲染/类型）。 */
const CANVAS_COMMON: Array<RenderChainModule> = [
  {
    file: "src/components/studio/ProjectCanvas.tsx",
    label: "ProjectCanvas",
    scope: "canvas",
  },
  {
    file: "src/components/studio/project-canvas/CanvasNode.tsx",
    label: "CanvasNode",
    scope: "node",
  },
  {
    file: "src/lib/project-canvas/canvas-types.ts",
    label: "canvas-types",
    scope: "node",
  },
  {
    file: "src/lib/project-canvas/canvas-store.ts",
    label: "canvas-store",
    scope: "canvas",
  },
];

/** 按 kind 追加的渲染链路（不含公共链路） */
const KIND_CHAIN: Record<NodeKind, Array<RenderChainModule>> = {
  workflow: [
    {
      file: "src/components/studio/project-canvas/WorkflowNode.tsx",
      label: "WorkflowNode",
    },
    {
      file: "src/components/studio/shared/workflow-io.ts",
      label: "workflow-io",
    },
  ],
  image: [
    {
      file: "src/components/studio/project-canvas/ImageGenerationPanel.tsx",
      label: "ImageGenerationPanel",
    },
    {
      file: "src/lib/project-canvas/canvas-helpers.ts",
      label: "canvas-helpers",
    },
  ],
  video: [
    {
      file: "src/components/studio/project-canvas/ImageGenerationPanel.tsx",
      label: "ImageGenerationPanel",
    },
    {
      file: "src/lib/project-canvas/canvas-helpers.ts",
      label: "canvas-helpers",
    },
  ],
  script: [
    {
      file: "src/lib/project-canvas/canvas-helpers.ts",
      label: "canvas-helpers",
    },
  ],
  agent: [
    { file: "src/lib/agent/agentic.ts", label: "agentic" },
    {
      file: "src/lib/project-canvas/canvas-helpers.ts",
      label: "canvas-helpers",
    },
  ],
  text: [
    {
      file: "src/components/studio/project-canvas/ContentAssetNode.tsx",
      label: "ContentAssetNode",
    },
  ],
  picture: [
    {
      file: "src/components/studio/project-canvas/ContentAssetNode.tsx",
      label: "ContentAssetNode",
    },
  ],
  movie: [
    {
      file: "src/components/studio/project-canvas/ContentAssetNode.tsx",
      label: "ContentAssetNode",
    },
  ],
};

/**
 * 返回项目画布中指定 kind 节点卡片的渲染链路模块列表。
 * 未知 kind 只返回公共链路（设计文档错误处理：未知 kind → 只显示公共链路）。
 */
export function getProjectCanvasRenderChain(kind: NodeKind): Array<RenderChainModule> {
  const extra = KIND_CHAIN[kind];
  /* 运行期防御：kind 可能来自外部 JSON，落在 NodeKind 联合之外时
   * 索引结果为 undefined（类型层面不可达，但保留既有兜底语义）。 */
  if (extra === undefined) {
    return [...CANVAS_COMMON];
  }
  return [...CANVAS_COMMON, ...extra];
}
