"use client";
/* Extracted from wf-editor-inner.tsx (P4 refactor).  The editor's top bar:
 * breadcrumb, stats, RAW/API view switch, IO toggles, JSON viewer, reset
 * and save buttons.  IO-related state is read straight from the Zustand
 * IOEditStore (getIOEditApi / useIOEditStore) — same pattern as
 * WorkflowEditorBody — so only workflow/view/nav props are threaded in. */
import React, { useCallback } from "react";
import type { WorkflowDetail } from "./workflow-types";
import { useToast } from "@/components/studio/toast-provider";
import { isNoteType } from "./workflow-utils";
import { useDebugStore } from "./debug-store";
import {
  getIOEditApi,
  useIOEditStore,
  selectIoEditMode,
  selectWorkflowIO,
  selectIoPreviewOpen,
} from "./workflow-stores";

export interface WorkflowEditorTopBarProps {
  onClose: () => void;
  detail: WorkflowDetail;
  rootWorkflowName: string;
  subgraphStack: { uid: string; name: string }[];
  setSubgraphStack: React.Dispatch<React.SetStateAction<{ uid: string; name: string }[]>>;
  fetchDetail: (opts?: { subgraphUid?: string; parentTitle?: string; bust?: boolean }) => Promise<void>;
  onExitSubgraph: () => void;
  forceReloadDetail: () => void;
  viewMode: "raw" | "api";
  setViewMode: React.Dispatch<React.SetStateAction<"raw" | "api">>;
  setApiLayoutOverrides: React.Dispatch<React.SetStateAction<Record<string, [number, number]>>>;
  setViewJsonOpen: React.Dispatch<React.SetStateAction<boolean>>;
  resetLayout: () => void;
  handleSave: () => void;
  saving: boolean;
  error: string;
}

