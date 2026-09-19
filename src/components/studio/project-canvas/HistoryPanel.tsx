"use client";

import {
  Download,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Music,
  Plus,
  RefreshCw,
  Video,
  X,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { mediaDragSourceProps } from "~/components/ui/media-drag-source";
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
} from "~/lib/project-canvas/history-panel-types";

function KindIcon({ kind }: { kind: TaskMediaType }) {
  if (kind === "video") return <Video size={16} strokeWidth={1.8} />;
  if (kind === "audio") return <Music size={16} strokeWidth={1.8} />;
  return <ImageIcon size={16} strokeWidth={1.8} />;
}

/* ── Component ─────────────────────────────────────────────── */

interface HistoryPanelProps {
  onClose: () => void;
  /** 当前画布项目 id；有值时默认只看本项目记录。 */
  projectId?: string | null;
  /** 把历史产出投放到画布（由 ProjectCanvas 实现建节点）。 */
  onUse?: (task: {
    id: string;
    cover: string;
    mediaType: TaskMediaType;
  }) => void;
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
        <h2 className="text-ink-bright flex-1 text-[15px] font-semibold">
          历史记录
        </h2>
        {activeCount > 0 && (
          <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] text-violet-700 dark:text-violet-300">
            {activeCount} 进行中
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={refresh}
          className="text-ink-muted hover:bg-subtle hover:text-ink-soft rounded-md"
          title="刷新"
        >
          <RefreshCw size={13} />
        </Button>
        {/* 显示密度切换 */}
        <div className="bg-subtle flex items-center gap-0.5 rounded-lg p-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setDisplay("grid")}
            className={`h-auto rounded-md p-1 ${display === "grid" ? "bg-surface-2 text-ink-bright" : "text-ink-muted hover:text-ink-soft"}`}
            title="网格视图"
          >
            <LayoutGrid size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setDisplay("list")}
            className={`h-auto rounded-md p-1 ${display === "list" ? "bg-surface-2 text-ink-bright" : "text-ink-muted hover:text-ink-soft"}`}
            title="列表视图"
          >
            <List size={14} />
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          className="text-ink-muted hover:bg-subtle hover:text-ink-soft rounded-md"
          title="关闭"
        >
          <X size={14} />
        </Button>
      </div>

      {/* ── 作用域切换（仅在有项目时出现）── */}
      {projectId && (
        <div className="border-border-strong flex gap-4 border-b px-4 pt-2">
          {[
            { id: "project" as HistoryScope, label: "本项目" },
            { id: "all" as HistoryScope, label: "全部" },
          ].map((scopeItem) => (
            <Button
              key={scopeItem.id}
              variant="ghost"
              onClick={() => setScope(scopeItem.id)}
              className={`h-auto rounded-none px-0 pb-2.5 text-[13px] font-medium hover:bg-transparent ${
                scope === scopeItem.id
                  ? "border-accent text-ink-bright border-b-2"
                  : "text-ink-muted hover:text-ink-soft"
              }`}
            >
              {scopeItem.label}
            </Button>
          ))}
        </div>
      )}

