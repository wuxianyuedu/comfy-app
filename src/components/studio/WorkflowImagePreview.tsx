"use client";
/* 抽出的图片预览 + 字符串 textarea —— 原本在 WorkflowCanvasEditor.tsx 里。 */
import { useState } from "react";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { comfyImageUrl } from "~/lib/media/media-url";
import { readNaturalSize, type NaturalSize } from "~/lib/media/natural-size";
import type { RawInputMeta } from "./workflow-types";

/** 节点在 paramMap 里可以分配到的角色 */
export function WorkflowImagePreview({ entry }: { entry: RawInputMeta }) {
  const ref = entry.imageRef;
  const label = entry.localized ?? entry.label ?? entry.name;
  const [size, setSize] = useState<NaturalSize | null>(null);
  /* 空的 LoadImage（没有 widgets_values[0]）→ 占位卡片。与缩略图
   * 同一套布局尺寸（110px 高），好让预览区
   * 无论上传状态如何都视觉一致，并且带边框 /
   * 圆角的盒子让该槽位在扫读画布时仍可发现。 */
  if (!ref) {
    return (
      <div className="flex flex-col gap-1">
        <div className="text-ink-soft truncate text-[11px]" title={label}>
          {label}
        </div>
        <div className="border-border-strong bg-canvas-deep text-ink-soft flex h-27.5 items-center justify-center rounded-md border border-dashed text-[11px]">
          需要上传图片
        </div>
      </div>
    );
  }
  const src = comfyImageUrl(ref);
  return (
    <div className="flex flex-col gap-1">
      <div className="text-ink-soft truncate text-[11px]" title={label}>
        {label}
      </div>
      <div className="border-border-strong bg-canvas-deep overflow-hidden rounded-md border">
        {/* 失败兜底收在基元里（同一个「110px 高」盒子，不跳布局）。 */}
        <MediaThumbnail
          src={src}
          alt={ref.filename}
          className="block max-h-27.5 w-full object-contain"
          fallback={
            <div className="text-ink-muted flex h-27.5 items-center justify-center text-[10px]">
              图片不可用
            </div>
          }
          /* 自然尺寸的读取口径收在 `~/lib/media/natural-size`
           *（规范 16 §16.2.4.31）：读不到（还没解码完 / 元数据缺失）时
           * 出口给 `null`，而不是 `{0, 0}` 那种会让下游算出 `Infinity` 的值。 */
          onLoad={(media) => {
            const size = readNaturalSize(media);
            if (size) setSize(size);
          }}
        />
      </div>
      {size && (
        <div className="text-ink-soft text-right text-[10px] tabular-nums">
          {size.width} × {size.height}
        </div>
      )}
    </div>
  );
}

/* ── ComfyUI 图节点的自定义节点渲染器 ── */
