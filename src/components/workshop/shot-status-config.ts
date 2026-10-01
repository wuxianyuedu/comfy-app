/**
 * 镜头状态的展示口径（文案 + 帧条配色）。
 *
 * 文案这份表此前长在 `ShotStudio.tsx` 里，被 `StoryboardPlanner.parts.tsx` 与
 * `VideoStudio.parts.tsx` 反向 import（三处共用，是 §16.2.4.5 收口的成果）。搬到
 * 这里的原因很具体：镜头胶片带要用它，而胶片带会被 `ShotStudio` import —— 再从
 * `ShotStudio` 取就成了一组循环依赖（`check-circular-deps` 的判据）。
 *
 * 文案与配色是**两张表**，不是同一件事写两遍：
 *   · 文案给读屏与徽标（`ui/status-badge` 自己管徽标的色调）；
 *   · 配色给胶片带底部那一根 1px 状态条 —— 那里没有徽标容器，只能自己上 token。
 * 两者都按 `Shot["status"]` 穷举，新增一档会当场在类型上红。
 */
import { type Shot } from "~/lib/workshop/types";

export const SHOT_STATUS_LABEL: Record<Shot["status"], string> = {
  idle: "待生成",
  queued: "排队中",
  running: "生成中",
  done: "已完成",
  failed: "失败",
  stale: "待更新",
};

/**
 * 状态条配色：只用语义 token，不写死色值。
 *
 * 「进行中」不给颜色而给一个走动的条 —— 进度还没回报时上色，等于宣称它快了。
 */
export const SHOT_STATUS_BAR_CLASS: Record<Shot["status"], string> = {
  idle: "bg-elevated",
  queued: "bg-elevated",
  running: "bg-info",
  done: "bg-success",
  failed: "bg-destructive",
  stale: "bg-warning",
};

/** 胶片带一帧的完整展示输入。 */
export interface ShotFrameView {
  status: Shot["status"];
  label: string;
  barClass: string;
}

export function shotFrameView(status: Shot["status"]): ShotFrameView {
  return {
    status,
    label: SHOT_STATUS_LABEL[status],
    barClass: SHOT_STATUS_BAR_CLASS[status],
  };
}
