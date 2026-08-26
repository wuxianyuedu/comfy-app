"use client";

/**
 * wf-render-chain — 工作流画布（wf-* 系列）的「渲染链路模块」规则。
 *
 * 为 WorkflowNode（src/components/studio/wf-node.tsx 渲染的工作流画布节点卡片）
 * 列出该节点卡片对应的本项目代码模块，并按 classType 区分链路：
 *  - 公共链路：wf-node.tsx（节点渲染器）、src/lib/comfyui/types.ts（端口/类型推断）、
 *    src/lib/comfyui/node-titles.ts（标题本地化）
 *  - 内置节点（NODE_TYPE_REGISTRY 命中）：追加 node-registry.ts（节点配置定义处）
 *  - 自定义节点（isCustomNode / getCustomNodePackage 命中）：追加
 *    src/config/custom-nodes.ts（manifest 加载）+ src/app/api/custom-nodes/route.ts（后端处理）
 *  - 无匹配 registry 且非自定义的 classType（如 note / subgraph）：只显示公共链路
 *
 * 供 DebugChainFooter 渲染调试标签：点击复制完整相对路径、title 显示完整路径。
 */

import type { RenderChainModule } from "./DebugChainFooter";
import { NODE_TYPE_REGISTRY } from "@/components/workflow-canvas/node-registry";
import { isCustomNode, getCustomNodePackage } from "@/config/custom-nodes";

/** 工作流画布所有节点共用的渲染链路（不随 classType 变化） */
const WF_COMMON: RenderChainModule[] = [
  { file: "src/components/studio/workflow-node.tsx", label: "workflow-node" },
  { file: "src/lib/comfyui/types.ts", label: "comfyui/types" },
  { file: "src/lib/comfyui/node-titles.ts", label: "node-titles" },
];

/**
 * 返回指定 classType 节点卡片的渲染链路模块列表。
 * 内置节点（NODE_TYPE_REGISTRY 命中）追加 node-registry；
 * 自定义节点（扩展包）追加 customNodes manifest 与后端 route；
 * 其余 classType（note / subgraph / 未注册）只返回公共链路。
 */
export function getWorkflowRenderChainModules(classType: string): RenderChainModule[] {
  const chain = [...WF_COMMON];

  if (isCustomNode(classType)) {
    const pkg = getCustomNodePackage(classType);
    chain.push({
      file: "src/config/custom-nodes.ts",
      label: pkg ? `custom:${pkg}` : "customNodes",
    });
    chain.push({
      file: "src/app/api/custom-nodes/route.ts",
      label: "api/custom-nodes",
    });
  } else if (classType in NODE_TYPE_REGISTRY) {
    chain.push({
      file: "src/components/workflow-canvas/node-registry.ts",
      label: "node-registry",
    });
  }

  return chain;
}
