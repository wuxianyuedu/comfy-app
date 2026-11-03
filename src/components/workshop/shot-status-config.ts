/**
 * 镜头状态的展示口径（文案 + 帧条配色）。从 `ShotStudio.tsx` 搬来：胶片带要用它，而胶片带会被 `ShotStudio` import —— 再从那里取就成了循环依赖
 *（check-circular-deps）。文案与配色是**两张表**：文案给读屏与徽标；配色给胶片带那根 1px 状态条（那里没有徽标容器）。两者都按 `Shot["status"]` 穷举，新增一档当场类型红。
 */
import type { Shot } from "~/lib/workshop/types";

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
export type ShotFrameView = {
  barClass: string;
  label: string;
  status: Shot["status"];
};

export function shotFrameView(status: Shot["status"]): ShotFrameView {
  return {
    status,
    label: SHOT_STATUS_LABEL[status],
    barClass: SHOT_STATUS_BAR_CLASS[status],
  };
}
