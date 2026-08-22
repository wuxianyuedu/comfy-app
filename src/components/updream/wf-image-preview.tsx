"use client";
/* Extracted image preview + string textarea — originally inside WorkflowCanvasEditor.tsx. */
import React, { useRef, useLayoutEffect, useState } from "react";
import type { RawInputMeta } from "./wf-types";
export function StringTextarea({ value, mono, hasSize }: { value: string; mono?: boolean; hasSize: boolean }) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    if (!hasSize) {
      // Content-sized node: textarea decides its own height, capped at
      // content.  No 96px cap (R17): a multi-line prompt must stay
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
      onFocus={(e) => e.currentTarget.blur()}
      className={
        "block w-full resize-none rounded border border-white/10 bg-black/40 px-2 py-1.5 text-[10.5px] leading-snug text-gray-200 outline-none" +
        (mono ? " font-mono" : "")
      }
      style={{
        /* `width: 100%` claims every pixel the row's flexbox gives us.
         * `flex: 1 1 0` + `minHeight: 0` joins the row's flex chain in
         *  the hasSize path — the textarea fills the STRING row's
         *  remaining vertical space (R17: vertical stacked).  R16 had
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

/** The roles a node can be assigned in the paramMap */
export function WfImagePreview({ entry }: { entry: RawInputMeta }) {
  const ref = entry.imageRef;
  const label = entry.localized || entry.label || entry.name;
  /* Empty LoadImage (no widgets_values[0]) → placeholder card.  Same layout
   * dimensions as the thumbnail (110px tall) so the preview area is
   * visually consistent regardless of upload state, and the bordered /
   * rounded box keeps the slot discoverable when scanning the canvas. */
  if (!ref) {
    return (
      <div className="flex flex-col gap-1">
        <div className="truncate text-[11px] text-zinc-300" title={label}>
          {label}
        </div>
        <div className="flex h-[110px] items-center justify-center rounded-md border border-dashed border-white/15 bg-black/40 text-[11px] text-gray-400">
          需要上传图片
        </div>
      </div>
    );
  }
  const src = `/api/images?filename=${encodeURIComponent(ref.filename)}&subfolder=${encodeURIComponent(
    ref.subfolder
  )}&type=${encodeURIComponent(ref.type)}`;
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <div className="truncate text-[11px] text-zinc-300" title={label}>
        {label}
      </div>
      <div className="overflow-hidden rounded-md border border-white/10 bg-black/40">
        {failed ? (
          <div className="flex h-[110px] items-center justify-center text-[10px] text-gray-500">图片不可用</div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={ref.filename}
            className="block max-h-[110px] w-full object-contain"
            loading="lazy"
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) {
                setSize({ w: img.naturalWidth, h: img.naturalHeight });
              }
            }}
            onError={() => setFailed(true)}
          />
        )}
      </div>
      {size && (
        <div className="text-right text-[10px] tabular-nums text-gray-400">
          {size.w} × {size.h}
        </div>
      )}
    </div>
  );
}

/* ── Custom node renderer for ComfyUI graph nodes ── */