export function WorkflowEditorTopBar({
  onClose,
  detail,
  rootWorkflowName,
  subgraphStack,
  setSubgraphStack,
  fetchDetail,
  onExitSubgraph,
  forceReloadDetail,
  viewMode,
  setViewMode,
  setApiLayoutOverrides,
  setViewJsonOpen,
  resetLayout,
  handleSave,
  saving,
  error,
}: WorkflowEditorTopBarProps) {
  const ioApi = getIOEditApi();
  const workflowIO = useIOEditStore(selectWorkflowIO);
  const ioEditMode = useIOEditStore(selectIoEditMode);
  const ioPreviewOpen = useIOEditStore(selectIoPreviewOpen);
  const debugMode = useDebugStore((state) => state.debugMode);
  const toggleDebugMode = useDebugStore((state) => state.toggleDebugMode);
  const setIoEditMode = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) =>
      ioApi.setState((state) => ({ ioEditMode: typeof v === "function" ? v(state.ioEditMode) : v })),
    [ioApi]
  );
  const setIoPreviewOpen = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) =>
      ioApi.setState((state) => ({ ioPreviewOpen: typeof v === "function" ? v(state.ioPreviewOpen) : v })),
    [ioApi]
  );
  const toast = useToast();

  return (
      <header className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-4 py-3 backdrop-blur-md" style={{ background: "rgba(10,10,15,0.85)" }}>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-white/10 hover:text-gray-300"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <div className="flex flex-col">
            {/* Breadcrumb: root workflow name · subgraph 1 · subgraph 2 …
             *  The leading crumb is always the **root** workflow's display
             *  name (captured on first top-level fetch and preserved across
             *  subgraph navigation), so drilling into a subgraph never
             *  rewrites the leading crumb to the subgraph's own name.
             *  Clicking the root crumb jumps back to top level.  Each
             *  intermediate subgraph crumb is a clickable button that
             *  drills back to that level.  The LAST crumb (the subgraph
             *  the user is currently inside) is rendered as a non-
             *  interactive span with a violet selection box — clicking
             *  it does NOT re-enter the same subgraph (which used to
             *  stack another layer in `subgraphStack` and was confusing).
             *  Truncation uses `max-w` + `truncate` so an over-long name
             *  collapses to ellipsis; the full name stays accessible via
             *  the `title` attribute (browser native tooltip). */}
            <div className="flex items-center gap-1.5 text-[12px]">
              <button
                type="button"
                onClick={() => {
                  if (subgraphStack.length > 0) {
                    setSubgraphStack([]);
                    void fetchDetail();
                  }
                }}
                className="truncate font-title text-[18px] font-bold leading-tight tracking-tight transition-colors hover:text-violet-300"
                style={{ color: "#F4F4F8", textShadow: "0 1px 0 rgba(0,0,0,0.4)", maxWidth: 280 }}
                title={
                  subgraphStack.length
                    ? `${rootWorkflowName || detail.name}（返回顶层工作流）`
                    : rootWorkflowName || detail.name
                }
              >
                {rootWorkflowName || detail.name}
              </button>
              {subgraphStack.map((crumb, i) => {
                const isLast = i === subgraphStack.length - 1;
                /* Common truncation styling for every crumb. */
                const baseCls =
                  "max-w-[260px] truncate text-[14px] font-medium transition-colors";
                if (isLast) {
                  /* Current subgraph: non-clickable span with a violet
                   *  selection pill so it's visually pinned as the
                   *  "here" marker.  No button = no accidental
                   *  re-entry that used to push a phantom layer onto
                   *  `subgraphStack`. */
                  return (
                    <React.Fragment key={crumb.uid + i}>
                      <span className="text-[14px] text-gray-600">/</span>
                      <span
                        className={`${baseCls} rounded-md border border-violet-500/40 bg-violet-500/15 px-2 py-0.5 text-violet-100`}
                        style={{ cursor: "default" }}
                        title={crumb.name}
                      >
                        {crumb.name}
                      </span>
                    </React.Fragment>
                  );
                }
                /* Intermediate subgraph (i < last): clickable button that
                 *  drills back to that level (truncates the stack at i+1
                 *  and re-fetches that subgraph's data). */
                return (
                  <React.Fragment key={crumb.uid + i}>
                    <span className="text-[14px] text-gray-600">/</span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = subgraphStack.slice(0, i + 1);
                        setSubgraphStack(next);
                        void fetchDetail({ subgraphUid: crumb.uid, parentTitle: crumb.name });
                      }}
                      className={`${baseCls} rounded-md px-1.5 py-0.5 text-gray-400 hover:bg-white/5 hover:text-violet-200`}
                      title={`${crumb.name}（跳到此层）`}
                    >
                      {crumb.name}
                    </button>
                  </React.Fragment>
                );
              })}
              {subgraphStack.length > 0 && (
                <button
                  type="button"
                  onClick={onExitSubgraph}
                  className="ml-2 inline-flex items-center gap-1 rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-200 transition-colors hover:bg-violet-500/20"
                  title="返回上一级"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 12H5M12 19l-7-7 7-7"/>
                  </svg>
                  返回上一级
                </button>
              )}
              {/* 2026-08-06 R3 终极方案 #4：🔄 一键强制重载缓存.
               *   - 清 sessionStorage + 跳过 server LRU + 重置 in-flight req
               *   - 任何 R3 之前的旧缓存条目都不会被读到，因为入口扫描删了
               *   - 任何之后人为改了 route.ts 没同步 SCHEMA_FINGERPRINT 的，
               *     schema 不匹配会直接导致 cacheKey 不命中，走冷路径 */}
              <button
                type="button"
                onClick={forceReloadDetail}
                className="ml-1 inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-200 transition-colors hover:bg-rose-500/20"
                title="强制重载（清 sessionStorage + 跳过 server LRU + 重拉数据）"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-3-6.7L21 8"/>
                  <polyline points="21 3 21 8 16 8"/>
                </svg>
                强制重载
              </button>
            </div>
            <p className="mt-0.5 text-[11px] font-medium text-gray-400">
              {detail.nodes.filter((node) => !isNoteType(node.class_type)).length} 个节点
              <span className="mx-1.5 text-gray-600">·</span>
              {Object.keys(workflowIO).length} 个暴露 IO
              <span className="mx-1.5 text-gray-600">·</span>
              {(detail.notes?.length ?? 0)} 个注释
              <span className="mx-1.5 text-gray-600">·</span>
              {(detail.groups?.length ?? 0)} 个分组
              {subgraphStack.length > 0 && (
                <>
                  <span className="mx-1.5 text-gray-600">·</span>
                  <span className="text-violet-300">子工作流 #{subgraphStack[subgraphStack.length - 1]!.uid}</span>
                </>
              )}
            </p>
            {detail.sourcePath ? (
              detail.sourceMissing ? (
                <p className="mt-1 flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/[0.07] px-2 py-1 text-[11px] text-red-300">
                  <span className="font-semibold">本地文件已丢失：</span>
                  <span className="truncate font-mono">{detail.sourcePath}</span>
                  <span className="ml-1 shrink-0 text-red-400/80">· 修改保存后刷新将自动重连</span>
                </p>
              ) : detail.sourceChanged ? (
                <p className="mt-1 flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/[0.07] px-2 py-1 text-[11px] text-emerald-300">
                  <span className="font-semibold">已从本地文件刷新最新内容</span>
                  <span className="truncate font-mono text-emerald-400/80">{detail.sourcePath}</span>
                </p>
              ) : (
                <p className="mt-1 truncate rounded-md border border-emerald-500/20 bg-emerald-500/[0.05] px-2 py-1 text-[11px] text-emerald-400/80" title={detail.sourcePath}>
                  已连接本地文件 · 文件改动后刷新即可同步
                </p>
              )
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 2026-08-12 R78.2: 主画布 RAW / API 视图切换。
           *  - "raw" = ComfyUI 原始布局（detail.positions，已含 rawJson 位置）
           *  - "api" = 执行图拓扑自动布局（detail.graph），与导入位置无关
           *  两者都渲染同一批可编辑节点 + 同一套连线，仅位置不同。 */}
          <div className="flex items-center rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
            <button
              type="button"
              onClick={() => {
                setViewMode("raw");
                setApiLayoutOverrides({});
              }}
              className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                viewMode === "raw"
                  ? "bg-violet-500/90 text-white shadow"
                  : "text-gray-400 hover:text-gray-200"
              }`}
              title="RAW 布局：按 rawJson 原始位置（ComfyUI 画布布局）排布节点"
            >
              RAW 布局
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode("api");
                setApiLayoutOverrides({});
              }}
              className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                viewMode === "api"
                  ? "bg-cyan-500/90 text-white shadow"
                  : "text-gray-400 hover:text-gray-200"
              }`}
              title="API 布局：按执行图拓扑自动排布节点（忽略 rawJson 导入位置）"
            >
              API 布局
            </button>
          </div>
          {/* 2026-08-24: 调试模式 — 节点卡片叠加显示渲染链路模块标签。
           *  读写全局 debug-store（与项目画布共用同一开关）；沿用 RAW/API
           *  view switch 的紫色 pill 风格，激活态高亮。开启后 wf-node 卡片
           *  底部渲染 DebugChainFooter。 */}
          <button
            type="button"
            onClick={toggleDebugMode}
            className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
              debugMode
                ? "bg-violet-500/90 text-white shadow"
                : "text-gray-400 hover:text-gray-200"
            }`}
            title="调试模式：在节点卡片上叠加显示渲染链路模块标签（点击复制完整路径）"
          >
            {debugMode ? "✓ 调试中" : "调试"}
          </button>
          {error && <span className="text-xs text-red-400">{error}</span>}
          {/* R50 (2026-08-11): the "编辑 IO" / "预览 IO" affordances are
           *  scoped to the ROOT workflow only — subgraphs (子工作流) can't
           *  run independently.  The whole concept of `workflowIO` is a
           *  contract between this workflow's author and whoever calls
           *  it (currently the DynamicWorkflowForm generator); a subgraph
           *  is reached through its parent, so it never needs to publish
           *  its own IO surface.  Hiding the buttons keeps the toolbar
           *  honest about what's even meaningful here.  State cleanup
           *  happens in `onEnterSubgraph` (above) so the buttons
           *  disappear *before* the subgraph's WorkflowNodes would otherwise
           *  inherit any leftover `ioEditMode=true` and render stray
           *  checkboxes. */}
          {subgraphStack.length === 0 && (
            <button
              type="button"
              onClick={() => setIoEditMode((value) => !value)}
              className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
                ioEditMode
                  ? "border-amber-400/60 bg-amber-400/20 text-amber-100 hover:bg-amber-400/30"
                  : "border-white/15 bg-white/5 text-gray-200 hover:bg-white/10"
              }`}
              title="进入 IO 编辑模式：在每个节点参数前显示勾选框，勾选即把该参数暴露为工作流的外部输入或输出"
            >
              {ioEditMode ? "✓ 编辑 IO 中" : "📌 编辑 IO"}
              {ioEditMode && Object.keys(workflowIO).length > 0 && (
                <span className="ml-1 rounded-full bg-amber-300/30 px-1.5 text-[11px] font-bold text-amber-50">
                  {Object.keys(workflowIO).length}
                </span>
              )}
            </button>
          )}
          {/* IO preview toggle (2026-08-09).  Sits next to "编辑 IO" so the
           *  author can flip into edit + open the preview in one sweep.
           *  Disabled outside edit mode — preview is meaningful only when
           *  there's an IO selection to render.  When the user opens the
           *  panel but hasn't entered edit mode, auto-flip edit on too,
           *  so checkboxes remain useful alongside the preview.  Also
           *  hidden in subgraph view (R50) — same rationale as the edit
           *  toggle: a subgraph has no IO contract to preview. */}
          {subgraphStack.length === 0 && (
            <button
              type="button"
              onClick={() => {
                if (!ioEditMode) setIoEditMode(true);
                setIoPreviewOpen((value) => !value);
              }}
              disabled={!ioEditMode && !ioPreviewOpen && Object.keys(workflowIO).length === 0}
              className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
                ioPreviewOpen
                  ? "border-sky-400/60 bg-sky-400/20 text-sky-100 hover:bg-sky-400/30"
                  : "border-white/15 bg-white/5 text-gray-200 hover:bg-white/10 disabled:opacity-40"
              }`}
              title="预览当前勾选的 IO 在最终表单中的样子；预览面板中每个名称都可点击重命名"
            >
              {ioPreviewOpen ? "👁 关闭预览" : "👁 预览 IO"}
            </button>
          )}
          {/* 2026-08-11 R40: 顶部直达 JSON 源码查看器。复用 WorkflowLibrary
           *  的 SourceModal —— 从缓存里的 disk snapshot 拿 graph/rawJson,
           *  无需再 fetch。打开 modal 前判读 detail 是否已就绪,否则 toast 提醒。 */}
          <button
            type="button"
            onClick={() => {
              if (!detail) {
                toast.info("工作流尚未加载完成");
                return;
              }
              setViewJsonOpen(true);
            }}
            disabled={!detail}
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-gray-200 transition-colors hover:bg-white/10 disabled:opacity-40"
            title="查看当前工作流的 API + RAW 源码（基于磁盘已保存版本，未保存的画布修改不在内）"
          >
            📋 查看 JSON
          </button>
          <button
            type="button"
            onClick={resetLayout}
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-gray-200 transition-colors hover:bg-white/10"
            title="把所有节点恢复到进入工作流时的原始位置（撤销全部手动拖动）"
          >
            重置布局
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-violet-500/90 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
          >
            {saving ? "保存中…" : "💾 保存"}
          </button>
        </div>
      </header>
  );
}
