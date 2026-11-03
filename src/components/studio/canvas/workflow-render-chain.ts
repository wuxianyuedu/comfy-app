/**
 * wf-render-chain — 工作流画布（wf-* 系列）的渲染链路模块规则。
 * 按 classType 列出节点卡片对应的本项目模块：公共链路 wf-node.tsx / comfyui/types.ts / node-titles.ts；
 * 内置节点（NODE_TYPE_REGISTRY）追加 node-registry.ts；自定义节点追加 config/custom-nodes.ts 与 api/custom-nodes/route.ts；
 * 无匹配 registry 且非自定义（note / subgraph）只给公共链路。供 DebugChainFooter 渲染调试标签（点击复制完整路径、title 显示完整路径）。 */

import type { RenderChainModule } from "../debug/DebugChainFooter";
import { NODE_TYPE_REGISTRY } from "~/lib/comfyui/node-registry";
import { isCustomNode, getCustomNodePackage } from "~/config/custom-nodes";

/** 工作流画布所有节点共用的渲染链路（不随 classType 变化） */
const WF_COMMON: Array<RenderChainModule> = [
  { file: "src/components/studio/workflow-node.tsx", label: "workflow-node" },
  { file: "src/lib/comfyui/types.ts", label: "comfyui/types" },
  { file: "src/lib/comfyui/node-titles.ts", label: "node-titles" },
];

/**
 * 返回指定 classType 的渲染链路模块：内置节点追加 node-registry；
 * 自定义节点追加 customNodes manifest 与后端 route；其余只返回公共链路。
 */
export function getWorkflowRenderChainModules(classType: string): Array<RenderChainModule> {
  const chain = [...WF_COMMON];

  if (isCustomNode(classType)) {
    const pkg = getCustomNodePackage(classType);
    chain.push({
      file: "src/config/custom-nodes.ts",
      label: pkg !== undefined && pkg !== "" ? `custom:${pkg}` : "customNodes",
    });
    chain.push({
      file: "src/app/api/custom-nodes/route.ts",
      label: "api/custom-nodes",
    });
  } else if (classType in NODE_TYPE_REGISTRY) {
    chain.push({
      file: "src/lib/comfyui/node-registry.ts",
      label: "node-registry",
    });
  }

  return chain;
}
