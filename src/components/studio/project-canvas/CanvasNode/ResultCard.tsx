/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
"use client";

import { Icon } from "@/components/ui/Icon";
import { NODE_META, type CanvasNodeData, type NodeKind } from "../canvas-types";
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
  const displayName = name?.trim() || meta.label;

  /* ── Text result ── */
  if (kind === "script" || kind === "agent" || (!src && text)) {
    return (
      <div className="nodrag nopan relative mt-2 overflow-hidden rounded-xl border border-white/8 bg-white/3">
        {/* Header — top-left: type char + name, top-right: status badge */}
        <div className="flex items-center justify-between border-b border-white/6 bg-black/15 px-2.5 py-1.5">
          <NodeChip kind={kind} name={displayName} size="sm" />
          <StatusBadge status={status} />
        </div>
        {/* Edit toolbar */}
        <div className="flex items-center justify-center gap-1 border-b border-white/6 bg-black/20 px-2 py-1.5">
          <button type="button" title="字号减小" className="rounded-md px-2 py-1 text-[11px] font-medium text-gray-300 hover:bg-white/6">A-</button>
          <button type="button" title="字号增大" className="rounded-md px-2 py-1 text-[11px] font-medium text-gray-300 hover:bg-white/6">A+</button>
          <span className="mx-1 h-3 w-px bg-white/8" />
          <button type="button" title="编辑" className="rounded-md px-2 py-1 text-[11px] text-gray-300 hover:bg-white/6">
            <Icon name="pen" size={11} className="mr-1 inline align-[-1px]" />编辑
          </button>
          <button type="button" title="下载" onClick={() => text && navigator.clipboard?.writeText(text)} className="rounded-md px-2 py-1 text-[11px] text-gray-300 hover:bg-white/6">
            <Icon name="download" size={11} className="mr-1 inline align-[-1px]" />下载
          </button>
        </div>
        <div className="max-h-56 overflow-auto p-3 text-[12px] leading-relaxed text-gray-200">
          {text || <span className="text-gray-500">尚无文本输出</span>}
        </div>
        <div className="flex items-center justify-center border-t border-white/6 py-2">
          <button type="button" onClick={onReplace} className="flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-[11px] text-gray-200 ring-1 ring-white/8 transition-colors hover:bg-black/60">
            <Icon name="refresh" size={11} />替换
          </button>
        </div>
      </div>
    );
  }

  /* ── Image / video result ── */
  return (
    <div className="nodrag nopan relative mt-2 overflow-hidden rounded-xl border border-white/8 bg-white/3">
      {/* Header — top-left: type char + name, top-right: status badge */}
      <div className="flex items-center justify-between border-b border-white/6 bg-black/15 px-2.5 py-1.5">
        <NodeChip kind={kind} name={displayName} size="sm" />
        <StatusBadge status={status} />
      </div>
      <div className="relative flex aspect-video items-center justify-center bg-linear-to-br from-[#1a1530]/40 to-[#0f0b1c]/40">
        {!src ? (
          <Icon name={isVideo ? "film" : "image"} size={32} className="text-gray-600" />
        ) : isVideo ? (
          <video src={src} controls autoPlay loop muted className="max-h-56 w-full object-contain" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="result" className="max-h-56 w-full object-contain" />
        )}
      </div>
      <div className="flex items-center justify-center border-t border-white/6 py-2">
        <button type="button" onClick={onReplace} className="flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-[11px] text-gray-200 ring-1 ring-white/8 transition-colors hover:bg-black/60">
          <Icon name="refresh" size={11} />替换
        </button>
      </div>
    </div>
  );
}
