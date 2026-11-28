/** 合同镜头 → 工坊 `Shot[]` 的纯映射。
 *
 * 合同是「代码」，Shot 是工坊与 production.shots 既有的真值形状。这一层只做形状
 * 翻译，不写库、不调 LLM、不碰 task 表 —— 落库由调用方（P1 的 orchestrator）负责。
 *
 * 输出保持 `shotInputSchema` 的形状：调用方可直接交给 `shotListInputSchema.parse`。 */
import type { CodeFilmContract } from "./contract-schema";
import { expandKeyframes } from "./keyframe-expander";

/** 合同 → Shot 数组。id 用合同已有的镜号 id（硬规则：不生成第二套身份）。 */
export function contractToShots(contract: CodeFilmContract): Array<{
  characterIds: Array<string>;
  description: string;
  duration: number;
  id: string;
  index: number;
  motion: "low" | "medium" | "high";
  params: Record<string, unknown>;
  sceneHeading: string;
  sceneId: string;
  shotType: string;
  status: "idle";
  transition: "cut" | "dissolve" | "fade";
}> {
  const frames = expandKeyframes(contract);
  return contract.shots.map((shot) => ({
    id: shot.id,
    index: shot.index,
    sceneId: shot.sceneId,
    sceneHeading: shot.sceneHeading,
    shotType: shot.shotType,
    description: shot.description,
    characterIds: shot.characterIds,
    status: "idle",
    duration: shot.duration,
    motion: shot.motion,
    transition: shot.transition,
    params: {
      source: "codefilm",
      contractId: contract.meta.title,
      camera: shot.camera,
      actionBeats: shot.actionBeats,
      keyframes: frames.filter((frame) => frame.shotId === shot.id),
      timeline: contract.timeline.shots.find((slice) => slice.shotId === shot.id) ?? null,
    },
  }));
}
