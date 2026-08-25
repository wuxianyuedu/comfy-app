"use client";

/**
 * graph-preview-render-chain — GraphPreview 只读节点画布的「渲染链路模块」规则。
 *
 * 为 SourceModal「节点画布」tab 中的 MiniWfNode 列出该界面节点卡片对应的
 * 本项目代码模块，并按数据形态（variant: raw / api）与节点角色/类型区分链路：
 *  - raw：LiteGraph 原始布局（buildFromRawJson）
 *  - api：ComfyUI /prompt 最长路径层布局（buildFromApiGraph，算法借鉴
 *    lib/comfyui/workflow.ts:buildWorkflowPreview）
 *  - 角色：classifyNode 按 INPUT_CLASSES / OUTPUT_CLASSES 区分 input/output/process
 *
 * 供 DebugChainFooter 渲染调试标签：点击复制完整相对路径、title 显示完整路径。
 */

import type { RenderChainModule } from "./DebugChainFooter";
import { isCustomNode } from "@/config/custom-nodes";

/** GraphPreview 画布所有节点共用的渲染链路 */
const GRAPH_PREVIEW_COMMON: RenderChainModule[] = [
  { file: "src/components/studio/GraphPreview.tsx", label: "GraphPreview" },
  { file: "src/components/studio/WorkflowEdge.tsx", label: "WorkflowEdge" },
  { file: "src/lib/comfyui/types.ts", label: "comfyui/types" },
];

/** 输入角色节点（classifyNode 判定为 input 的节点集合） */
const INPUT_CLASSES = new Set([
  "CheckpointLoaderSimple",
  "CheckpointLoader",
  "VAELoader",
  "LoraLoader",
  "CLIPLoader",
  "ControlNetLoader",
  "UpscaleModelLoader",
  "LoadImage",
  "LoadImageMask",
  "CLIPTextEncode",
  "CLIPTextEncodeSDXL",
  "CLIPTextEncodeSDXLRefiner",
  "EmptyLatentImage",
  "EmptySD3LatentImage",
  "LatentFromImage",
  "ImageInput",
  "VHS_VideoCombine",
  "ImageBatch",
  "ImageScale",
  "ImagePadForOutpaint",
]);

/** 输出角色节点（classifyNode 判定为 output 的节点集合） */
const OUTPUT_CLASSES = new Set([
  "SaveImage",
  "PreviewImage",
  "SaveLatentImage",
  "SaveAnimatedWEBP",
  "SaveAnimatedPNG",
  "VHS_VideoSave",
  "SaveVideo",
  "SaveAudio",
]);

function classifyNode(classType: string): "input" | "output" | "process" {
  if (INPUT_CLASSES.has(classType)) return "input";
  if (OUTPUT_CLASSES.has(classType)) return "output";
  return "process";
}

/**
 * 返回 GraphPreview 画布中某节点卡片的渲染链路模块列表。
 * @param variant 数据形态来源（raw: LiteGraph 原始布局；api: 最长路径层布局）
 * @param classType 节点类型（用于区分 input/output/process 角色与自定义节点）
 */
export function getGraphPreviewRenderChain(
  variant: "raw" | "api",
  classType: string,
): RenderChainModule[] {
  const chain = [...GRAPH_PREVIEW_COMMON];

  if (variant === "raw") {
    chain.push({
      file: "src/components/studio/GraphPreview.tsx",
      label: "buildFromRawJson",
    });
  } else {
    chain.push({
      file: "src/components/studio/GraphPreview.tsx",
      label: "buildFromApiGraph",
    });
    chain.push({
      file: "src/lib/comfyui/workflow.ts",
      label: "workflow.buildWorkflowPreview",
    });
  }

  const role = classifyNode(classType);
  chain.push({
    file: "src/components/studio/GraphPreview.tsx",
    label: role === "input" ? "role:input" : role === "output" ? "role:output" : "role:process",
  });

  if (isCustomNode(classType)) {
    chain.push({
      file: "src/config/custom-nodes.ts",
      label: "customNodes",
    });
  }

  return chain;
}
