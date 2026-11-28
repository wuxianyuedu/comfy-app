/** 合同镜头 → 服务端逐镜入队入参的纯映射。
 *
 * 这里**只产出入参**，不调用 `createWorkflowRunTask()`（那是服务端 IO，留 P1 的
 * orchestrator）：P0 要能在没有 ComfyUI / 工作流的环境下验证翻译本身正确。
 *
 * 落点仍然只有工坊暴露值（`WorkshopExposedValues`）—— 不拼 rawJson、不猜节点端口，
 * 保持「工作流唯一来源是库里的 rawJson + 落点只认作者连的线」的既有红线。 */
import type { WorkshopExposedValues } from "~/lib/workshop/workflow-encapsulation";
import type { CodeFilmContract, ShotSpec } from "./contract-schema";
import { expandKeyframes } from "./keyframe-expander";

/** 一次镜头运行的入参（userId / workflowId 由调用方在执行时注入）。 */
export type ContractRunInput = {
  index: number;
  shotId: string;
  values: WorkshopExposedValues;
};

export type ContractRunOptions = {
  /** 帧率缺省取合同 meta.fps；调用方可覆盖（对齐 VideoStudio 的 fps 档）。 */
  fps?: number;
  /** 是否把动作节拍摘要拼进提示词（默认开，供 i2v 模型理解动作意图）。 */
  includeBeatsInPrompt?: boolean;
};

/** 合同 → 逐镜运行入参。镜头顺序即提交顺序（多镜连续的时序基线）。 */
export function contractToRuns(
  contract: CodeFilmContract,
  options: ContractRunOptions = {},
): Array<ContractRunInput> {
  const fps = options.fps ?? contract.meta.fps;
  const includeBeats = options.includeBeatsInPrompt !== false;
  const frames = expandKeyframes(contract);
  return [...contract.shots]
    .sort((a, b) => a.index - b.index)
    .map((shot) => ({
      shotId: shot.id,
      index: shot.index,
      values: {
        prompt: buildPrompt(shot, includeBeats, frames),
        negativePrompt: "low quality, blurry, deformed, watermark, text, distorted",
        duration: shot.duration,
        frames: Math.max(1, Math.round(shot.duration * fps)),
      },
    }));
}

/** 提示词 = 画面描述 + 景别 + 动作节拍摘要。
 *
 *  P2：优先用展开后的姿态描述（含动作库的招式细节），同一镜内按帧序去重；
 *  没有展开帧时退化为 beat.action（兼容 P0 合同）。actorId 这类内部 id 不喂给模型。 */
function buildPrompt(
  shot: ShotSpec,
  includeBeats: boolean,
  frames: ReturnType<typeof expandKeyframes>,
): string {
  const parts = [shot.description.trim(), `${shot.shotType} shot`];
  if (includeBeats && shot.actionBeats.length > 0) {
    const poses = frames.filter((frame) => frame.shotId === shot.id).map((frame) => frame.pose);
    const actions =
      poses.length > 0 ? [...new Set(poses)] : shot.actionBeats.map((beat) => beat.action);
    parts.push(`actions: ${actions.join(", ")}`);
  }
  return parts.filter(Boolean).join("; ");
}
