"use client";
import React from "react";

export function StringTextarea({ value, mono, hasSize }: { value: string; mono?: boolean; hasSize: boolean }) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    if (!hasSize) {
      // Content-sized node: textarea decides its own height, capped at
      // content. No 96px cap: a multi-line prompt must stay
      // fully visible instead of being clipped behind the row's other
      // half.  `auto` first so the browser can compute the new
      // scrollHeight after the value changes.
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    }
    // hasSize: height is owned by the flex chain (the parent's `flex-1` +
    // `min-h-0`); leave the textarea inline style untouched so CSS wins.
  }, [value, hasSize]);
  return (
    <textarea
      ref={ref}
      readOnly
      value={value}
      rows={1}
      onFocus={(event) => event.currentTarget.blur()}
      className={
        "block w-full resize-none rounded border border-border-strong bg-canvas-deep px-2 py-1.5 text-[10.5px] leading-snug text-ink-bright outline-none" +
        (mono ? " font-mono" : "")
      }
      style={{
        /* `width: 100%` claims every pixel the row's flexbox gives us.
         * `flex: 1 1 0` + `minHeight: 0` joins the row's flex chain in
         *  the hasSize path — the textarea fills the STRING row's
         *  remaining vertical space (vertical stacked). had
         *  `maxHeight: 96` here; removed because it capped a 12-line
         *  prompt behind the row's other half and was the "内容不可
         *  自适应高度，不铺满可用空间" the user reported.
         * `minWidth: 0` overrides the default `min-width: auto` so a
         *  very wide prompt line can ellipsize on the cross axis instead
         *  of pushing the label off-screen.  (Irrelevant now that the
         *  label sits on its own row above, but kept as defensive.)
         * `overflowY: "auto"` lets any leftover content scroll. */
        width: "100%",
        flex: "1 1 0",
        minHeight: 0,
        minWidth: 0,
        overflowY: "auto",
      }}
      title={value}
    />
  );
}
