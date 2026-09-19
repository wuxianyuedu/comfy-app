"use client";

import { useEffect, useRef } from "react";

/**
 * useHotkey —— 「在全局按下一个键 / 组合键时做一件事」的**唯一实现**
 * （规范 16 §16.2.4.23）。
 *
 * 为什么收口：全库有 **6 处**各自 `addEventListener("keydown", handler)`
 * + 手写清理，写法看着像，**判据却各不相同**：
 *
 *  - `LogProvider`（Ctrl+Shift+L 开关日志面板）与 `UpdateCheckProvider`
 *    （Ctrl+Shift+U 主动检测）只判 `ctrlKey && shiftKey` ——
 *    **macOS 上按 ⌘ 没有任何反应**，而用户不会认为「这个应用没有这个快捷键」，
 *    只会认为「它坏了」；
 *  - `json-viewer`（⌘/Ctrl+F）判了 `metaKey || ctrlKey`，却**不过滤输入焦点** ——
 *    在别的输入框里按 ⌘F 也会被它抢走（而它只是那一处 JSON 气泡的查找）；
 *  - `ScriptMarkdownEditor`（⌘/Ctrl+S、Z）两种修饰键都判，但**同时**把两件事
 *    塞进一个 handler，键名判据与动作混在一起；
 *  - `MessageCenterPanel` / `WorkshopHeader`（Esc 关闭）各自手写一遍。
 *
 * 也就是说：**「这个快捷键在 mac 上能不能用」取决于它是哪一处写的**。
 * 这类差异没有报错、没有告警、tsc / eslint 都不看，只能靠「同一件事只允许
 * 一处实现」从结构上消除。
 *
 * 本 hook 给出四件此前各处写不全的事：
 *  1. **修饰键默认跨平台**：`mod: true` 同时接受 ⌘ 与 Ctrl（除非显式
 *     `macOnly` / `ctrlOnly`，且那种情况要在调用处写明理由）；
 *  2. **`enabled`**：不满足条件时**不注册**（而不是注册了在 handler 里
 *     early return —— 后者会在别的 handler 都跑完之后才轮到它，顺序不可控）；
 *  3. **`filterInput`**（默认开）：焦点在输入框 / 文本域 / contenteditable 里
 *     时不触发 —— 单键（Esc 除外）与无修饰的组合键最需要它；
 *  4. **`preventDefault`**：命中时默认阻止浏览器默认行为（⌘S 会弹「保存网页」）。
 *
 * 与 `useInterval` / `useFlashState` 的分工：那两者管定时器，本 hook 管输入事件。
 */

/** `mod` 在 macOS 上是 ⌘、其它平台是 Ctrl。 */
export interface HotkeySpec {
  /** 主键，大小写不敏感（`"l"` / `"Escape"` / `"s"`）。 */
  key: string;
  /** ⌘（macOS）/ Ctrl（其它）—— **优先用这一项**，不要写 `ctrl`。 */
  mod?: boolean;
  /** 显式要求 Ctrl（仅当行为**刻意**只在 Ctrl 上成立时用，写明理由）。 */
  ctrl?: boolean;
  /** 显式要求 ⌘（同上）。 */
  meta?: boolean;
  /** 要求 Shift。 */
  shift?: boolean;
  /** 要求 Alt。 */
  alt?: boolean;
}

export interface UseHotkeyOptions {
  /** 是否注册。`false` 时不注册（如面板未打开）。默认 `true`。 */
  enabled?: boolean;
  /**
   * 焦点在可编辑元素里时是否跳过。默认 `true`。
   * 单键（Esc 除外）几乎总是该跳过 —— 否则用户在输入框里打字母会触发快捷键。
   */
  filterInput?: boolean;
  /** 命中时是否 `preventDefault()`。默认 `true`。 */
  preventDefault?: boolean;
  /** 监听目标。默认 `window`（`document` 在 iframe / portal 场景下等价）。 */
  target?: Window | Document;
}

/** 单键是否可编辑元素 —— 焦点在输入类元素里时不该抢键。 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/**
 * 一个键盘事件是否命中给定规格。
 *
 * 判据分两步，**declared 只约束声明了的东西**：
 *  1. 主键相等（大小写不敏感）；
 *  2. 每个**显式声明**的修饰键都必须按下（`shift: true` 就得按住 Shift）；
 *     每个**未声明**的修饰键都必须没按 —— 唯一的例外是主键 `Escape`：
 *     它就是「退出」，不该因为用户同时按着 Shift 而失效。
 *
 * `mod` 是 `ctrl` / `meta` 的**平台相关简写**：macOS 上折成 `meta`、其它平台
 * 折成 `ctrl`。这条是这次收口的核心 —— 收口前所有 Ctrl 组合键在 mac 上都是
 * 死的，因为没人写 `metaKey`。
 */
export function matchesHotkey(
  event: KeyboardEvent,
  spec: HotkeySpec,
  isMac: boolean,
): boolean {
  if (event.key.toLowerCase() !== spec.key.toLowerCase()) return false;

  /* 目标修饰键集合：`mod` 只是「当前平台那一个」的简写。 */
  const wantCtrl = spec.ctrl === true || (spec.mod === true && !isMac);
  const wantMeta = spec.meta === true || (spec.mod === true && isMac);
  const wantShift = spec.shift === true;
  const wantAlt = spec.alt === true;

  if (wantCtrl !== event.ctrlKey) return false;
  if (wantMeta !== event.metaKey) return false;
  if (wantShift !== event.shiftKey) return false;
  if (wantAlt !== event.altKey) return false;
  return true;
}

/** 当前平台是否为 macOS（`navigator` 不可用时按非 mac 处理）。 */
function detectMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = navigator.platform ?? "";
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

/**
 * 用法：⌘/Ctrl+Shift+L 开关日志面板写
 * `useHotkey({ key: "l", mod: true, shift: true }, toggleOpen)`；
 * Esc 只在菜单打开时注册、且要能穿透输入框（用户可能正在改名）则写
 * `useHotkey({ key: "Escape" }, close, { enabled: open, filterInput: false })`。
 */
export function useHotkey(
  spec: HotkeySpec,
  handler: () => void,
  {
    enabled = true,
    filterInput = true,
    preventDefault = true,
    target,
  }: UseHotkeyOptions = {},
): void {
  /* handler 放 ref：传新函数不该重建监听（同 `useInterval` 的口径）。 */
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  const { key, mod, ctrl, meta, shift, alt } = spec;

  useEffect(() => {
    if (!enabled) return;
    const host: Window | Document =
      target ?? (typeof window !== "undefined" ? window : document);
    const isMac = detectMac();

    const onKeyDown = (event: KeyboardEvent) => {
      if (filterInput && isEditableTarget(event.target)) return;
      if (!matchesHotkey(event, { key, mod, ctrl, meta, shift, alt }, isMac))
        return;
      if (preventDefault) event.preventDefault();
      handlerRef.current();
    };

    host.addEventListener("keydown", onKeyDown as EventListener);
    return () =>
      host.removeEventListener("keydown", onKeyDown as EventListener);
  }, [
    enabled,
    filterInput,
    preventDefault,
    target,
    key,
    mod,
    ctrl,
    meta,
    shift,
    alt,
  ]);
}
