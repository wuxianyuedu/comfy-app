"use client";

import { clamp } from "~/lib/clamp";
import { textHandler } from "~/lib/form-props";
import { Textarea } from "~/components/ui/textarea";
import { useCallback, useLayoutEffect, useRef } from "react";

/** 自动增高 textarea，宽度严格锁死在父级。替换 field-sizing: content —— Chrome 实现会让固有内容宽度
 *  溢出父级（最长不可断行超过内部宽度 282px = 卡片 340 - 2 边框 - 14×2 内边距），overflowWrap 只能裁字、约束不了盒子几何。
 *  本组件：高度交给 JS（reset auto 后读 scrollHeight，夹在 [MIN, MAX]）；box-sizing: border-box + width: 100%
 *  让盒子严格等于父内容盒；保留横向溢出守卫与滚动条抑制（webkit/firefox/ms）。 */
export function AutoResizeTextarea({
  value,
  placeholder,
  onChange,
  minHeight = 28,
  maxHeight = 120,
}: {
  maxHeight?: number;
  minHeight?: number;
  onChange: (v: string) => void;
  placeholder?: string;
  value: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
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
    <Textarea
      className="nodrag nopan bg-canvas-deep text-ink-soft placeholder:text-ink-placeholder field-sizing-normal block w-full min-w-0 resize-none overflow-x-hidden rounded-md border-0 py-2 pr-3 pl-2.5 text-sm leading-relaxed focus-visible:ring-0"
      onChange={textHandler(onChange)}
      placeholder={placeholder}
      ref={ref}
      rows={1}
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
      value={value}
    />
  );
}
