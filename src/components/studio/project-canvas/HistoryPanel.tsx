"use client";

import { Download, Image as ImageIcon, Music, Plus, RefreshCw, Video, X } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { Skeleton } from "~/components/ui/skeleton";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { SelectChip } from "~/components/ui/select-chip";
import { DisplayDensityToggle } from "~/components/ui/display-density-toggle";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
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
  if (kind === "video") {
    return <Video size={16} strokeWidth={1.8} />;
  }
  if (kind === "audio") {
    return <Music size={16} strokeWidth={1.8} />;
  }
  return <ImageIcon size={16} strokeWidth={1.8} />;
}

/* ── Component ─────────────────────────────────────────────── */

type HistoryPanelProps = {
  onClose: () => void;
  /** 把历史产出投放到画布（由 ProjectCanvas 实现建节点）。 */
  onUse?: (task: { cover: string; id: string; mediaType: TaskMediaType }) => void;
  /** 当前画布项目 id；有值时默认只看本项目记录。 */
  projectId?: string | null;
};

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
    <aside className="bg-panel border-border-strong flex h-full w-90 shrink-0 flex-col overflow-hidden border-l">
      {/* ── Header ── */}
      <div className="border-border-strong flex items-center gap-2 border-b px-4 py-3">
        <h2 className="text-ink-bright flex-1 text-[15px] font-semibold">历史记录</h2>
        {activeCount > 0 && (
          <Badge size="pill-sm" tone="primary">
            {activeCount} 进行中
          </Badge>
        )}
        <Hint accessibleName label="刷新">
          <Button
            className="text-ink-muted hover:bg-subtle hover:text-ink-soft rounded-md"
            onClick={refresh}
            size="icon-xs"
            variant="ghost"
          >
            <RefreshCw data-icon="inline-start" size={13} />
          </Button>
        </Hint>
        {/* 显示密度切换 —— 三处逐字相同的孪生对已收口到基元（ISSUE #1925）。 */}
        <DisplayDensityToggle onChange={setDisplay} value={display} />
        <Hint accessibleName label="关闭">
          <Button
            className="text-ink-muted hover:bg-subtle hover:text-ink-soft rounded-md"
            onClick={onClose}
            size="icon-xs"
            variant="ghost"
          >
            <X data-icon="inline-start" size={14} />
          </Button>
        </Hint>
      </div>

      {/* ── 作用域切换（仅在有项目时出现）──
          此前是手搓的 `<Button variant="ghost">` + 下划线三元：选中档给
          `border-b-2 border-accent`，**未选中档根本没有那条边框** —— 于是
          未选中的那一枚整体比选中的矮 2px，切来切去文字基线上下跳。这就是
          「一排里选一个」的又一处手搓（与上面类型筛选同一族）。
          改用 `ui/tabs` 的 `line` 档：它就是这一类「下划线页签」的全库实现，
          选中态由 `data-active` 驱动（字色 / 下划线两层），两枚同高同基线。 */}
      {projectId && (
        <Tabs
          className="gap-0"
          onValueChange={(value) => {
            /* SAFETY: 类型断言已复核 */
            setScope(value as HistoryScope);
          }}
          value={scope}
        >
          <TabsList
            className="border-border-strong h-auto w-full justify-start gap-4 rounded-none border-b px-4 pt-2"
            variant="line"
          >
            {[
              {
                /* SAFETY: 类型断言已复核 */
                id: "project" as HistoryScope,
                label: "本项目",
              },
              {
                /* SAFETY: 类型断言已复核 */
                id: "all" as HistoryScope,
                label: "全部",
              },
            ].map((scopeItem) => (
              <TabsTrigger
                className="h-auto flex-none rounded-none px-0 pb-2.5 text-sm font-medium"
                key={scopeItem.id}
                value={scopeItem.id}
              >
                {scopeItem.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {/* ── 类型筛选（pill）──
          此前是手搓的 `<Button variant="ghost">` + 选中分支：选中档只写了
          `bg-surface-2 text-ink-bright ring-border-strong`，字重与悬停都没钉
          —— 划过**已选中**的那一枚时，`ghost` 变体的 `hover:bg-muted` 会把它
          改成「未选中」的样子（用户原话「悬浮和非悬浮一个紫一个白」那一族，
          ISSUE #1423）。整排交给 `ui/select-chip`（「一排里选一个」的全库
          唯一实现，规范 16 §16.2.4）：选中态有底色 / 字色 / 描边 / 字重四层，
          且自带与常态同值的 `hover:`。语义也从 `aria-pressed` 回到
          `radiogroup` + `radio`（这一排本来就只能选一个）。 */}
      <div aria-label="按类型筛选生成记录" className="flex gap-1.5 px-4 py-3" role="radiogroup">
        {FILTER_TABS.map((filterTab) => (
          <SelectChip
            key={filterTab.id}
            onClick={() => {
              setFilter(filterTab.id);
            }}
            selected={filter === filterTab.id}
          >
            {filterTab.label}
          </SelectChip>
        ))}
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="border-destructive/30 bg-destructive/10 mx-4 mb-2 flex items-start gap-2 rounded-lg border px-3 py-2">
          <span className="text-destructive text-2xs min-w-0 flex-1 wrap-break-word">{error}</span>
          <Button
            className="text-destructive text-2xs h-auto shrink-0 underline hover:bg-transparent"
            onClick={refresh}
            variant="ghost"
          >
            重试
          </Button>
        </div>
      )}

      {/* ── Content ── */}
      <div className="min-w-0 flex-1 overflow-y-auto px-2 pb-4">
        {loading ? (
          <div className="flex-col gap-1 px-2 pt-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div className="flex items-center gap-3 py-2" key={`skeleton-${i}`}>
                <Skeleton className="bg-subtle size-10 shrink-0 rounded-md" />
                <div className="min-w-0 flex-1 flex-col gap-1.5">
                  <Skeleton className="bg-subtle h-3 w-3/4 rounded" />
                  <Skeleton className="bg-subtle h-2 w-1/3 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-ink-fainter text-xs">
              {scope === "project" ? "本项目还没有生成记录" : "暂无历史记录"}
            </p>
            {scope === "project" && globalCount !== null && globalCount > 0 && (
              <Button
                className="border-border-strong text-ink-soft hover:bg-subtle hover:text-ink-bright text-2xs mt-3 h-auto rounded-lg px-3 py-1.5"
                onClick={() => {
                  setScope("all");
                }}
                variant="outline"
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
              /* `task.cover` 收成局部变量：闭包（onClick）里 TS 不再保留
               * 外层 `task.cover && …` 的收窄，在原地补 `!` 等于把「上面判过」
               * 这件事写成注释。 */
              const cover = task.cover;
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
                        alt={titleOf(task)}
                        className="h-full w-full object-cover"
                        src={task.cover}
                      />
                    ) : (
                      <div
                        className={`flex size-12 items-center justify-center rounded-lg ${KIND_STYLE[task.mediaType]}`}
                      >
                        <KindIcon kind={task.mediaType} />
                      </div>
                    )}
                  </div>
                  {pill && (
                    <span
                      className={`text-4xs absolute top-1.5 left-1.5 rounded px-1.5 py-0.5 ${pill.cls}`}
                    >
                      {pill.label}
                    </span>
                  )}
                  <p className="text-ink-soft text-2xs truncate px-2 py-1.5">{titleOf(task)}</p>
                  {onUse && cover && (
                    <Hint accessibleName label="加入画布">
                      <Button
                        className="text-ink-soft absolute top-1 right-1 hidden rounded bg-black/70 group-hover:flex hover:bg-black/60 hover:text-white"
                        onClick={() => {
                          onUse({
                            id: task.id,
                            cover,
                            mediaType: task.mediaType,
                          });
                        }}
                        size="icon-xs"
                        variant="ghost"
                      >
                        <Plus data-icon="inline-start" size={12} strokeWidth={2.5} />
                      </Button>
                    </Hint>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* 列表视图 */
          <div className="flex flex-col gap-0.5">
            {tasks.map((task) => {
              const pill = STATUS_PILL[task.status];
              /* 同上方那份列表：闭包里不保留外层收窄，先收成局部变量。 */
              const cover = task.cover;
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
                    <div className="bg-canvas-deep size-10 shrink-0 overflow-hidden rounded-md">
                      <MediaThumbnail
                        alt={titleOf(task)}
                        className="h-full w-full object-cover"
                        src={task.cover}
                      />
                    </div>
                  ) : (
                    <div
                      className={`flex size-10 shrink-0 items-center justify-center rounded-md ${KIND_STYLE[task.mediaType]}`}
                    >
                      <KindIcon kind={task.mediaType} />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="text-ink-bright truncate text-sm">{titleOf(task)}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className="text-ink-fainter text-2xs">{timeAgo(task.createdAt)}</span>
                      {pill && (
                        <span className={`text-4xs rounded px-1.5 py-0.5 ${pill.cls}`}>
                          {pill.label}
                        </span>
                      )}
                      {task.status === "FAILED" && task.error && (
                        <span
                          className="text-destructive/80 text-3xs min-w-0 truncate"
                          title={task.error}
                        >
                          {task.error}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="hidden shrink-0 items-center gap-1 pr-1 group-hover:flex">
                    {onUse && cover && (
                      <Hint accessibleName label="加入画布">
                        <Button
                          className="text-ink-muted hover:bg-subtle hover:text-ink-bright rounded-md"
                          onClick={() => {
                            onUse({
                              id: task.id,
                              cover,
                              mediaType: task.mediaType,
                            });
                          }}
                          size="icon-sm"
                          variant="ghost"
                        >
                          <Plus data-icon="inline-start" size={13} strokeWidth={2.5} />
                        </Button>
                      </Hint>
                    )}
                    {task.cover && (
                      <a
                        className="text-ink-muted hover:bg-subtle hover:text-ink-bright flex size-7 items-center justify-center rounded-md transition-colors"
                        download
                        draggable={false}
                        href={task.cover}
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
