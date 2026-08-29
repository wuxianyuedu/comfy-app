"use client";
/* Extracted image preview + string textarea — originally inside WorkflowCanvasEditor.tsx. */
import { useState } from "react";
import type { RawInputMeta } from "./workflow-types";

/** The roles a node can be assigned in the paramMap */
export function WorkflowImagePreview({ entry }: { entry: RawInputMeta }) {
  const ref = entry.imageRef;
  const label = entry.localized ?? entry.label ?? entry.name;
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
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
            onLoad={(event) => {
              const img = event.currentTarget;
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