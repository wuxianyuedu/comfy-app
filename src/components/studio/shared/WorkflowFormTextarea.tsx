"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

/** Auto-growing textarea with width strictly locked to the parent.
 *
 *  replaces the `field-sizing: content` approach
 *  used in . The native `field-sizing` property was supposed
 *  to give us auto-height while keeping `maxWidth: 100%` as a hard cap, but
 *  Chrome's implementation lets intrinsic content width overflow the parent
 *  when a real prompt's longest unbreakable line exceeds the control's inner
 *  width (282px = Card 340 - 2 border - 14×2 padding). The overflow-X rules
 *  (`overflowWrap: anywhere`, `wordBreak: break-word`) only clip the
 *  visible text — they cannot constrain the textarea's box geometry.
 *
 *  This component instead:
 *   - drives height via JS (scrollHeight after a reset to `auto`), clamped
 *     to [MIN, MAX]; the textarea therefore sizes itself row-by-row, never
 *     relies on the new `field-sizing` API;
 *   - sets `box-sizing: border-box` + `width: 100%` so the box width is
 *     strictly the parent's content box, immune to intrinsic sizing;
 *   - keeps the horizontal overflow guards (pr-3 > pl-2.5,
 *     overflowX: hidden, overflowWrap: anywhere, wordBreak: break-word);
 *   - keeps the scrollbar suppression (webkit + firefox + ms).
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
    // Reset to "auto" so scrollHeight reflects only the natural content height
    // (otherwise it'd be clamped to the previous explicit height).
    el.style.height = "auto";
    const natural = el.scrollHeight;
    const clamped = Math.min(Math.max(natural, minHeight), maxHeight);
    el.style.height = `${clamped}px`;
    el.style.overflowY = natural > maxHeight ? "auto" : "hidden";
  }, [minHeight, maxHeight]);
  // Run after every value change (initial mount + after each keystroke).
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
