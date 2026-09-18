/**
 * 日志面板相关浮层的**层级契约**（纯常量 + 纯派生，无 React、无 DOM）。
 *
 * 为什么单独立一个模块：层级是「删掉 JSX 还能不能判定」的事实，按规范 17 §17.2
 * 归第①层（配置 / 纯派生），可脱离浏览器直接断言。
 *
 * ── 背景（ISSUE #262 回归）──────────────────────────────────────────
 * 日志面板自己是一层**模态遮罩**（见 LogPanel 的 overlayClass）。面板里的
 * 来源下拉走 base-ui 的 `Portal`，弹层被挂到 `document.body` 下、与遮罩**平级**，
 * 而 shadcn 的 Select 默认只给 `z-50`（低于刻度表的 `modal` 档）。
 *
 * 结果不是「弹层没渲染」，而是：弹层**画出来了**（所以在 layers 面板里能看到、
 * 截图里也在），却被模态遮罩整块压住——指针事件全部落到遮罩/日志行上，
 * 弹层收不到任何点击。用户读到的现象有两条，而且是同一个根因：
 *   1. 「点下拉看不到下拉菜单」——看着像没弹出来，其实是弹在遮罩底下；
 *   2. 「没办法切换日志类型 / 日志没法翻页」——点不中选项，也算不上翻页。
 *
 * 因此约束是：**面板内任何 portal 弹层的定位层 z 必须高于面板遮罩 z**。
 * 这条比较藏得深（jsdom 不做层叠与命中测试，单测全绿也照样复现），
 * 所以把它写成可断言的常量关系，而不是靠人记得「这里要改 z」。
 */

import { Z, zClass } from "~/lib/shell/overlay-z";

/**
 * 日志面板遮罩（模态层）的层级 = 浮层刻度表的 `modal` 档（规范 16 §16.2.5）。
 *
 * 面板是铺在应用内容之上的一层浮层：与全屏视图、抽屉、其它模态同档（「应用内的
 * 顶」），高于画布 chrome（`canvasUi` / `canvasMax`）。此前这里自成一档 `z-99`，
 * 与其余模态差了 9 个数 —— 同一件事（一条模态遮罩）在库里有两个值，正是
 * §16.2.5 要收掉的那种「谁也说不清比谁高」。
 */
export const LOG_PANEL_OVERLAY_Z = Z.modal;

/**
 * 面板内 portal 弹层（下拉/气泡）定位层应使用的层级 = 刻度表的 `popup` 档。
 *
 * 契约是「**严格高于**遮罩」（相等也不行：同 z 时后写进 DOM 的遮罩会盖住弹层，
 * 而那正是本契约要排除的「时灵时不灵」）—— `popup` 在刻度表里就在 `modal`
 * 之上，因为挂在 body 的下拉本来就要压过打开它的那层模态（同款论证见
 * §16.2.5 的 `popup > modal` 判据）。
 */
export const LOG_PANEL_POPUP_Z = Z.popup;

/** 面板内 portal 弹层定位层用的 Tailwind class（`z-popup`）。 */
export const LOG_PANEL_POPUP_Z_CLASS = zClass("popup");

/** 日志面板模态遮罩用的 Tailwind class（`z-modal`）。 */
export const LOG_PANEL_OVERLAY_Z_CLASS = zClass("modal");

/**
 * 弹层定位层的层级是否安全：**必须严格高于**面板遮罩。
 *
 * 相等也不行——同 z 时后写进 DOM 的遮罩会盖住弹层，而那正是本契约要排除的
 * 那种「时灵时不灵」。取严格大于，把相等归进违规。
 */
export function isPopupLayerAboveOverlay(popupZ: number): boolean {
  return Number.isFinite(popupZ) && popupZ > LOG_PANEL_OVERLAY_Z;
}

/**
 * 从 class 串里解出 `z-<n>` 的层级值；没有这类 class 时返回 `null`。
 *
 * 只认**裸数字**形式（`z-200`），不认 `z-[200]` / 任意值（规范 03 §3.2 已禁），
 * 也不认枚举档（`z-modal` / `z-popup`）—— 后者由 `zClass()` 生成、取值看
 * `~/lib/shell/overlay-z` 的刻度表，不是本函数要解的形态。
 */
export function parseZClass(className: string): number | null {
  const match = /(?:^|\s)z-(\d+)(?:\s|$)/.exec(className);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}
