"use client";

/**
 * WorkflowLibrary 的共享展示组件（规范 17 §17.2 第③层）。
 *
 * 2026-09-04：类型与纯派生已抽到 `workflow-library-config.ts`，本文件只留
 * JSX 组件（IO 缩略图 / 根目录分组头 / 过滤页签 / 待载入卡片 / 列表容器）。
 * 组件一律纯 props 驱动，事件上抛，不发请求。
 *
 * 顺带删除了 `LibrarySourceModal`：2026-08-25（#45）详情面板改用统一
 * `SourceModal` 后它就再无消费方，却是本文件唯一的 tRPC 查询点——留着会
 * 让棘轮一直记一笔「视图内发请求」。
 */

import React, { useMemo } from "react";
import { Icon } from "@/components/ui/icon";
import { splitWorkflowIO, ioLabel } from "@/components/studio/shared/workflow-io";
import type { WorkflowIOMap } from "@/components/studio/shared/workflow-io";

import type { WorkflowRow } from "./workflow-library-config";

/* ── WorkflowIOThumb ──
 * When a workflow row has no graph preview (no API graph or no preview-built
 * fixtures) but DOES have user-curated IO, render the inputs/outputs as a
 * tiny "input chips → output chips" strip so the library card honestly
 * shows what the workflow accepts and produces.  Mirrors the colour
 * palette of `DynamicWorkflowForm`. */
export function WorkflowIOThumb({ io }: { io: WorkflowIOMap | null | undefined }) {
  const { inputs, outputs } = useMemo(
    () => splitWorkflowIO(io ?? null),
    [io],
  );
  if (!io || (inputs.length === 0 && outputs.length === 0)) return null;
  /* Cap to keep the card legible; show "+N more" when truncated. */
  const MAX = 4;
  const hiddenIn = Math.max(0, inputs.length - MAX);
  const hiddenOut = Math.max(0, outputs.length - MAX);
  /* Pass the full IO map so two entries that resolve to
   *  the same display label fall back to `name` and stay visually
   *  distinguishable on the card. */
  const conflictList = [...inputs, ...outputs];
  return (
    <div className="flex w-full items-center gap-2 px-3 py-1.5">
      <div className="flex min-w-0 max-w-[44%] flex-wrap items-center justify-end gap-1">
        {inputs.slice(0, MAX).map((entry) => (
          <span
            key={entry.ioKey}
            className="inline-flex max-w-full items-center gap-1 truncate rounded-md bg-(--color-info)/10 px-1.5 py-0.5 text-[10px] text-(--color-info)"
            title={`${entry.nodeTitle ?? ""} · ${entry.name}`}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--color-info)" />
            <span className="truncate">{ioLabel(entry, conflictList)}</span>
          </span>
        ))}
        {hiddenIn > 0 && (
          <span className="text-[10px] text-gray-500">+{hiddenIn}</span>
        )}
      </div>
      <div className="flex h-3 flex-1 items-center">
        <div className="h-px w-full bg-linear-to-r from-(--color-info)/40 via-white/20 to-(--color-success-strong)/40" />
      </div>
      <div className="flex min-w-0 max-w-[44%] flex-wrap items-center justify-start gap-1">
        {outputs.slice(0, MAX).map((entry) => (
          <span
            key={entry.ioKey}
            className="inline-flex max-w-full items-center gap-1 truncate rounded-md bg-(--color-success)/10 px-1.5 py-0.5 text-[10px] text-(--color-success)"
            title={`${entry.nodeTitle ?? ""} · ${entry.name}`}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--color-success)" />
            <span className="truncate">{ioLabel(entry, conflictList)}</span>
          </span>
        ))}
        {hiddenOut > 0 && (
          <span className="text-[10px] text-gray-500">+{hiddenOut}</span>
        )}
      </div>
    </div>
  );
}

/** Collapsible group header for one LOCAL_WORKFLOWS_PATH root.
 *  The whole row is the click target (button), caret rotates on toggle, and
 *  the count chip tells the user how many cards are hidden.  When a root
 *  is missing on disk (`exists === false`) we add an amber dot and replace
 *  the count with "目录不存在" so the user understands why no cards showed
 *  up under that header. */
