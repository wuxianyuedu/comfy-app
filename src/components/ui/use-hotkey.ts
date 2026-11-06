"use client";

import { useEffect, useRef } from "react";

/** useHotkey —— 「全局按键 / 组合键做一件事」的唯一实现（规范 16 §16.2.4.23）。收口前全库 6 处各自
 * `addEventListener("keydown")` + 手写清理，判据各异：`LogProvider` / `UpdateCheckProvider` 只判 `ctrlKey && shiftKey`
 *（**macOS 上按 ⌘ 没反应**，用户只会认为它坏了），`json-viewer` 却**不过滤输入焦点**，`ScriptMarkdownEditor` 把键判据与动作
 * 塞进一个 handler，Esc 两处各手写。本 hook 四件：`mod` 默认跨平台；`enabled` 为假时**不注册**（而非 handler 里
 * early return，顺序不可控）；`filterInput` 默认开；命中默认 `preventDefault`。管输入事件，定时器归 `useInterval` / `useFlashState`。 */

/** `mod` 在 macOS 上是 ⌘、其它平台是 Ctrl。 */
export type HotkeySpec = {
  /** 要求 Alt。 */
  alt?: boolean;
  /** 显式要求 Ctrl（仅当行为**刻意**只在 Ctrl 上成立时用，写明理由）。 */
  ctrl?: boolean;
  /** 主键，大小写不敏感（`"l"` / `"Escape"` / `"s"`）。 */
  key: string;
  /** 显式要求 ⌘（同上）。 */
  meta?: boolean;
  /** ⌘（macOS）/ Ctrl（其它）—— **优先用这一项**，不要写 `ctrl`。 */
  mod?: boolean;
  /** 要求 Shift。 */
  shift?: boolean;
};

export type UseHotkeyOptions = {
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
};

/** 单键是否可编辑元素 —— 焦点在输入类元素里时不该抢键。 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/** 一个键盘事件是否命中给定规格。判据分两步，**declared 只约束声明了的东西**：① 主键相等（大小写不敏感）；② 每个
 * **显式声明**的修饰键必须按下，每个**未声明**的必须没按 —— 唯一例外是主键 `Escape`：它就是「退出」，不该因同时
 * 按着 Shift 而失效。`mod` 是 `ctrl` / `meta` 的平台相关简写（macOS 折成 `meta`、其它折成 `ctrl`）：收口前所有
 * Ctrl 组合键在 mac 上都是死的，因为没人写 `metaKey`。 */
export function matchesHotkey(event: KeyboardEvent, spec: HotkeySpec, isMac: boolean): boolean {
  if (event.key.toLowerCase() !== spec.key.toLowerCase()) {
    return false;
  }

  /* 目标修饰键集合：`mod` 只是「当前平台那一个」的简写。 */
  const wantCtrl = spec.ctrl === true || (spec.mod === true && !isMac);
  const wantMeta = spec.meta === true || (spec.mod === true && isMac);
  const wantShift = spec.shift === true;
  const wantAlt = spec.alt === true;

  if (wantCtrl !== event.ctrlKey) {
    return false;
  }
  if (wantMeta !== event.metaKey) {
    return false;
  }
  if (wantShift !== event.shiftKey) {
    return false;
  }
  if (wantAlt !== event.altKey) {
    return false;
  }
  return true;
}

/** 当前平台是否为 macOS（`navigator` 不可用时按非 mac 处理）。 */
function detectMac(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  const platform = navigator.platform;
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

/**
 * 用法：⌘/Ctrl+Shift+L 写 `useHotkey({ key: "l", mod: true, shift: true }, toggleOpen)`；Esc 只在菜单
 * 打开时注册且要能穿透输入框（用户可能正在改名）则写
 * `useHotkey({ key: "Escape" }, close, { enabled: open, filterInput: false })`。
 */
export function useHotkey(
  spec: HotkeySpec,
  handler: () => void,
  { enabled = true, filterInput = true, preventDefault = true, target }: UseHotkeyOptions = {},
): void {
  /* handler 放 ref：传新函数不该重建监听（同 `useInterval` 的口径）。 */
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  const { key, mod, ctrl, meta, shift, alt } = spec;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const host: EventTarget = target ?? (typeof window === "undefined" ? document : window);
    const isMac = detectMac();

    const onKeyDown = (event: KeyboardEvent) => {
      if (filterInput && isEditableTarget(event.target)) {
        return;
      }
      if (!matchesHotkey(event, { key, mod, ctrl, meta, shift, alt }, isMac)) {
        return;
      }
      if (preventDefault) {
        event.preventDefault();
      }
      handlerRef.current();
    };

    /* `Window` / `Document` 各自的 `addEventListener("keydown")` 重载在联合类型上
     * 无法收束；按 `EventTarget` 注册，事件到点再校验是不是键盘事件。 */
    const listener: EventListener = (event) => {
      if (event instanceof KeyboardEvent) {
        onKeyDown(event);
      }
    };
    host.addEventListener("keydown", listener);
    return () => {
      host.removeEventListener("keydown", listener);
    };
  }, [enabled, filterInput, preventDefault, target, key, mod, ctrl, meta, shift, alt]);
}
