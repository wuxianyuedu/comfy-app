import type { Shot } from "~/lib/workshop/types";
import { motionPromptSuffix } from "~/components/workshop/FinalComposer";

/** 镜头时长(秒) → 视频帧数(WAN 工作流常用 4-6 秒窗口)。 */
export function framesFor(shot: Shot, fps: number): number {
  const seconds =
    typeof shot.duration === "number" && shot.duration > 0 ? shot.duration : 5;
  return Math.max(9, Math.min(121, Math.round(seconds * fps)));
}

/** 视频提示词 = 镜头生图提示词(或画面描述) + 运动强度后缀。 */
export function videoPrompt(shot: Shot): string {
  return [shot.prompt || shot.description, motionPromptSuffix(shot.motion)]
    .filter(Boolean)
    .join(", ");
}
