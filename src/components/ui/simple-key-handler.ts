"use client";

import { normalizeKeyName } from "~/lib/keyboard";

/**
 * simpleKeyHandler —— 「在一个非输入框元素上按某个键就做一件事」的**唯一实现**
 * （规范 16 §16.2.4.57）。
 *
 * 为什么收口：全库 **3 处**「自己实现一个键盘动作」各写一遍键判据，而它们
 * 记的键**几乎都不是自己以为的那个** —— 无修饰单键的 `event.key` 是**带
 * Shift 的大写字符**（规范 16 §16.2.4.29 已把这条踩实）：
 *
 *  - `ShellTabs` / `TitleBarTabs` 的页签：判 `"Enter" || " "` —— 而
 *    Shift+Space 的 `event.key` 是 `" "`… 恰好相等，Shift+Enter 是
 *    `"Enter"`，所以这两处**碰巧**没事；但「Space 键」在 UI 上通常还要
 *    显示成 `Space`，判据写成 `" "` 就没人能一眼确认它对不对；
 *  - `ScriptMarkdownEditor` 的 Tab 缩进：判 `"Tab"`，Shift+Tab 是反缩进
 *    （另一件事），**被吞掉的 Shift+Tab 是「本该不做事却被 preventDefault」**；
 *  - 未来任何一处都会再猜一次「大写还是小写」—— 而这不是风格问题，
 *    按错了就是「这个键没反应」，没有报错、没有告警、tsc 与 eslint 都不看。
 *
 * 本模块给三件此前各处写不全的事：
 *  1. **键名归一**：`"Space"` / `"Enter"` / `"Escape"` 这类名字交给
 *     `~/lib/keyboard`（键名字面量的唯一出口），判据不落在
 *     调用处手写的字符串上；
 *  2. **`preventDefault` 是显式选项**（默认开）：吞掉浏览器默认行为的决定
 *     与「按了哪个键」是两件事，此前混在同一个 `if` 里，看不出谁决定的；
 *  3. **`event.repeat` 默认忽略**：按住不放会连发 —— 对「切换一次」这类
 *     动作，连发等于按了十几次。
 *
 * 本模块**不**自己维护键名表：它只借用 `~/lib/keyboard` 的归一规则
 * （键名字面量的唯一出口，见 §16.2.4.57 的「两个落点、一个判据」）。
 * 这是刻意的 —— 再记一份键名表就是本条账要消除的那种重复。
 *
 * 与 `useHotkey`（§16.2.4.23）的分工：那个管**全局**监听器（挂 document、
 * 有 `enabled` / `filterInput` / 生命周期），本模块管**元素上**的那一个
 * `onKeyDown`（页签、自定义 tab 行这类已经有焦点的元素）。硬把后者塞进前者
 * 会逼着调用处先拆组件、再把 `preventDefault` 的决定丢在 handler 里。
 *
 * 与 `enterCommit`（§16.2.4.29）的分工：那个管**输入框**里的 Enter 提交 /
 * Esc 取消（含 IME 与 Shift 排除）；本模块管**其它键**。两者共用
 * `~/lib/keyboard` 的键名归一，不各自判一次。
 */

/** `onKeyDown` 事件的**最小形状**（React 的 `KeyboardEvent<T>` 结构上满足它 ——
 *  只读这几个字段，所以用例可以手造事件）。 */
export interface SimpleKeyEvent {
  key: string;
  /** 大小写不敏感的物理键标识（React 透传自浏览器）—— 归一判据的兜底。 */
  code?: string;
  repeat: boolean;
  preventDefault: () => void;
}

/** 调用的「按下了这个键」回调（收到的是键事件 —— 需要停住冒泡时用得到）。 */
export type SimpleKeyAction = (event: SimpleKeyEvent) => void;

export interface SimpleKeyHandlerOptions {
  /** 命中时是否 `preventDefault`。默认 `true`。
   *  单键（Space / Enter）在 `role="tab"` 这类元素上**必须**阻止默认行为，
   *  否则页面会跟着滚动 / 触发宿主表单；Tab 缩进同理（不阻止等于把焦点
   *  让出去）。要「只观察不拦截」时显式写 `false`。 */
  preventDefault?: boolean;
  /** 是否忽略 `event.repeat`（按住不放的连发）。默认 `true`。 */
  ignoreRepeat?: boolean;
}

/** 造出「按下若干键之一就做一件事」的 `onKeyDown` 属性。
 *
 *  用法：`<div role="tab" tabIndex={0} {...simpleKeyHandler(["Space", "Enter"], () => select(id))} />`
 *  —— 属性包里只有 `onKeyDown`，直接铺在元素上（与 `enterCommit` /
 *  `mediaDragSourceProps` 同款）。
 *
 *  收口前的写法（键名手写、`preventDefault` 与键判混在一个 `if` 里、
 *  连发未处理）长这样：`onKeyDown={(e) => { if (e.key === "Enter" ||
 *  e.key === " ") { e.preventDefault(); onSelect(id); } }}`。
 */
export function simpleKeyHandler(
  keys: readonly string[],
  action: SimpleKeyAction,
  { preventDefault = true, ignoreRepeat = true }: SimpleKeyHandlerOptions = {},
): { onKeyDown: (event: SimpleKeyEvent) => void } {
  /* 归一表在构造时算一次：调用点在 JSX 里，每次渲染重建一份太浪费。 */
  const normalized = new Set(keys.map(normalizeKeyName));
  return {
    onKeyDown: (event) => {
      if (ignoreRepeat && event.repeat) return;
      if (!normalized.has(normalizeKeyName(event.key))) return;
      if (preventDefault) event.preventDefault();
      action(event);
    },
  };
}
