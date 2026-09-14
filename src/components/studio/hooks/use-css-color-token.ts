"use client";

// ── 读取「随主题的 CSS 颜色 token」的解析值 ──
// 有些位置的颜色不写进 class 交给 Tailwind，而是要在 JS 里参与色彩运算
// （`mixHex(base, data.color, t)` 这类「用户内容色叠在主题表面上」的混色）。
// `mixHex` 只吃具体色值，不能直接喂 `var(--color-…)`，所以在运行时把 token
// 解析成 `#rrggbb`。
//
// 实现走 `useSyncExternalStore`：`getComputedStyle` 是同步 API，但它的结果在
// **主题变化**时必须重取，而主题变化是「外部系统（<html> 的 class）变了」。
// 用 useSyncExternalStore + MutationObserver 订阅 `.class`，正好对上这个模型，
// 也避开 `set-state-in-effect` / 「render 期读 ref」两条 React 19 硬规则
// （见规范 08 §8.6 与 02 §2.4）。
//
// 服务端渲染 / 挂载前 `getServerSnapshot` 返回 fallback。

import { useCallback, useSyncExternalStore } from "react";

/* 只订阅一次 <html> 的 class 变化，多个 hook 调用点共享同一组监听器。 */
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function ensureObserver(): void {
  if (observer || typeof window === "undefined") return;
  observer = new MutationObserver(() => {
    /* 主题 class 已落到 <html>：缓存里的 token 值全部作废，重新读。 */
    tokenCache.clear();
    for (const listener of listeners) listener();
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
}

function subscribe(onStoreChange: () => void): () => void {
  ensureObserver();
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

/* token 值只随 `<html>` 的 class 变化，所以在两次 class 变化之间缓存即可。
 * `class` 一改，MutationObserver 清空缓存并通知订阅者 —— 缓存因此不会过期。 */
const tokenCache = new Map<string, string | null>();

/** 读取 `--color-*` 的解析值并归一成 `#rrggbb`；读不到时返回 null。 */
export function readCssColorToken(name: string): string | null {
  if (typeof window === "undefined") return null;
  if (tokenCache.has(name)) return tokenCache.get(name) ?? null;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  const value = normalizeCssColor(raw);
  tokenCache.set(name, value);
  return value;
}

/**
 * 把 CSS 颜色值归一成 `mixHex` 能吃的 `#rrggbb`。
 * 支持 `#rgb` / `#rrggbb` / `rgb(r,g,b)` / `rgba(r,g,b,a)`。
 * 形状不认识时返回 null，由调用方决定兜底。
 */
export function normalizeCssColor(value: string): string | null {
  if (!value) return null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  const digits = hex?.[1];
  if (digits) {
    const full =
      digits.length === 3
        ? digits
            .split("")
            .map((c) => c + c)
            .join("")
        : digits;
    return `#${full.toLowerCase()}`;
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(value);
  if (rgb?.[1] && rgb[2] && rgb[3]) {
    const toHex = (part: string) => Number(part).toString(16).padStart(2, "0");
    return `#${toHex(rgb[1])}${toHex(rgb[2])}${toHex(rgb[3])}`;
  }
  return null;
}

/**
 * 按当前主题返回 `--<name>` 的 `#rrggbb` 解析值。主题（`<html>` 的 `.dark`）
 * 一变，MutationObserver 触发重读。
 *
 * `name` 传完整 token 名（含 `--` 前缀），如 `--color-note-tint-base`；
 * `fallback` 在挂载前 / token 读不到时使用。
 */
export function useCssColorToken(name: string, fallback: string): string {
  /* getSnapshot 必须返回**原始值**（字符串）—— React 用 Object.is 比较，字符串
   *  天然稳定，所以即便每次 render 新建闭包也不会触发多余渲染。 */
  const getSnapshot = useCallback(
    () => readCssColorToken(name) ?? fallback,
    [name, fallback]
  );
  const getServerSnapshot = useCallback(() => fallback, [fallback]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
