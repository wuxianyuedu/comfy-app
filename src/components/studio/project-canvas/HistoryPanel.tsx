"use client";

import { Download, Image as ImageIcon, LayoutGrid, List, Music, Plus, RefreshCw, Video, X } from "lucide-react";
import { MediaThumbnail } from "@/components/studio/ui/MediaThumbnail";
import { useHistoryPanel } from "./hooks/use-history-panel";
import {
  FILTER_TABS,
  KIND_STYLE,
  STATUS_PILL,
  isDraggableCover,
  timeAgo,
  titleOf,
  type HistoryScope,
  type TaskMediaType,
} from "@/lib/project-canvas/history-panel-types";

function KindIcon({ kind }: { kind: TaskMediaType }) {
  if (kind === "video")
    return <Video size={16} strokeWidth={1.8} />;
  if (kind === "audio")
    return <Music size={16} strokeWidth={1.8} />;
  return <ImageIcon size={16} strokeWidth={1.8} />;
}

/* ── Component ─────────────────────────────────────────────── */

interface HistoryPanelProps {
  onClose: () => void;
  /** 当前画布项目 id；有值时默认只看本项目记录。 */
  projectId?: string | null;
  /** 把历史产出投放到画布（由 ProjectCanvas 实现建节点）。 */
  onUse?: (task: { id: string; cover: string; mediaType: TaskMediaType }) => void;
}

