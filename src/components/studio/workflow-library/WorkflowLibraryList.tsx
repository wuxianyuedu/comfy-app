"use client";

import { AlertTriangle, Loader2, Search, Download } from "lucide-react";
import {
  deriveFormatFlags,
  deriveSyncFlags,
  isTechnicalName,
  type PendingRow,
  type WorkflowRow,
} from "./workflow-library-config";
import { TaskTypeChip } from "../ui/TaskTypeChip";
import { SourceTag } from "../ui/SourceTag";
import { EmptyState } from "../ui/EmptyState";

interface WorkflowLibraryListProps {
  workflows: WorkflowRow[];
  pendingRows?: PendingRow[];
  selectedId?: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (id: string) => void;
  onLoadPending?: (pending: PendingRow) => void;
  /** 列表仍在拉取中；此时「一条都没有」不代表「没有工作流」。 */
  loading?: boolean;
  /** 拉取超过预期时长仍未返回（服务在响应但查询没回来）。 */
  stalled?: boolean;
  /** 重试拉取（超时提示里的动作）。 */
  onRefresh?: () => void;
  /** 本地工作流目录侧的可读原因（没解析到根 / 根不可访问 / 目录里没有文件）；
   *  非空时用它替换默认空态文案，说明「为什么是空」。 */
  localRootsHint?: string | null;
}

/**
 * 左侧工作流列表：搜索 + 可滚动条目。选中项高亮，右侧详情面板联动。
 *
 * 三态必须可区分（规范 10.5：空态要说清「为什么是空的」）：
 *   加载中 / 数据没回来 → 进度提示，绝不渲染成「未找到匹配的工作流」；
 *   拉取超时 → 提示「仍在加载」并说明可以做什么，不假装是空库；
 *   确实没有（且未筛选）→ 指引导入或配置本地目录。
 */
