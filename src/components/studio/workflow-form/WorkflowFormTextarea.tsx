"use client";

import { clamp } from "~/lib/clamp";
import { useCallback, useLayoutEffect, useRef } from "react";

/** 自动增高的 textarea，宽度严格锁死在父级。
 *
 *  替换此前的 `field-sizing: content` 方案。原生 `field-sizing`
 *  本该在 `maxWidth: 100%` 硬封顶下给出自动高度，但
 *  Chrome 的实现会让固有内容宽度溢出父级 ——
 *  当真实提示词里最长的不可断行超过控件的内部
 *  宽度（282px = 卡片 340 - 2 边框 - 14×2 内边距）时。溢出-X 规则
 *（`overflowWrap: anywhere`、`wordBreak: break-word`）只能裁掉
 *  可见文字 —— 它们约束不了 textarea 的盒子几何。
 *
 *  本组件改为：
 *   - 高度交给 JS 驱动（重置成 `auto` 后读 scrollHeight），并夹在
 *     [MIN, MAX] 内；于是 textarea 逐行自适应，永不
 *     依赖新的 `field-sizing` API；
 *   - 设 `box-sizing: border-box` + `width: 100%`，让盒子宽度严格等于
 *     父级的内容盒，不受固有尺寸影响；
 *   - 保留横向溢出守卫（pr-3 > pl-2.5，
 *     overflowX: hidden，overflowWrap: anywhere，wordBreak: break-word）；
 *   - 保留滚动条抑制（webkit + firefox + ms）。
 */
export function AutoResizeTextarea({
  value,
  placeholder,
  onChange,
  minHeight = 28,
  maxHeight = 120,
}: {
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  minHeight?: number;
  maxHeight?: number;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // 重置成 "auto"，好让 scrollHeight 只反映自然内容高度
    //（否则会被夹到上一次的显式高度）。
    el.style.height = "auto";
    const natural = el.scrollHeight;
    const clamped = clamp(natural, minHeight, maxHeight);
    el.style.height = `${clamped}px`;
    el.style.overflowY = natural > maxHeight ? "auto" : "hidden";
  }, [minHeight, maxHeight]);
  // 每次值变化都跑（初始挂载 + 每次按键之后）。
  useLayoutEffect(() => {
    resize();
  }, [value, resize]);
  return (
    <textarea
      ref={ref}
      value={value}
      placeholder={placeholder}
      rows={1}
      onChange={(ev) => onChange(ev.target.value)}
      className="nodrag nopan bg-canvas-deep text-ink-soft placeholder:text-ink-placeholder block w-full min-w-0 resize-none overflow-x-hidden rounded-md py-2 pr-3 pl-2.5 text-[13px] leading-relaxed outline-none"
      style={{
        fontFamily: "var(--font-sans)",
        boxSizing: "border-box",
        minHeight,
        maxHeight,
        overflowX: "hidden",
        overflowWrap: "anywhere",
        wordBreak: "break-word",
        scrollbarWidth: "none",
        msOverflowStyle: "none",
      }}
    />
  );
}
