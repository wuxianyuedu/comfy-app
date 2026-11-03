"use client";

import { normalizeKeyName } from "~/lib/keyboard";

/**
 * simpleKeyHandler —— 「在一个非输入框元素上按某个键就做一件事」的唯一实现（规范 16 §16.2.4.57）。收口前 3 处各写键判据，而无修饰单键的 `event.key` 带 Shift 时是大写字符（§16.2.4.29），判错就是「这个键没反应」且无报错。
 * 三件事：键名归一交 `~/lib/keyboard`；`preventDefault` 是显式选项（默认开）；`event.repeat` 默认忽略（按住连发对「切换一次」等于按十几次）。与 `useHotkey` 分工：那个管 document 全局监听，本件管元素上的 `onKeyDown`。
 */

/** `onKeyDown` 事件的**最小形状**（React 的 `KeyboardEvent<T>` 结构上满足它 ——
 *  只读这几个字段，所以用例可以手造事件）。 */
export type SimpleKeyEvent = {
  /** 大小写不敏感的物理键标识（React 透传自浏览器）—— 归一判据的兜底。 */
  code?: string;
  key: string;
  preventDefault: () => void;
  repeat: boolean;
};

/** 调用的「按下了这个键」回调（收到的是键事件 —— 需要停住冒泡时用得到）。 */
export type SimpleKeyAction = (event: SimpleKeyEvent) => void;

export type SimpleKeyHandlerOptions = {
  /** 是否忽略 `event.repeat`（按住不放的连发）。默认 `true`。 */
  ignoreRepeat?: boolean;
  /** 命中时是否 `preventDefault`。默认 `true`。
   *  单键（Space / Enter）在 `role="tab"` 这类元素上**必须**阻止默认行为，
   *  否则页面会跟着滚动 / 触发宿主表单；Tab 缩进同理（不阻止等于把焦点
   *  让出去）。要「只观察不拦截」时显式写 `false`。 */
  preventDefault?: boolean;
};

/** 造出「按下若干键之一就做一件事」的 `onKeyDown` 属性。用法：`<div role="tab" tabIndex={0} {...simpleKeyHandler(["Space", "Enter"], () => select(id))} />`。
 *  属性包只有 `onKeyDown`，直接铺在元素上（与 `enterCommit` / `mediaDragSourceProps` 同款）。 */
export function simpleKeyHandler(
  keys: ReadonlyArray<string>,
  action: SimpleKeyAction,
  { preventDefault = true, ignoreRepeat = true }: SimpleKeyHandlerOptions = {},
): { onKeyDown: (event: SimpleKeyEvent) => void } {
  /* 归一表在构造时算一次：调用点在 JSX 里，每次渲染重建一份太浪费。 */
  const normalized = new Set(keys.map(normalizeKeyName));
  return {
    onKeyDown: (event) => {
      if (ignoreRepeat && event.repeat) {
        return;
      }
      if (!normalized.has(normalizeKeyName(event.key))) {
        return;
      }
      if (preventDefault) {
        event.preventDefault();
      }
      action(event);
    },
  };
}
