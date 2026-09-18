"use client";

import type { DragEventHandler } from "react";
import { AlertTriangle, Loader2, Search, Download } from "lucide-react";
import {
  deriveFormatFlags,
  deriveSyncFlags,
  isTechnicalName,
  type PendingRow,
  type WorkflowRow,
} from "./workflow-library-config";
import { TaskTypeChip } from "../ui/TaskTypeChip";
import { Button } from "~/components/ui/button";
import { deriveEncapsulationStatus } from "~/lib/workshop/workshop-encapsulation-status";
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
  /** 拖入 JSON 导入：整片列表侧栏就是投放区，这里接管高亮与投放事件
   *  （与导入面板共用同一个文件漏斗，见 useWorkflowImport）。 */
  dragActive?: boolean;
  onDragOver?: DragEventHandler<HTMLDivElement>;
  onDragEnter?: DragEventHandler<HTMLDivElement>;
  onDragLeave?: DragEventHandler<HTMLDivElement>;
  onDrop?: DragEventHandler<HTMLDivElement>;
  /** 文件入口（拖入）失败的可读原因。 */
  fileErr?: string | null;
  /** 单个待载入项的「载入中」标志（按 id 查表）：载入按钮据此禁用并改文案，
   *  避免重复点击把同一份磁盘文件重复载入。 */
  pendingLoading?: Record<string, boolean>;
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
  dragActive = false,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  fileErr = null,
  pendingLoading = {},
}: WorkflowLibraryListProps) {
  const empty = workflows.length === 0 && pendingRows.length === 0;
  return (
    <div
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={[
        "border-border-subtle bg-panel-deep flex h-full w-80 shrink-0 flex-col border-r",
        /* 拖入高亮用 outline：不参与布局，不会让列表在拖拽时抖一下。 */
        dragActive ? "outline-2 -outline-offset-2 outline-cyan-400/60" : "",
      ].join(" ")}
    >
      {/* 搜索栏 */}
      <div className="border-border-subtle border-b p-3">
        <div className="relative">
          <Search className="text-ink-fainter pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索工作流名称…"
            className="border-border bg-subtle text-ink-bright placeholder:text-ink-fainter focus:bg-subtle h-8 w-full rounded-lg border pr-3 pl-8 text-xs focus:border-violet-500/40 focus:outline-none"
          />
        </div>
      </div>

      {dragActive && (
        <p className="border-b border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-center text-[11px] text-cyan-700 dark:text-cyan-300">
          松开即可读取该工作流 JSON
        </p>
      )}
      {fileErr && (
        <p className="border-b border-red-500/25 bg-red-500/8 px-3 py-1.5 text-[11px] text-red-700 dark:text-red-300">
          ⚠ {fileErr}
        </p>
      )}

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
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                className="border-border text-muted-foreground hover:bg-subtle h-auto rounded-lg px-3 py-1 text-[11px]"
              >
                重试
              </Button>
            }
          />
        ) : empty ? (
          <EmptyState
            minHeightClass="min-h-[160px]"
            title={search ? "未找到匹配的工作流" : "还没有工作流"}
            description={
              search
                ? "换个关键词，或清空搜索框看全部。"
                : (localRootsHint ??
                  "点右上角「导入工作流」粘贴 JSON，或在设置里配置本地工作流目录后自动扫描。")
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
          <div className="mt-3 mb-3 rounded-xl border border-dashed border-cyan-500/25 bg-cyan-500/[0.04] p-2.5">
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-medium text-cyan-700 dark:text-cyan-300/80">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-400" />
              未载入的本地工作流
            </p>
            <ul className="space-y-1">
              {pendingRows.map((pending) => {
                const loadingPending = !!pendingLoading[pending.id];
                /* 整行不可点：点击即载入会被误触（只想看看名字 / 选中某一行的
                 * 用户会顺手点上去），因此载入动作只挂在右侧按钮上。 */
                return (
                  <li key={pending.id}>
                    <div className="border-border-subtle bg-subtle flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2">
                      <span
                        className="text-ink-strong truncate text-[11px]"
                        title={pending.name}
                      >
                        {pending.name}
                      </span>
                      <Button
                        variant="info"
                        onClick={() => onLoadPending?.(pending)}
                        disabled={loadingPending}
                        title={`载入「${pending.name}」`}
                        className="h-auto shrink-0 gap-1 rounded-md px-2 py-1 text-[10px] whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Download className="h-3 w-3" />
                        {loadingPending ? "载入中…" : "载入"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* 底部计数 */}
      <div className="border-border-subtle text-ink-fainter border-t px-3 py-2 text-[10px]">
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
  /* 对外参数封装状态（与生成链路同口径）：提示词口已有落点 = 工坊可直接驱动。 */
  const encapsulation = deriveEncapsulationStatus({
    io: workflow.workflowIO ?? null,
    paramMap: workflow.paramMap ?? null,
    mode: workflow.defaultMode ?? workflow.taskType ?? null,
  });

  return (
    <li>
      <Button
        variant="ghost"
        onClick={onClick}
        className={[
          "h-auto w-full rounded-lg border px-2 py-1.5 text-left font-normal hover:bg-transparent",
          selected
            ? "border-violet-500/40 bg-linear-to-br from-violet-500/15 to-fuchsia-500/10 shadow-[inset_0_0_0_1px_rgba(139,92,246,0.15)]"
            : "bg-subtle hover:border-border hover:bg-subtle border-transparent",
        ].join(" ")}
      >
        {/* 单行布局：名称 + 徽标同一行，降低每项高度 */}
        <div className="flex items-center gap-1.5">
          <span
            className={[
              "min-w-0 flex-1 truncate text-[12px] leading-tight font-medium",
              isTech ? "text-ink-strong font-mono" : "text-ink-bright",
            ].join(" ")}
            title={workflow.name}
          >
            {workflow.name}
          </span>
          {!usable && (
            <span
              title="既没有 API 图也没有工作流(RAW)原件 —— 两列都为空"
              className="shrink-0 rounded bg-red-500/12 px-1 py-px text-[9px] text-red-700 dark:text-red-300"
            >
              无可执行内容
            </span>
          )}
          {usable &&
            (encapsulation.ready ? (
              <span
                title={`对外参数已配置（${encapsulation.resolvedCount}/${encapsulation.entries.length}）`}
                className="shrink-0 rounded bg-emerald-500/12 px-1 py-px text-[9px] text-emerald-700 dark:text-emerald-300"
              >
                对外参数已配置
              </span>
            ) : (
              <span
                title={`未配置：${encapsulation.missingLabels.join("、") || "提示词口未落到端口"}`}
                className="shrink-0 rounded bg-amber-500/12 px-1 py-px text-[9px] text-amber-700 dark:text-amber-300"
              >
                对外参数未配置
              </span>
            ))}
          {canResync && (
            <span className="shrink-0 rounded bg-amber-500/12 px-1 py-px text-[9px] text-amber-700 dark:text-amber-300">
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
                className="border-border bg-subtle text-ink-faint max-w-[72px] truncate rounded-full border px-1.5 py-0.5 text-[9px]"
                title={tag}
              >
                {tag}
              </span>
            ))}
            {(workflow.modelTags?.length ?? 0) > 2 && (
              <span className="text-ink-fainter shrink-0 text-[9px]">
                +{(workflow.modelTags?.length ?? 0) - 2}
              </span>
            )}
          </div>
        )}
      </Button>
    </li>
  );
}