export function HistoryPanel({ onClose, projectId, onUse }: HistoryPanelProps) {
  const {
    tasks,
    loading,
    error,
    scope,
    filter,
    display,
    activeCount,
    globalCount,
    setScope,
    setFilter,
    setDisplay,
    refresh,
  } = useHistoryPanel({ projectId });

  return (
    <aside className="bg-panel/98 border-border-strong flex h-full w-[360px] shrink-0 flex-col overflow-hidden border-l backdrop-blur-md">
      {/* ── Header ── */}
      <div className="border-border-strong flex items-center gap-2 border-b px-4 py-3">
        <h2 className="text-ink-bright flex-1 text-[15px] font-semibold">历史记录</h2>
        {activeCount > 0 && (
          <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] text-violet-300">
            {activeCount} 进行中
          </span>
        )}
        <button
          type="button"
          onClick={refresh}
          className="text-ink-muted hover:bg-subtle hover:text-ink-soft flex h-6 w-6 items-center justify-center rounded-md transition-colors"
          title="刷新"
        >
          <RefreshCw size={13} />
        </button>
        {/* 显示密度切换 */}
        <div className="bg-subtle flex items-center gap-0.5 rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => setDisplay("grid")}
            className={`rounded-md p-1 transition-colors ${display === "grid" ? "bg-surface-2 text-ink-bright" : "text-ink-muted hover:text-ink-soft"}`}
            title="网格视图"
          >
            <LayoutGrid size={14} />
          </button>
          <button
            type="button"
            onClick={() => setDisplay("list")}
            className={`rounded-md p-1 transition-colors ${display === "list" ? "bg-surface-2 text-ink-bright" : "text-ink-muted hover:text-ink-soft"}`}
            title="列表视图"
          >
            <List size={14} />
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-ink-muted hover:bg-subtle hover:text-ink-soft flex h-6 w-6 items-center justify-center rounded-md transition-colors"
          title="关闭"
        >
          <X size={14} />
        </button>
      </div>

      {/* ── 作用域切换（仅在有项目时出现）── */}
      {projectId && (
        <div className="border-border-strong flex gap-4 border-b px-4 pt-2">
          {([
            { id: "project" as HistoryScope, label: "本项目" },
            { id: "all" as HistoryScope, label: "全部" },
          ]).map((scopeItem) => (
            <button
              key={scopeItem.id}
              type="button"
              onClick={() => setScope(scopeItem.id)}
              className={`pb-2.5 text-[13px] font-medium transition-colors ${
                scope === scopeItem.id
                  ? "border-accent text-ink-bright border-b-2"
                  : "text-ink-muted hover:text-ink-soft"
              }`}
            >
              {scopeItem.label}
            </button>
          ))}
        </div>
      )}

      {/* ── 类型筛选（pill）── */}
      <div className="flex gap-1.5 px-4 py-3">
        {FILTER_TABS.map((filterTab) =>
(
          <button
            key={filterTab.id}
            type="button"
            onClick={() => setFilter(filterTab.id)}
            className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-all ${
              filter === filterTab.id
                ? "bg-surface-2 text-ink-bright ring-border-strong ring-1"
                : "text-ink-muted hover:bg-subtle hover:text-ink-soft"
            }`}
          >
            {filterTab.label}
          </button>
        ))}
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="mx-4 mb-2 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
          <span className="min-w-0 flex-1 break-words text-[11px] text-red-300">{error}</span>
          <button
            type="button"
            onClick={refresh}
            className="shrink-0 text-[11px] text-red-200 underline transition-colors hover:text-red-100"
          >
            重试
          </button>
        </div>
      )}

      {/* ── Content ── */}
      <div className="min-w-0 flex-1 overflow-y-auto px-2 pb-4">
        {loading ? (
          <div className="space-y-1 px-2 pt-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={`skeleton-${i}`} className="flex items-center gap-3 py-2">
                <div className="bg-subtle h-10 w-10 shrink-0 animate-pulse rounded-md" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="bg-subtle h-3 w-3/4 animate-pulse rounded" />
                  <div className="bg-subtle h-2 w-1/3 animate-pulse rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-ink-fainter text-[12px]">
              {scope === "project" ? "本项目还没有生成记录" : "暂无历史记录"}
            </p>
            {scope === "project" && globalCount !== null && globalCount > 0 && (
              <button
                type="button"
                onClick={() => setScope("all")}
                className="mt-3 border-border-strong text-ink-soft hover:bg-subtle hover:text-ink-bright rounded-lg border px-3 py-1.5 text-[11px] transition-colors"
              >
                查看全部记录
              </button>
            )}
          </div>
        ) : display === "grid" ? (
          /* 网格视图 */
          <div className="grid grid-cols-2 gap-2 px-1 pt-1">
            {tasks.map((task) =>
{
              const pill = STATUS_PILL[task.status];
              return (
                <div
                  key={task.id}
                  draggable={isDraggableCover(task)}
                  onDragStart={(event) => {
                    if (!task.cover) return;
                    event.dataTransfer.setData(
                      "application/x-comfyapp-media",
                      JSON.stringify({
                        url: task.cover,
                        displayName: task.cover.split("/").pop() ?? task.id,
                        mediaType: task.mediaType,
                      })
                    );
                    event.dataTransfer.effectAllowed = "copy";
                  }}
                  className={`group relative border-border-strong bg-subtle overflow-hidden rounded-lg border ${
                    isDraggableCover(task)
                      ? "cursor-grab active:cursor-grabbing"
                      : ""
                  }`}
                >
                  <div className="bg-canvas-deep flex aspect-square items-center justify-center overflow-hidden">
                    {task.cover ? (
                      <MediaThumbnail src={task.cover} alt={titleOf(task)} className="h-full w-full object-cover" />
                    ) : (
                      <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${KIND_STYLE[task.mediaType]}`}>
                        <KindIcon kind={task.mediaType} />
                      </div>
                    )}
                  </div>
                  {pill && (
                    <span className={`absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[9px] ${pill.cls}`}>
                      {pill.label}
                    </span>
                  )}
                  <p className="text-ink-soft truncate px-2 py-1.5 text-[11px]">{titleOf(task)}</p>
                  {onUse && task.cover && (
                    <button
                      type="button"
                      onClick={() => onUse({ id: task.id, cover: task.cover!, mediaType: task.mediaType })}
                      className="bg-black/60 text-ink-soft absolute top-1 right-1 hidden h-6 w-6 items-center justify-center rounded backdrop-blur transition-colors group-hover:flex hover:text-white"
                      title="加入画布"
                    >
                      <Plus size={12} strokeWidth={2.5} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* 列表视图 */
          <div className="space-y-0.5">
            {tasks.map((task) =>
{
              const pill = STATUS_PILL[task.status];
              return (
                <div
                  key={task.id}
                  draggable={isDraggableCover(task)}
                  onDragStart={(event) => {
                    if (!task.cover) return;
                    event.dataTransfer.setData(
                      "application/x-comfyapp-media",
                      JSON.stringify({
                        url: task.cover,
                        displayName: task.cover.split("/").pop() ?? task.id,
                        mediaType: task.mediaType,
                      })
                    );
                    event.dataTransfer.effectAllowed = "copy";
                  }}
                  className={`hover:bg-subtle group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors ${
                    isDraggableCover(task)
                      ? "cursor-grab active:cursor-grabbing"
                      : ""
                  }`}
                >
                  {/* 缩略图 / 类型占位 */}
                  {task.cover ? (
                    <div className="bg-canvas-deep h-10 w-10 shrink-0 overflow-hidden rounded-md">
                      <MediaThumbnail src={task.cover} alt={titleOf(task)} className="h-full w-full object-cover" />
                    </div>
                  ) : (
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${KIND_STYLE[task.mediaType]}`}>
                      <KindIcon kind={task.mediaType} />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="text-ink-bright truncate text-[13px]">{titleOf(task)}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className="text-ink-fainter text-[11px]">{timeAgo(task.createdAt)}</span>
                      {pill && (
                        <span className={`rounded px-1.5 py-0.5 text-[9px] ${pill.cls}`}>
                          {pill.label}
                        </span>
                      )}
                      {task.status === "FAILED" && task.error && (
                        <span className="min-w-0 truncate text-[10px] text-red-700/80 dark:text-red-400/70" title={task.error}>
                          {task.error}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="hidden shrink-0 items-center gap-1 pr-1 group-hover:flex">
                    {onUse && task.cover && (
                      <button
                        type="button"
                        onClick={() => onUse({ id: task.id, cover: task.cover!, mediaType: task.mediaType })}
                        className="text-ink-muted hover:bg-subtle hover:text-ink-bright flex h-7 w-7 items-center justify-center rounded-md transition-colors"
                        title="加入画布"
                      >
                        <Plus size={13} strokeWidth={2.5} />
                      </button>
                    )}
                    {task.cover && (
                      <a
                        href={task.cover}
                        download
                        draggable={false}
                        className="text-ink-muted hover:bg-subtle hover:text-ink-bright flex h-7 w-7 items-center justify-center rounded-md transition-colors"
                        title="下载"
                      >
                        <Download size={13} />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
