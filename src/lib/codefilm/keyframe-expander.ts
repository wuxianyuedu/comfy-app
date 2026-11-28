/** 动作节拍 → 全局关键帧序列（P2 的核心纯函数）。
 *
 * 每个镜头的 beat 带镜内相对秒数 t；时间轴切片给出该镜的全局起始帧。展开后每个
 * 关键帧带**全局帧号**，于是跨镜动作能在同一条时间轴上对齐 —— 这正是 ONE SWEEP
 * 「one map and one clock」的实现：切镜时世界不乱。
 *
 * 无 actionRef 的节拍用自由文本 pose 单帧表示（兼容 P0 合同）。 */
import { findBuiltinAction } from "./action-library";
import type { ActionBeat, CodeFilmContract } from "./contract-schema";

/** 一个展开后的全局关键帧。 */
export type GlobalKeyframe = {
  actionRef: string | null;
  actorId: string;
  frame: number;
  fxRef: string | null;
  pose: string;
  shotId: string;
  t: number;
};

/** 合同 → 全局关键帧（按全局帧号排序）。
 *
 *  `frame = slice.startFrame + beat.t × fps + keyframe.t × fps`，再夹到镜头区间内
 *  （超出的动作尾帧被裁掉，避免跨镜越界）。 */
export function expandKeyframes(contract: CodeFilmContract): Array<GlobalKeyframe> {
  const fps = contract.meta.fps;
  const slices = new Map(contract.timeline.shots.map((slice) => [slice.shotId, slice]));
  const frames: Array<GlobalKeyframe> = [];

  for (const shot of contract.shots) {
    const slice = slices.get(shot.id);
    if (slice === undefined) {
      continue;
    }
    for (const beat of shot.actionBeats) {
      frames.push(...expandBeat(shot.id, beat, slice, fps));
    }
  }
  return frames;
}

/** 合同原始顺序（镜头顺序 × 节拍顺序）的全局帧序列，不排序。
 *  供 QA 检查"编排顺序是否单调"——排序后的序列永远单调，判不出倒退。 */
export function expandKeyframesInOrder(contract: CodeFilmContract): Array<GlobalKeyframe> {
  const fps = contract.meta.fps;
  const slices = new Map(contract.timeline.shots.map((slice) => [slice.shotId, slice]));
  const frames: Array<GlobalKeyframe> = [];
  for (const shot of contract.shots) {
    const slice = slices.get(shot.id);
    if (slice === undefined) {
      continue;
    }
    for (const beat of shot.actionBeats) {
      frames.push(...expandBeat(shot.id, beat, slice, fps));
    }
  }
  return frames;
}

/** 展开单个节拍。自定义 keyframes 优先，其次动作库，最后自由文本。 */
function expandBeat(
  shotId: string,
  beat: ActionBeat,
  slice: { endFrame: number; startFrame: number },
  fps: number,
): Array<GlobalKeyframe> {
  const def = beat.actionRef === undefined ? undefined : findBuiltinAction(beat.actionRef);
  const keyframes = beat.keyframes ?? def?.keyframes;
  const ctx = { actorId: beat.actorId, fps, shotId, slice };
  if (keyframes === undefined || keyframes.length === 0) {
    return [makeFrame(ctx, { pose: beat.action, t: beat.t })];
  }
  return keyframes.map((kf) =>
    makeFrame(ctx, {
      actionRef: beat.actionRef ?? null,
      fxRef: kf.fxRef ?? beat.fxRef ?? null,
      pose: kf.pose,
      t: beat.t + kf.t,
    }),
  );
}

type FrameContext = {
  actorId: string;
  fps: number;
  shotId: string;
  slice: { endFrame: number; startFrame: number };
};

type FrameSpec = {
  actionRef?: string | null;
  fxRef?: string | null;
  pose: string;
  t: number;
};

/** 全局帧 = 切片起点 + 相对秒 × fps，夹到切片区间内。 */
function makeFrame(ctx: FrameContext, spec: FrameSpec): GlobalKeyframe {
  const raw = ctx.slice.startFrame + Math.round(spec.t * ctx.fps);
  return {
    actionRef: spec.actionRef ?? null,
    actorId: ctx.actorId,
    frame: Math.min(Math.max(raw, ctx.slice.startFrame), ctx.slice.endFrame),
    fxRef: spec.fxRef ?? null,
    pose: spec.pose,
    shotId: ctx.shotId,
    t: spec.t,
  };
}

/** 取某角色在合同里的全局关键帧（供跨镜连续性 QA 用）。 */
export function keyframesForActor(
  frames: Array<GlobalKeyframe>,
  actorId: string,
): Array<GlobalKeyframe> {
  return frames.filter((frame) => frame.actorId === actorId);
}
