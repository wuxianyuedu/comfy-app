"use client";

/**
 * wf-render-chain — workflow-canvas 节点画布的「渲染链路模块」规则。
 *
 * 为 ComfyNode（create-studio 与 CreatePanel 中共用的 workflow-canvas 节点卡片）
 * 列出该节点卡片对应的本项目代码模块，并按 classType 区分链路：
 *  - 内置节点（NODE_TYPE_REGISTRY）：链路落在 node-registry 内置注册表；
 *  - 自定义节点（CUSTOM_NODE_TYPES）：链路追加 customNodes manifest 与包来源。
 *
 * 供 DebugChainFooter 渲染调试标签：点击复制完整相对路径、title 显示完整路径。
 */

import type { RenderChainModule } from "./DebugChainFooter";
import { isCustomNode, getCustomNodePackage } from "@/config/custom-nodes";

/** 所有 ComfyNode 卡片共用的画布渲染链路（不随 classType 变化） */
const WF_CANVAS_COMMON: RenderChainModule[] = [
  { file: "src/components/workflow-canvas/WorkflowCanvas.tsx", label: "WorkflowCanvas" },
  { file: "src/components/workflow-canvas/nodes/ComfyNode.tsx", label: "ComfyNode" },
  { file: "src/components/workflow-canvas/nodes/PackageFooter.tsx", label: "PackageFooter" },
  { file: "src/components/workflow-canvas/node-registry.ts", label: "node-registry" },
  { file: "src/components/workflow-canvas/graph-utils.ts", label: "graph-utils" },
  { file: "src/components/workflow-canvas/types.ts", label: "types" },
];

/**
 * 返回指定 classType 节点卡片的渲染链路模块列表。
 * 按节点类型区分：自定义节点（扩展包）额外标注 customNodes 与包来源模块。
 */
export function getWorkflowCanvasRenderChain(classType: string): RenderChainModule[] {
  const chain = [...WF_CANVAS_COMMON];

  if (isCustomNode(classType)) {
    const pkg = getCustomNodePackage(classType);
    chain.push({
      file: "src/config/custom-nodes.ts",
      label: pkg ? `custom:${pkg}` : "customNodes",
    });
  } else {
    chain.push({
      file: "src/components/workflow-canvas/node-registry.ts",
      label: "builtin-registry",
    });
  }

  return chain;
}
