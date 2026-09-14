"use client";

import { Icon } from "@/components/ui/icon";
import { NODE_META, type CanvasNodeData, type NodeKind } from "@/lib/project-canvas/canvas-types";
import { NodeChip, StatusBadge } from "./CanvasNodePrimitives";

/* ── Result preview card ──
 * The card itself mimics a node: it has a top-left "type char + name" header
 * and a status badge below, so the user can read the output's identity and
 * lifecycle at a glance — the same surface that already shows on the parent
 * node.  Then comes the content (image / video / text) and a 替换 button. */
export function ResultCard({
  kind,
  name,
  status,
  path,
  mediaType,
  text,
  onReplace,
}: {
  kind: NodeKind;
  name?: string;
  status: CanvasNodeData["status"];
  path?: string;
  mediaType?: string;
  text?: string;
  onReplace: () => void;
}) {
  const isVideo = kind === "video" || mediaType === "video" || (path && /\.(mp4|webm|ogg)$/i.test(path));
  const src = path?.startsWith("/") ? path : path ? `/${path}` : undefined;
  const meta = NODE_META[kind];
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- 空字符串名视为无输出，需用 || 回退到 meta.label
  const displayName = name?.trim() || meta.label;

  /* ── Text result ── */
  if (kind === "script" || kind === "agent" || (!src && text)) {
    return (
      <div className="nodrag nopan border-border-strong bg-subtle relative mt-2 overflow-hidden rounded-xl border">
        {/* Header — top-left: type char + name, top-right: status badge */}
        <div className="border-border-strong bg-canvas-deep flex items-center justify-between border-b px-2.5 py-1.5">
          <NodeChip kind={kind} name={displayName} size="sm" />
          <StatusBadge status={status} />
        </div>
        {/* Edit toolbar */}
        <div className="border-border-strong bg-canvas-deep flex items-center justify-center gap-1 border-b px-2 py-1.5">
          <button type="button" title="字号减小" className="text-ink-soft hover:bg-subtle rounded-md px-2 py-1 text-[11px] font-medium">A-</button>
          <button type="button" title="字号增大" className="text-ink-soft hover:bg-subtle rounded-md px-2 py-1 text-[11px] font-medium">A+</button>
          <span className="bg-border-strong mx-1 h-3 w-px" />
          <button type="button" title="编辑" className="text-ink-soft hover:bg-subtle rounded-md px-2 py-1 text-[11px]">
            <Icon name="pen" size={11} className="mr-1 inline align-[-1px]" />编辑
          </button>
          <button type="button" title="下载" onClick={() => text && navigator.clipboard?.writeText(text)} className="text-ink-soft hover:bg-subtle rounded-md px-2 py-1 text-[11px]">
            <Icon name="download" size={11} className="mr-1 inline align-[-1px]" />下载
          </button>
        </div>
        <div className="text-ink-bright max-h-56 overflow-auto p-3 text-[12px] leading-relaxed">
          {
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- 空字符串也视为无输出，需回退占位
            text || <span className="text-ink-muted">尚无文本输出</span>
          }
        </div>
        <div className="border-border-strong flex items-center justify-center border-t py-2">
          <button type="button" onClick={onReplace} className="bg-canvas-deep text-ink-bright ring-border-strong hover:bg-surface-2 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] ring-1 transition-colors">
            <Icon name="refresh" size={11} />替换
          </button>
        </div>
      </div>
    );
  }

  /* ── Image / video result ── */
  return (
    <div className="nodrag nopan border-border-strong bg-subtle relative mt-2 overflow-hidden rounded-xl border">
      {/* Header — top-left: type char + name, top-right: status badge */}
      <div className="border-border-strong bg-canvas-deep flex items-center justify-between border-b px-2.5 py-1.5">
        <NodeChip kind={kind} name={displayName} size="sm" />
        <StatusBadge status={status} />
      </div>
      <div className="relative flex aspect-video items-center justify-center bg-linear-to-br from-subtle to-canvas-deep">
        {!src ? (
          <Icon
            name={isVideo ? "film" : "image"}
            size={32}
            className="text-ink-fainter"
          />
        ) : isVideo ? (
          <video src={src} controls autoPlay loop muted className="max-h-56 w-full object-contain" />
        ) : (
           
          <img src={src} alt="result" className="max-h-56 w-full object-contain" />
        )}
      </div>
      <div className="border-border-strong flex items-center justify-center border-t py-2">
        <button type="button" onClick={onReplace} className="bg-canvas-deep text-ink-bright ring-border-strong hover:bg-surface-2 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] ring-1 transition-colors">
          <Icon name="refresh" size={11} />替换
        </button>
      </div>
    </div>
  );
}
