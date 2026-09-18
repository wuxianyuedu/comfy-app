/* ── 项目画布的纯函数工具（第①层配置 / 第②层逻辑中的无副作用部分）──
 * 本文件只放「不产生网络请求、不读写外部状态」的派生函数，因此可以直接单测，
 * 也不受 UI/逻辑分离棘轮的 S1/S2 计数约束（见 docs/standards/17 §17.2）。
 *
 * 需要发请求的那部分（上传 / 启动生成 / 轮询任务 / LLM 扩写）已迁到同目录的
 * canvas-api.ts —— 那是第②层的网络部分，视图一律不得直接 fetch。
 */

import type { Edge, FitViewOptions } from "@xyflow/react";
import {
  type CanvasNodeType,
  type CanvasNodeData,
  isCanvasNode,
} from "./canvas-types";

/** 生成画布节点唯一 id（项目画布各创建入口共用，避免散落重复逻辑）。 */
export function makeNodeId(): string {
  return `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 双 rAF 的 fitView 调度器：等 ReactFlow 完成本轮布局后再 fit，
 *  替代脆弱的 setTimeout(80ms) 魔法数字（慢机器上可能布局未完成）。 */
export function makeFitViewScheduler(
  fitView: (options?: FitViewOptions) => void,
): (padding?: number) => void {
  return (padding = 0.25) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fitView({ padding, duration: 300 });
      });
    });
  };
}

/** 连线传播的纯函数核心：根据 source 节点与出边，把上游数据写入下游节点。
 *  - workflow 节点：按 ioKey 写进 workflowInputs
 *  - picture / movie 内容载体：把上游 image 写入 mediaPath
 *  - 其余节点：按 targetHandle 分派 prompt/negative/steps/cfg/seed/inputImage
 *  workflowArdot 纯视觉节点无数据，直接跳过。 */
export function applyPropagationToNodes(
  nodes: CanvasNodeType[],
  sourceId: string,
  opts: {
    srcData: CanvasNodeData;
    outEdges: Edge[];
    importedFile: string | null;
  },
): CanvasNodeType[] {
  const { srcData: src, outEdges, importedFile } = opts;

  return nodes.map((node) => {
    if (node.id === sourceId) return node;
    if (!isCanvasNode(node)) return node;
    const edge = outEdges.find((outEdge) => outEdge.target === node.id);
    if (!edge) return node;
    const td = node.data;

    // 连线传入自定义工作流节点：按 ioKey 把上游输出写进 workflowInputs，
    // 这样 runGenerate 的 toWorkflowInputsPayload 会把它一起发给后端。
    if (td.kind === "workflow" && edge.targetHandle) {
      const key = edge.targetHandle;
      let stored: unknown = undefined;
      if (src.kind === "text" && src.content?.trim()) stored = src.content;
      else if (
        (src.kind === "picture" || src.kind === "movie") &&
        src.mediaPath
      )
        stored = src.mediaPath;
      else if (
        src.resultPath &&
        src.resultMediaType !== "video" &&
        importedFile
      )
        stored = importedFile;
      if (stored !== undefined) {
        return {
          ...node,
          data: {
            ...td,
            workflowInputs: { ...(td.workflowInputs ?? {}), [key]: stored },
            upstreamId: sourceId,
          },
        };
      }
      return node;
    }

    /* 上游产出写入 picture / movie 资产节点 — 当 target 是 picture 或 movie
     * 内容载体时，把 source 的 image (importedFile 优先于 src.mediaPath) 写到
     * target.mediaPath，让图片资产自动接收工作流生成的图作为内容；下游生图
     * 节点再从 picture 节点的 output Handle 接收这个 mediaPath，形成
     * 「工作流 → 图片资产 → 生图」完整链路。upstreamId 标记数据来源便于 UI
     * 后续显示「连线源：xxx 工作流」。 */
    if (td.kind === "picture" || td.kind === "movie") {
      const incoming: string | undefined =
        importedFile ??
        (src.kind === "picture" || src.kind === "movie"
          ? (src.mediaPath ?? undefined)
          : undefined);
      if (incoming) {
        return {
          ...node,
          data: {
            ...td,
            mediaPath: incoming,
            mediaName: src.resultPath
              ? String(src.resultPath).split(/[\\/]/).pop()
              : td.mediaName,
            upstreamId: sourceId,
          },
        };
      }
      return node;
    }

    const next: CanvasNodeData = { ...td };
    switch (edge.targetHandle) {
      case "prompt":
        // 文本载体节点喂它自己的自由文本；其它节点则喂 prompt 字段。
        if (src.kind === "text") {
          if (src.content?.trim()) next.prompt = src.content;
        } else if (src.prompt?.trim()) {
          next.prompt = src.prompt;
        }
        break;
      case "negative":
        if (src.negative?.trim()) next.negative = src.negative;
        break;
      case "steps":
        if (src.steps != null) next.steps = src.steps;
        break;
      case "cfg":
        if (src.cfg != null) next.cfg = src.cfg;
        break;
      case "seed":
        if (src.seed?.trim()) next.seed = src.seed;
        break;
      case "inputImage":
      default:
        if (importedFile) {
          next.inputImage = importedFile;
          next.upstreamId = sourceId;
          // 自动切换消费端模式，让喂进来的图片真正被用上
          if (next.kind === "image" && next.mode === "txt2img")
            next.mode = "img2img";
          if (next.kind === "video" && next.mode === "t2v") next.mode = "i2v";
        } else if (
          (src.kind === "picture" || src.kind === "movie") &&
          src.mediaPath
        ) {
          // 内容载体本来就住在 ComfyUI 的 input 目录里，
          // 因此不必重新导入 —— 直接接上现成的文件名即可。
          next.inputImage = src.mediaPath;
          next.upstreamId = sourceId;
          if (next.kind === "image" && next.mode === "txt2img")
            next.mode = "img2img";
          if (next.kind === "video" && next.mode === "t2v") next.mode = "i2v";
        }
        break;
    }
    return { ...node, data: next };
  });
}
