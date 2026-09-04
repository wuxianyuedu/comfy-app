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
    <aside className="flex h-full w-[360px] shrink-0 flex-col overflow-hidden border-l border-white/6 bg-(--color-panel)/98 backdrop-blur-md">
      {/* ── Header ── */}
      <div className="flex items-center gap-2 border-b border-white/6 px-4 py-3">
        <h2 className="flex-1 text-[15px] font-semibold text-gray-100">历史记录</h2>
        {activeCount > 0 && (
          <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] text-violet-300">
            {activeCount} 进行中
          </span>
        )}
        <button
          type="button"
          onClick={refresh}
          className="flex h-6 w-6 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-white/6 hover:text-gray-300"
          title="刷新"
        >
          <RefreshCw size={13} />
        </button>
        {/* 显示密度切换 */}
        <div className="flex items-center gap-0.5 rounded-lg bg-white/4 p-0.5">
          <button
            type="button"
            onClick={() => setDisplay("grid")}
            className={`rounded-md p-1 transition-colors ${display === "grid" ? "bg-white/10 text-gray-200" : "text-gray-500 hover:text-gray-300"}`}
            title="网格视图"
          >
            <LayoutGrid size={14} />
          </button>
          <button
            type="button"
            onClick={() => setDisplay("list")}
            className={`rounded-md p-1 transition-colors ${display === "list" ? "bg-white/10 text-gray-200" : "text-gray-500 hover:text-gray-300"}`}
            title="列表视图"
          >
            <List size={14} />
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-white/6 hover:text-gray-300"
          title="关闭"
        >
          <X size={14} />
        </button>
      </div>

      {/* ── 作用域切换（仅在有项目时出现）── */}
      {projectId && (
        <div className="flex gap-4 border-b border-white/6 px-4 pt-2">
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
                  ? "border-b-2 border-(--color-accent) text-gray-100"
                  : "text-gray-500 hover:text-gray-300"
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
                ? "bg-white/12 text-gray-100 ring-1 ring-white/10"
                : "text-gray-500 hover:bg-white/4 hover:text-gray-300"
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
                <div className="h-10 w-10 shrink-0 animate-pulse rounded-md bg-white/5" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="h-3 w-3/4 animate-pulse rounded bg-white/5" />
                  <div className="h-2 w-1/3 animate-pulse rounded bg-white/4" />
                </div>
              </div>
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-[12px] text-gray-600">
              {scope === "project" ? "本项目还没有生成记录" : "暂无历史记录"}
            </p>
            {scope === "project" && globalCount !== null && globalCount > 0 && (
              <button
                type="button"
                onClick={() => setScope("all")}
                className="mt-3 rounded-lg border border-white/8 px-3 py-1.5 text-[11px] text-gray-400 transition-colors hover:bg-white/4 hover:text-gray-200"
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
                  className={`group relative overflow-hidden rounded-lg border border-white/6 bg-white/2 ${
                    isDraggableCover(task)
                      ? "cursor-grab active:cursor-grabbing"
                      : ""
                  }`}
                >
                  <div className="flex aspect-square items-center justify-center overflow-hidden bg-black/20">
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
                  <p className="truncate px-2 py-1.5 text-[11px] text-gray-300">{titleOf(task)}</p>
                  {onUse && task.cover && (
                    <button
                      type="button"
                      onClick={() => onUse({ id: task.id, cover: task.cover!, mediaType: task.mediaType })}
                      className="absolute right-1 top-1 hidden h-6 w-6 items-center justify-center rounded bg-black/60 text-gray-300 backdrop-blur transition-colors hover:text-white group-hover:flex"
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
                  className={`group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-white/4 ${
                    isDraggableCover(task)
                      ? "cursor-grab active:cursor-grabbing"
                      : ""
                  }`}
                >
                  {/* 缩略图 / 类型占位 */}
                  {task.cover ? (
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-black/20">
                      <MediaThumbnail src={task.cover} alt={titleOf(task)} className="h-full w-full object-cover" />
                    </div>
                  ) : (
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${KIND_STYLE[task.mediaType]}`}>
                      <KindIcon kind={task.mediaType} />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-gray-200">{titleOf(task)}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className="text-[11px] text-gray-600">{timeAgo(task.createdAt)}</span>
                      {pill && (
                        <span className={`rounded px-1.5 py-0.5 text-[9px] ${pill.cls}`}>
                          {pill.label}
                        </span>
                      )}
                      {task.status === "FAILED" && task.error && (
                        <span className="min-w-0 truncate text-[10px] text-red-400/70" title={task.error}>
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
                        className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-white/8 hover:text-gray-200"
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
                        className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-white/8 hover:text-gray-200"
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
