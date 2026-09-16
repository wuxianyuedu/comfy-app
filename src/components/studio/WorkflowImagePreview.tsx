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
        <div className="text-ink-soft truncate text-[11px]" title={label}>
          {label}
        </div>
        <div className="border-border-strong bg-canvas-deep text-ink-soft flex h-[110px] items-center justify-center rounded-md border border-dashed text-[11px]">
          需要上传图片
        </div>
      </div>
    );
  }
  const src = `/api/images?filename=${encodeURIComponent(ref.filename)}&subfolder=${encodeURIComponent(
    ref.subfolder,
  )}&type=${encodeURIComponent(ref.type)}`;
  return (
    <div className="flex flex-col gap-1">
      <div className="text-ink-soft truncate text-[11px]" title={label}>
        {label}
      </div>
      <div className="border-border-strong bg-canvas-deep overflow-hidden rounded-md border">
        {failed ? (
          <div className="text-ink-muted flex h-[110px] items-center justify-center text-[10px]">
            图片不可用
          </div>
        ) : (
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
        <div className="text-ink-soft text-right text-[10px] tabular-nums">
          {size.w} × {size.h}
        </div>
      )}
    </div>
  );
}

/* ── Custom node renderer for ComfyUI graph nodes ── */