      {/* ── 类型筛选（pill）── */}
      <div className="flex gap-1.5 px-4 py-3">
        {FILTER_TABS.map((filterTab) => (
          <Button
            key={filterTab.id}
            variant="ghost"
            onClick={() => setFilter(filterTab.id)}
            className={`h-auto rounded-full px-3 py-1.5 text-[12px] font-medium ${
              filter === filterTab.id
                ? "bg-surface-2 text-ink-bright ring-border-strong ring-1"
                : "text-ink-muted hover:bg-subtle hover:text-ink-soft"
            }`}
          >
            {filterTab.label}
          </Button>
        ))}
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="mx-4 mb-2 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
          <span className="min-w-0 flex-1 text-[11px] break-words text-red-700 dark:text-red-300">
            {error}
          </span>
          <Button
            variant="ghost"
            onClick={refresh}
            className="h-auto shrink-0 text-[11px] text-red-700 underline hover:bg-transparent hover:text-red-900 dark:text-red-200 dark:hover:text-red-100"
          >
            重试
          </Button>
        </div>
      )}

      {/* ── Content ── */}
      <div className="min-w-0 flex-1 overflow-y-auto px-2 pb-4">
        {loading ? (
          <div className="space-y-1 px-2 pt-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={`skeleton-${i}`}
                className="flex items-center gap-3 py-2"
              >
                <Skeleton className="bg-subtle h-10 w-10 shrink-0 rounded-md" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="bg-subtle h-3 w-3/4 rounded" />
                  <Skeleton className="bg-subtle h-2 w-1/3 rounded" />
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
              <Button
                variant="outline"
                onClick={() => setScope("all")}
                className="border-border-strong text-ink-soft hover:bg-subtle hover:text-ink-bright mt-3 h-auto rounded-lg px-3 py-1.5 text-[11px]"
              >
                查看全部记录
              </Button>
            )}
          </div>
        ) : display === "grid" ? (
          /* 网格视图 */
          <div className="grid grid-cols-2 gap-2 px-1 pt-1">
            {tasks.map((task) => {
              const pill = STATUS_PILL[task.status];
              return (
                <div
                  key={task.id}
                  {...mediaDragSourceProps({
                    url: task.cover,
                    kind: task.mediaType,
                    canDrag: isDraggableCover(task),
                    className:
                      "group border-border-strong bg-subtle relative overflow-hidden rounded-lg border",
                  })}
                >
                  <div className="bg-canvas-deep flex aspect-square items-center justify-center overflow-hidden">
                    {task.cover ? (
                      <MediaThumbnail
                        src={task.cover}
                        alt={titleOf(task)}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div
                        className={`flex h-12 w-12 items-center justify-center rounded-lg ${KIND_STYLE[task.mediaType]}`}
                      >
                        <KindIcon kind={task.mediaType} />
                      </div>
                    )}
                  </div>
                  {pill && (
                    <span
                      className={`absolute top-1.5 left-1.5 rounded px-1.5 py-0.5 text-[9px] ${pill.cls}`}
                    >
                      {pill.label}
                    </span>
                  )}
                  <p className="text-ink-soft truncate px-2 py-1.5 text-[11px]">
                    {titleOf(task)}
                  </p>
                  {onUse && task.cover && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() =>
                        onUse({
                          id: task.id,
                          cover: task.cover!,
                          mediaType: task.mediaType,
                        })
                      }
                      className="text-ink-soft absolute top-1 right-1 hidden rounded bg-black/60 backdrop-blur group-hover:flex hover:bg-black/60 hover:text-white"
                      title="加入画布"
                    >
                      <Plus size={12} strokeWidth={2.5} />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* 列表视图 */
          <div className="space-y-0.5">
            {tasks.map((task) => {
              const pill = STATUS_PILL[task.status];
              return (
                <div
                  key={task.id}
                  {...mediaDragSourceProps({
                    url: task.cover,
                    kind: task.mediaType,
                    canDrag: isDraggableCover(task),
                    className:
                      "hover:bg-subtle group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors",
                  })}
                >
                  {/* 缩略图 / 类型占位 */}
                  {task.cover ? (
                    <div className="bg-canvas-deep h-10 w-10 shrink-0 overflow-hidden rounded-md">
                      <MediaThumbnail
                        src={task.cover}
                        alt={titleOf(task)}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ) : (
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${KIND_STYLE[task.mediaType]}`}
                    >
                      <KindIcon kind={task.mediaType} />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="text-ink-bright truncate text-[13px]">
                      {titleOf(task)}
                    </p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className="text-ink-fainter text-[11px]">
                        {timeAgo(task.createdAt)}
                      </span>
                      {pill && (
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] ${pill.cls}`}
                        >
                          {pill.label}
                        </span>
                      )}
                      {task.status === "FAILED" && task.error && (
                        <span
                          className="min-w-0 truncate text-[10px] text-red-700/80 dark:text-red-400/70"
                          title={task.error}
                        >
                          {task.error}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="hidden shrink-0 items-center gap-1 pr-1 group-hover:flex">
                    {onUse && task.cover && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() =>
                          onUse({
                            id: task.id,
                            cover: task.cover!,
                            mediaType: task.mediaType,
                          })
                        }
                        className="text-ink-muted hover:bg-subtle hover:text-ink-bright rounded-md"
                        title="加入画布"
                      >
                        <Plus size={13} strokeWidth={2.5} />
                      </Button>
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
