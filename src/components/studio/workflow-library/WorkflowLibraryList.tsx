"use client";

import { Search, Download } from "lucide-react";
import {
  deriveFormatFlags,
  deriveSyncFlags,
  isTechnicalName,
  type PendingRow,
  type WorkflowRow,
} from "./workflow-library-config";
import { TaskTypeChip } from "../ui/TaskTypeChip";
import { SourceTag } from "../ui/SourceTag";

interface WorkflowLibraryListProps {
  workflows: WorkflowRow[];
  pendingRows?: PendingRow[];
  selectedId?: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (id: string) => void;
  onLoadPending?: (pending: PendingRow) => void;
}

/**
 * 左侧工作流列表：搜索 + 可滚动条目。选中项高亮，右侧详情面板联动。
 */
export function WorkflowLibraryList({
  workflows,
  pendingRows = [],
  selectedId,
  search,
  onSearchChange,
  onSelect,
  onLoadPending,
}: WorkflowLibraryListProps) {
  return (
    <div className="flex h-full w-80 flex-col border-r border-white/6 bg-[#0B0B10]">
      {/* 搜索栏 */}
      <div className="border-b border-white/6 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索工作流名称…"
            className="h-8 w-full rounded-lg border border-white/8 bg-white/[0.03] pr-3 pl-8 text-xs text-white/90 placeholder:text-white/25 focus:border-violet-500/40 focus:bg-white/[0.05] focus:outline-none"
          />
        </div>
      </div>

      {/* 列表：已载入工作流排在前 */}
      <div className="flex-1 overflow-y-auto p-2">
        {workflows.length === 0 && pendingRows.length === 0 ? (
          <div className="py-10 text-center text-xs text-white/35">
            未找到匹配的工作流
          </div>
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
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-medium text-cyan-300/80">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-400" />
              未载入的本地工作流
            </p>
            <ul className="space-y-1">
              {pendingRows.map((pending) => (
                <li key={pending.id}>
                  <button
                    type="button"
                    onClick={() => onLoadPending?.(pending)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/6 bg-white/[0.03] px-2.5 py-2 text-left transition-colors hover:border-cyan-500/30 hover:bg-cyan-500/10"
                  >
                    <span
                      className="truncate text-[11px] text-white/75"
                      title={pending.name}
                    >
                      {pending.name}
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px] text-cyan-300">
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
      <div className="border-t border-white/6 px-3 py-2 text-[10px] text-white/30">
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
          "w-full rounded-lg border p-2.5 text-left transition-all",
          selected
            ? "border-violet-500/40 bg-linear-to-br from-violet-500/15 to-fuchsia-500/10 shadow-[inset_0_0_0_1px_rgba(139,92,246,0.15)]"
            : "border-transparent bg-white/[0.02] hover:border-white/8 hover:bg-white/[0.05]",
        ].join(" ")}
      >
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <span
            className={[
              "min-w-0 flex-1 truncate text-[12px] leading-tight font-medium",
              isTech ? "font-mono text-white/70" : "text-white/90",
            ].join(" ")}
            title={workflow.name}
          >
            {workflow.name}
          </span>
          <span className="ml-auto flex w-fit shrink-0">
            <SourceTag source={workflow.source} />
          </span>
        </div>

        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <TaskTypeChip taskType={workflow.taskType} />
          {workflow.modelTags?.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-white/8 bg-white/[0.04] px-1.5 py-0.5 text-[9px] text-white/55"
            >
              {tag}
            </span>
          ))}
          {(workflow.modelTags?.length ?? 0) > 2 && (
            <span className="text-[9px] text-white/35">
              +{(workflow.modelTags?.length ?? 0) - 2}
            </span>
          )}
        </div>

        <div className="flex items-center justify-end gap-1.5">
          {!usable && (
            <span className="rounded bg-red-500/12 px-1 py-px text-[9px] text-red-300">
              不可执行
            </span>
          )}
          {canResync && (
            <span className="rounded bg-amber-500/12 px-1 py-px text-[9px] text-amber-300">
              {missing ? "已丢失" : "有更新"}
            </span>
          )}
        </div>
      </button>
    </li>
  );
}
