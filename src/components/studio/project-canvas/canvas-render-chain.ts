"use client";

/**
 * canvas-render-chain — 项目画布（ProjectCanvas + canvas/*）的「渲染链路模块」规则。
 *
 * 为 CanvasNode（项目画布节点卡片）列出该节点卡片对应的本项目代码模块，
 * 并按节点 kind 区分链路：
 *  - 公共链路（所有节点）：ProjectCanvas.tsx（画布容器）、CanvasNode/CanvasNode.tsx
 *    （节点渲染器）、src/lib/project-canvas/canvas-types.ts（节点类型/元数据）、
 *    src/lib/project-canvas/canvas-store.ts（项目数据持久化）
 *  - workflow：追加 WorkflowNode.tsx + shared/workflow-io.ts
 *  - image / video：追加 ImageGenerationPanel.tsx +
 *    src/lib/project-canvas/canvas-helpers.ts（startGenerate / pollTask）
 *  - script：追加 src/lib/project-canvas/canvas-helpers.ts（runScript）
 *  - agent：追加 src/lib/agent/agentic.ts +
 *    src/lib/project-canvas/canvas-helpers.ts
 *  - text / picture / movie：追加 ContentAssetNode.tsx
 *  - 未知 kind：只显示公共链路
 *
 * 供 DebugChainFooter 渲染调试标签：点击复制完整相对路径、title 显示完整路径。
 */

import type { RenderChainModule } from "../debug/DebugChainFooter";
import type { NodeKind } from "~/lib/project-canvas/canvas-types";

/** 项目画布所有节点共用的渲染链路（不随 kind 变化）。
 *  scope: canvas=画布级（容器/编排/状态层），node=节点级（节点渲染/类型）。 */
const CANVAS_COMMON: RenderChainModule[] = [
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
const KIND_CHAIN: Record<NodeKind, RenderChainModule[]> = {
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
export function getProjectCanvasRenderChain(
  kind: NodeKind,
): RenderChainModule[] {
  const extra = KIND_CHAIN[kind];
  if (!extra) return [...CANVAS_COMMON];
  return [...CANVAS_COMMON, ...extra];
}