export function RootGroupHeader({
  rawPath,
  count,
  exists,
  error,
  collapsed,
  onToggle,
}: {
  rawPath: string | null;          // null = orphan bucket
  count: number;
  exists?: boolean;
  error?: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  const display = rawPath ? rawPath : "未分组（来源目录已不在配置中）";
  // 不再 JS 硬切前 26 字符（之前 `…` + slice(-54) 会砍掉 `D:\…` 前缀）。
  // 父容器 `flex-1 min-w-0` + 子元素 `truncate` 已按可视宽度自动 ellipsis，
  // 保留最有判别力的 `D:\…` 前缀；只有超宽时末端才出省略号。`title` hover 仍看全路径。
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="group/root flex w-full items-center gap-2.5 rounded-xl border border-white/6 bg-white/2 px-3 py-2 text-left transition-colors hover:border-cyan-400/30 hover:bg-white/4"
    >
      <span
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold transition-transform ${
          collapsed ? "" : "rotate-90"
        } bg-white/6 text-gray-300`}
        aria-hidden
      >
        ▶
      </span>
      <span className="text-[15px]" aria-hidden>
        📁
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={`truncate font-mono text-[12px] ${
            rawPath ? "text-gray-200" : "text-amber-300"
          }`}
          title={display}
        >
          {display}
        </span>
        {rawPath && (
          <span
            className={`mt-0.5 inline-flex items-center gap-1 text-[10px] ${
              error
                ? "text-red-400"
                : exists === false
                  ? "text-amber-300"
                  : "text-gray-500"
            }`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                error
                  ? "bg-red-400"
                  : exists === false
                    ? "bg-amber-400"
                    : "bg-emerald-400"
              }`}
 
            />
            {typeof error === "string" && error.length > 0
              ? error
              : exists === false
                ? "目录不存在"
                : `只读扫描 · 找到 ${count} 个文件`}
          </span>
        )}
      </span>
      <span
        className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${
          collapsed
            ? "bg-white/5 text-gray-400"
            : "bg-cyan-500/15 text-cyan-300"
        }`}
        title={collapsed ? "已折叠，点击展开" : "已展开，点击折叠"}
      >
        {collapsed ? `▸ ${count}` : `▼ ${count}`}
      </span>
    </button>
  );
}

/* 移除了 per-category chip helper（TYPE_COLOR / getTypeView / TASK_TYPE_OPTIONS /
 * TASK_TYPE_LABELS）：library card 现改用 MultiModeSelect（其内部按 mode 的 category
 * 派生 accent）。保留 getWorkflowType / normalizeTaskType 的 import——下方 useMemo
 * 过滤仍用到。 */

/** Extracted from WorkflowLibrary.renderWorkflowCard's
 *  "local-pending" branch. Self-contained: only needs the row plus an
 *  isLoading flag and the load callback. */
export function PendingWorkflowCard({
  w,
  isLoading,
  onLoad,
}: {
  w: WorkflowRow & { pendingSize?: number };
  isLoading: boolean;
  onLoad: () => void;
}) {
  return (
    <div
      key={w.id}
      className="group flex flex-col rounded-2xl border border-dashed border-cyan-400/25 bg-white/1.5 p-4"
    >
      <h3
        className="break-words text-sm font-semibold leading-snug text-gray-100"
        title={w.name}
      >
        {w.name}
      </h3>
      <p className="mt-0.5 text-[10.5px] text-cyan-300/80">
        未载入 ·{" "}
        {w.pendingSize ? `${(w.pendingSize / 1024).toFixed(1)} KB` : ""}
      </p>
      <button
        type="button"
        disabled={isLoading}
        onClick={onLoad}
        className="mt-3 w-full rounded-lg bg-cyan-500/90 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
        title="将该文件导入到数据库，之后会自动跟踪文件改动"
      >
        {isLoading ? "载入中…" : "⤓ 载入"}
      </button>
      <p
        className="mt-1.5 break-all font-mono text-[10px] leading-snug text-gray-500"
        title={w.sourcePath ?? undefined}
      >
        {w.sourcePath}
      </p>
    </div>
  );
}

/** Generic pill filter tabs，从 WorkflowLibrary 的 source/type 过滤行抽出（相同标记，不同 accent）。
 *  source/type filter rows (identical markup, different accent). */
export function FilterTabs<T extends string>({
  tabs,
  active,
  onChange,
  accent,
  trailing,
}: {
  tabs: readonly { key: T; label: string; count: number }[];
  active: T;
  onChange: (key: T) => void;
  accent: "violet" | "sky" | "fuchsia";
  trailing?: React.ReactNode;
}) {
  const activeCls =
    accent === "violet"
      ? "border-violet-500/60 bg-violet-500/15 text-violet-200"
      : accent === "sky"
        ? "border-sky-500/60 bg-sky-500/15 text-sky-200"
        : "border-fuchsia-500/60 bg-fuchsia-500/15 text-fuchsia-200";
  const badgeCls =
    accent === "violet"
      ? "bg-violet-500/30 text-violet-100"
      : accent === "sky"
        ? "bg-sky-500/30 text-sky-100"
        : "bg-fuchsia-500/30 text-fuchsia-100";
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {tabs.map((tab) =>
{
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
              isActive
                ? activeCls
                : "border-white/8 bg-white/2 text-gray-400 hover:border-white/20 hover:text-gray-200"
            }`}
          >
            {tab.label}
            <span
              className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                isActive ? badgeCls : "bg-white/10 text-gray-400"
              }`}
            >
              {tab.count}
            </span>
          </button>
        );
      })}
      {trailing}
    </div>
  );
}

/** 从 WorkflowLibrary 的列表容器抽出（drop banner + 分组/平铺列表渲染）。所有拖放 handler、过滤器、卡片渲染器都作 props 传入。
 *  (drop banner + grouped/plain list rendering).  All drag-drop handlers,
 *  filters and card renderer are passed in as props. */
export interface WorkflowRowGroup<TRow = WorkflowRow> {
  key: string;
  rawPath: string | null;
  rows: TRow[];
  meta?: { exists?: boolean; error?: string };
}

export function WorkflowListBody<TRow extends { id: string } = WorkflowRow>({
  loading,
  filtered,
  sourceFilter,
  groupedByRoot,
  collapsedRoots,
  expandAllRoots,
  toggleRoot,
  renderCard,
  onListDragEnter,
  onListDragOver,
  onListDragLeave,
  onListDrop,
  dropErr,
  setDropErr,
  dragActive,
}: {
  loading: boolean;
  filtered: TRow[];
  sourceFilter: string;
  groupedByRoot: WorkflowRowGroup<TRow>[];
  collapsedRoots: Record<string, boolean>;
  expandAllRoots: () => void;
  toggleRoot: (key: string) => void;
  renderCard: (w: TRow) => React.ReactNode;
  onListDragEnter: React.DragEventHandler;
  onListDragOver: React.DragEventHandler;
  onListDragLeave: React.DragEventHandler;
  onListDrop: React.DragEventHandler;
  dropErr: string | null;
  setDropErr: (err: string | null) => void;
  dragActive: boolean;
}) {
  return (
    <div
      className="relative"
      onDragEnter={onListDragEnter}
      onDragOver={onListDragOver}
      onDragLeave={onListDragLeave}
      onDrop={onListDrop}
    >
      {dropErr && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/8 px-3 py-2 text-sm text-red-200">
          <span className="font-semibold">⚠</span>
          <span>{dropErr}</span>
          <button
            type="button"
            className="ml-auto text-xs text-red-300/70 hover:text-red-100"
            onClick={() => setDropErr(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* 紧凑的 drop 提示，替代原先的全屏 overlay */}
      {(!loading || filtered.length > 0) && (
        <div
          className={`mb-3 flex items-center gap-3 rounded-xl border border-dashed px-4 py-2.5 transition-colors ${
            dragActive
              ? "border-cyan-400/80 bg-cyan-500/8 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.12)]"
              : "border-white/8 bg-white/2 hover:border-white/16"
          }`}
        >
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              dragActive ? "bg-cyan-500/15 text-cyan-300" : "bg-white/4 text-gray-500"
            }`}
          >
            <Icon name="upload" size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div
              className={`truncate text-sm font-medium ${dragActive ? "text-cyan-100" : "text-gray-300"}`}
            >
              {dragActive ? "松开鼠标即可导入工作流" : "把工作流 JSON 拖到这里快速导入"}
            </div>
            <div
              className={`truncate text-[11px] ${dragActive ? "text-cyan-200/70" : "text-gray-500"}`}
            >
              {dragActive
                ? "支持 ComfyUI 导出（API 格式）/（工作流格式）· 单文件 ≤ 5 MB"
                : "或点击右上角「导入工作流」粘贴 JSON"}
            </div>
          </div>
        </div>
      )}
      {loading && filtered.length === 0 ? (
        <div className="grid min-h-[220px] place-items-center rounded-2xl text-gray-400">
          <div className="flex flex-col items-center gap-3">
            <Icon
              name="loader"
              size={44}
              className="animate-spin text-cyan-300/90"
            />
            <span className="text-sm text-gray-400">加载中…</span>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="grid min-h-[220px] place-items-center rounded-2xl border border-dashed border-white/8 text-gray-500">
          <div className="text-center">
            <Icon name="files" size={32} className="mx-auto mb-2 text-violet-300/70" />
            <p className="text-base font-medium text-gray-300">暂无工作流</p>
            <p className="mt-1 text-xs">
              配置本地工作流目录后会显示 ⤓ 未载入 卡片；或向上拖入 JSON 导入。
            </p>
          </div>
        </div>
      ) : sourceFilter === "local" && groupedByRoot.length > 0 ? (
      // 本地 tab 按配置目录分组：每个 LOCAL_WORKFLOWS_PATH 条目变成一个
      // RootGroupHeader（caret + 📁 + verbatim path + status），其折叠状态
      // 仅在本页面会话内有效。折叠组只显示 header（无子项）；展开组在
      // section 内嵌 3 列网格（带缩进），明确每张卡片属于哪个目录。
      <div className="space-y-6">
        {groupedByRoot.length > 1 && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-500">
              已配置 {groupedByRoot.length} 个目录 · 共{" "}
              {groupedByRoot.reduce((total, bucket) => total + bucket.rows.length, 0)} 个工作流
            </span>
            {Object.values(collapsedRoots).some(Boolean) && (
              <button
                type="button"
                onClick={expandAllRoots}
                className="text-[11px] text-gray-400 transition-colors hover:text-cyan-300"
              >
                全部展开
              </button>
            )}
          </div>
        )}
        {groupedByRoot.map((groupedByRoot) =>
{
          const isCollapsed = !!collapsedRoots[groupedByRoot.key];
          return (
            <section key={groupedByRoot.key} className="space-y-3">
              <RootGroupHeader
                rawPath={groupedByRoot.rawPath}
                count={groupedByRoot.rows.length}
                exists={groupedByRoot.meta?.exists}
                error={groupedByRoot.meta?.error}
                collapsed={isCollapsed}
                onToggle={() => toggleRoot(groupedByRoot.key)}
              />
              {!isCollapsed && (
                <div className="grid grid-cols-1 gap-3 pl-3 sm:grid-cols-2 lg:grid-cols-3">
                  {groupedByRoot.rows.map((workflow) => (
                    <React.Fragment key={workflow.id}>{renderCard(workflow)}</React.Fragment>
                  ))}
                </div>
              )}
            </section>
          );
            })}
      </div>
    ) : (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((filtered) =>
(
          <React.Fragment key={filtered.id}>{renderCard(filtered)}</React.Fragment>
        ))}
      </div>
    )}
    </div>
  );
}