export function WorkflowLibraryList({
  workflows,
  pendingRows = [],
  selectedId,
  search,
  onSearchChange,
  onSelect,
  onLoadPending,
  loading = false,
  stalled = false,
  onRefresh,
  localRootsHint = null,
}: WorkflowLibraryListProps) {
  const empty = workflows.length === 0 && pendingRows.length === 0;
  return (
    <div className="flex h-full w-80 flex-col border-r border-(--color-border-subtle) bg-(--color-panel-deep)">
      {/* 搜索栏 */}
      <div className="border-b border-(--color-border-subtle) p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-(--color-ink-fainter)" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索工作流名称…"
            className="h-8 w-full rounded-lg border border-(--color-border) bg-(--color-subtle) pr-3 pl-8 text-xs text-(--color-ink-bright) placeholder:text-(--color-ink-fainter) focus:border-violet-500/40 focus:bg-(--color-subtle) focus:outline-none"
          />
        </div>
      </div>

      {/* 列表：已载入工作流排在前 */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1.5">
        {empty && loading ? (
          <EmptyState
            minHeightClass="min-h-[160px]"
            title="正在加载工作流…"
            description="本地目录会一起扫描，文件多时首次载入需要几秒。"
            icon={Loader2}
            className="[&_svg]:animate-spin"
          />
        ) : empty && stalled ? (
          <EmptyState
            minHeightClass="min-h-[160px]"
            tone="warning"
            icon={AlertTriangle}
            title="工作流列表还没返回"
            description={
              <>
                应用服务可能在编译或重启。可稍候重试；若持续如此，按{" "}
                <kbd className="border-border rounded border px-1 font-mono">
                  Ctrl+Shift+L
                </kbd>{" "}
                打开日志面板查看具体原因。
              </>
            }
            action={
              <button
                type="button"
                onClick={onRefresh}
                className="border-border text-muted-foreground hover:bg-subtle rounded-lg border px-3 py-1 text-[11px]"
              >
                重试
              </button>
            }
          />
        ) : empty ? (
          <EmptyState
            minHeightClass="min-h-[160px]"
            title={search ? "未找到匹配的工作流" : "还没有工作流"}
            description={
              search
                ? "换个关键词，或清空搜索框看全部。"
                : localRootsHint ??
                  "点右上角「导入工作流」粘贴 JSON，或在设置里配置本地工作流目录后自动扫描。"
            }
          />
        ) : (
          <ul className="space-y-1">
            {workflows.map((workflow) => (
              <WorkflowListItem
                key={workflow.id}
                workflow={workflow}
                selected={selectedId === workflow.id}
                onClick={() => onSelect(workflow.id)}
              />
            ))}
          </ul>
        )}

        {/* 未载入的本地工作流排在已载入之后 */}
        {pendingRows.length > 0 && (
          <div className="mb-3 mt-3 rounded-xl border border-dashed border-cyan-500/25 bg-cyan-500/[0.04] p-2.5">
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-medium text-cyan-600/80">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-400" />
              未载入的本地工作流
            </p>
            <ul className="space-y-1">
              {pendingRows.map((pending) => (
                <li key={pending.id}>
                  <button
                    type="button"
                    onClick={() => onLoadPending?.(pending)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-(--color-border-subtle) bg-(--color-subtle) px-2.5 py-2 text-left transition-colors hover:border-cyan-500/30 hover:bg-cyan-500/10"
                  >
                    <span
                      className="truncate text-[11px] text-(--color-ink-strong)"
                      title={pending.name}
                    >
                      {pending.name}
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px] text-cyan-600">
                      <Download className="h-3 w-3" />
                      载入
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 底部计数 */}
      <div className="border-t border-(--color-border-subtle) px-3 py-2 text-[10px] text-(--color-ink-fainter)">
        共 {workflows.length + pendingRows.length} 个工作流
        {pendingRows.length > 0 ? `（${pendingRows.length} 个未载入）` : ""}
      </div>
    </div>
  );
}

function WorkflowListItem({
  workflow,
  selected,
  onClick,
}: {
  workflow: WorkflowRow;
  selected: boolean;
  onClick: () => void;
}) {
  const { usable } = deriveFormatFlags(workflow);
  const { missing, canResync } = deriveSyncFlags(workflow);
  const isTech = isTechnicalName(workflow.name);

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={[
          "w-full rounded-lg border px-2 py-1.5 text-left transition-all",
          selected
            ? "border-violet-500/40 bg-linear-to-br from-violet-500/15 to-fuchsia-500/10 shadow-[inset_0_0_0_1px_rgba(139,92,246,0.15)]"
            : "border-transparent bg-(--color-subtle) hover:border-(--color-border) hover:bg-(--color-subtle)",
        ].join(" ")}
      >
        {/* 单行布局：名称 + 徽标同一行，降低每项高度 */}
        <div className="flex items-center gap-1.5">
          <span
            className={[
              "min-w-0 flex-1 truncate text-[12px] leading-tight font-medium",
              isTech ? "font-mono text-(--color-ink-strong)" : "text-(--color-ink-bright)",
            ].join(" ")}
            title={workflow.name}
          >
            {workflow.name}
          </span>
          {!usable && (
            <span className="shrink-0 rounded bg-red-500/12 px-1 py-px text-[9px] text-red-600">
              不可执行
            </span>
          )}
          {canResync && (
            <span className="shrink-0 rounded bg-amber-500/12 px-1 py-px text-[9px] text-amber-600">
              {missing ? "已丢失" : "有更新"}
            </span>
          )}
          <span className="shrink-0">
            <SourceTag source={workflow.source} />
          </span>
        </div>

        {(workflow.taskType || (workflow.modelTags?.length ?? 0) > 0) && (
          <div className="mt-1 flex items-center gap-1.5">
            <TaskTypeChip taskType={workflow.taskType} />
            {workflow.modelTags?.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="max-w-[72px] truncate rounded-full border border-(--color-border) bg-(--color-subtle) px-1.5 py-0.5 text-[9px] text-(--color-ink-faint)"
                title={tag}
              >
                {tag}
              </span>
            ))}
            {(workflow.modelTags?.length ?? 0) > 2 && (
              <span className="shrink-0 text-[9px] text-(--color-ink-fainter)">
                +{(workflow.modelTags?.length ?? 0) - 2}
              </span>
            )}
          </div>
        )}
      </button>
    </li>
  );
}
