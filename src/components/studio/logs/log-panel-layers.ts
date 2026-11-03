/**
 * 日志面板相关浮层的**层级契约**（纯常量 + 纯派生，无 React、无 DOM）。
 * 面板模态遮罩走刻度表 `modal` 档，下拉经 Portal 挂到 body、与遮罩平级，shadcn Select 默认
 * `z-50` 低于 modal：弹层画出来却被遮罩压住收不到指针事件（「点下拉看不到菜单」，ISSUE #262）。
 * 约束：面板内任何 portal 弹层的定位层 z 必须严格高于面板遮罩（jsdom 不做层叠，故写成常量关系）。 */

import { Z, zClass } from "~/lib/shell/overlay-z";

/**
 * 日志面板遮罩（模态层）的层级 = 浮层刻度表 `modal` 档（规范 16 §16.2.5）。
 * 面板是铺在应用内容之上的浮层，与全屏视图 / 抽屉 / 其它模态同档，高于画布 chrome；
 * 此前自成一档 `z-99`，同一件事在库里两个值（§16.2.5 要收掉的那种「说不清谁高」）。
 */
export const LOG_PANEL_OVERLAY_Z = Z.modal;

/**
 * 面板内 portal 弹层（下拉/气泡）定位层应使用 `popup` 档。
 * 契约是「**严格高于**遮罩」：相等也不行——同 z 时后写进 DOM 的遮罩会盖住弹层，
 * 那正是本契约要排除的「时灵时不灵」（同款论证见 §16.2.5 的 `popup > modal`）。
 */
export const LOG_PANEL_POPUP_Z = Z.popup;

/** 面板内 portal 弹层定位层用的 Tailwind class（`z-popup`）。 */
export const LOG_PANEL_POPUP_Z_CLASS = zClass("popup");

/* 面板遮罩的 class 由 `ui/dialog` 的 `dialogBackdropClass()` 产出（同样取
   `z-modal`）—— 面板改用弹窗基元后，这里不再需要一份平行的 class 常量
   （平行的那份最容易与基元里的取值各自漂移）。`LOG_PANEL_OVERLAY_Z` 仍是
   「面板遮罩在刻度表上的档」这一事实，用于下面这条严格大于的判定。 */

/**
 * 弹层定位层的层级是否安全：必须严格高于面板遮罩。
 * 相等也不行——同 z 时后写进 DOM 的遮罩会盖住弹层，那正是要排除的「时灵时不灵」；
 * 取严格大于，把相等归进违规。
 */
export function isPopupLayerAboveOverlay(popupZ: number): boolean {
  return Number.isFinite(popupZ) && popupZ > LOG_PANEL_OVERLAY_Z;
}

/**
 * 从 class 串里解出 `z-<n>` 的层级值；没有这类 class 时返回 `null`。
 * 只认裸数字形式（`z-200`），不认任意值（规范 03 §3.2 已禁），也不认枚举档
 * （`z-modal` / `z-popup`）——后者由 `zClass()` 生成、取值看 `overlay-z` 刻度表。
 */
export function parseZClass(className: string): number | null {
  const match = /(?:^|\s)z-(\d+)(?:\s|$)/.exec(className);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}
