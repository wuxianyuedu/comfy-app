"use client";
/* 工作流编辑器顶栏：面包屑、统计、IO 开关、JSON 查看器、重置与保存按钮。
 * IO 相关状态直接读 Zustand IOEditStore（getIOEditApi / useIOEditStore，
 * 与 WorkflowEditorBody 同模式），因此本组件只接收 workflow/view/nav 类 props。 */
import React, { useCallback } from "react";
import { ArrowLeft, RotateCw } from "lucide-react";
import type { WorkflowDetail } from "../workflow-types";
import { useToast } from "../ToastProvider";
import { isNoteType } from "../workflow-utils";
import { useDebugStore } from "../debug/debug-store";
import {
  getIOEditApi,
  useIOEditStore,
  selectIoEditMode,
  selectWorkflowIO,
  selectIoPreviewOpen,
} from "./WorkflowStores";
import {
  TOP_BAR_BREADCRUMB_CLASS,
  TOP_BAR_ROOT_CLASS,
  topBarButtonClass,
  topBarGroupClass,
} from "./workflow-editor-topbar-config";

export interface WorkflowEditorTopBarProps {
  onClose: () => void;
  detail: WorkflowDetail;
  rootWorkflowName: string;
  subgraphStack: { uid: string; name: string; nodeId: string }[];
  setSubgraphStack: React.Dispatch<
    React.SetStateAction<{ uid: string; name: string; nodeId: string }[]>
  >;
  fetchDetail: (opts?: {
    subgraphUid?: string;
    parentTitle?: string;
    bust?: boolean;
    /** 目标层级的宿主链（`4` / `4:5`），子图坐标按它拼键读回。 */
    hostNodeId?: string;
  }) => Promise<void>;
  onExitSubgraph: () => void;
  /** 强制重载当前视图：必须带上本视图的宿主链，否则子图里拖过的坐标
   *  会因为读错命名空间而全部丢失。`silent` 用于重置布局这类主动重拉，
   *  不把画布打成 loading。 */
  forceReloadDetail: (hostNodeId?: string, silent?: boolean) => void;
  setViewJsonOpen: React.Dispatch<React.SetStateAction<boolean>>;
  resetLayout: () => void;
  /** 当前视图的宿主链（顶层为空串，下钻后 `4` / `4:5`）。 */
  viewHostNodeId: string;
  handleSave: () => void;
  saving: boolean;
  error: string;
}

export const WorkflowEditorTopBar = React.memo(function WorkflowEditorTopBar({
  onClose,
  detail,
  rootWorkflowName,
  subgraphStack,
  setSubgraphStack,
  fetchDetail,
  onExitSubgraph,
  forceReloadDetail,
  setViewJsonOpen,
  resetLayout,
  viewHostNodeId,
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
  /* 开关编辑模式 / 预览一律走 store 动作（不要再手写 `ioApi.setState(...)`）：
   *  关编辑模式连带走预览、关预览连带走编辑模式，两层耦合都落在 store 里。
   *  绕过动作直接写状态就会留下「没有勾选框的预览面板」，或反过来留下
   *  「面板已消失、勾选框还挂在节点上」的半截状态。 */
  const setIoEditMode = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) =>
      ioApi
        .getState()
        .setIoEditMode(
          typeof v === "function" ? v(ioApi.getState().ioEditMode) : v,
        ),
    [ioApi],
  );
  const setIoPreviewOpen = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) =>
      ioApi
        .getState()
        .setIoPreviewOpen(
          typeof v === "function" ? v(ioApi.getState().ioPreviewOpen) : v,
        ),
    [ioApi],
  );
  const toast = useToast();

  return (
    <header
      className={TOP_BAR_ROOT_CLASS}
      style={{
        background: "color-mix(in srgb, var(--color-panel) 85%, transparent)",
      }}
    >
      <div className={TOP_BAR_BREADCRUMB_CLASS}>
        <button
          type="button"
          onClick={onClose}
          className="text-ink-muted hover:bg-subtle hover:text-ink-soft rounded-lg p-1.5 transition-colors"
        >
          <ArrowLeft size={18} />
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
              className="text-ink-bright font-title max-w-70 truncate text-[18px] leading-tight font-bold tracking-tight transition-colors hover:text-violet-700 dark:text-violet-300"
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
                    <span className="text-ink-fainter text-[14px]">/</span>
                    <span
                      className={`${baseCls} rounded-md border border-violet-500/40 bg-violet-500/15 px-2 py-0.5 text-violet-700 dark:text-violet-200`}
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
                  <span className="text-ink-fainter text-[14px]">/</span>
                  <button
                    type="button"
                    onClick={() => {
                      const next = subgraphStack.slice(0, i + 1);
                      setSubgraphStack(next);
                      /* 跳到第 i 层：宿主链是这一层之前所有 wrapper id 的
                       *  拼接（与 runtimeNodeId 同口径），少拼一层就会读到
                       *  别的层级的坐标。 */
                      const hostChain = next
                        .slice(0, -1)
                        .map((c) => c.nodeId)
                        .join(":");
                      void fetchDetail({
                        subgraphUid: crumb.uid,
                        parentTitle: crumb.name,
                        hostNodeId: hostChain,
                      });
                    }}
                    className={`${baseCls} text-ink-soft hover:bg-subtle rounded-md px-1.5 py-0.5 hover:text-violet-700 dark:hover:text-violet-200`}
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
                className="ml-2 inline-flex items-center gap-1 rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-700 transition-colors hover:bg-violet-500/20 dark:text-violet-200"
                title="返回上一级"
              >
                <ArrowLeft size={10} strokeWidth={2.5} />
                返回上一级
              </button>
            )}
            {/* 终极方案 #4：🔄 一键强制重载缓存.
             *   - 清 sessionStorage + 跳过 server LRU + 重置 in-flight req
             *   - 任何 之前的旧缓存条目都不会被读到，因为入口扫描删了
             *   - 任何之后人为改了 route.ts 没同步 SCHEMA_FINGERPRINT 的，
             *     schema 不匹配会直接导致 cacheKey 不命中，走冷路径 */}
            <button
              type="button"
              onClick={() => forceReloadDetail(viewHostNodeId)}
              className="ml-1 inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-700 transition-colors hover:bg-rose-500/20 dark:text-rose-200"
              title="强制重载（清 sessionStorage + 跳过 server LRU + 重拉数据）"
            >
              <RotateCw size={10} strokeWidth={2.5} />
              强制重载
            </button>
          </div>
          <p className="text-ink-soft mt-0.5 truncate text-[11px] font-medium">
            {detail.nodes.filter((node) => !isNoteType(node.class_type)).length}{" "}
            个节点
            <span className="text-ink-fainter mx-1.5">·</span>
            {Object.keys(workflowIO).length} 个暴露 IO
            <span className="text-ink-fainter mx-1.5">·</span>
            {detail.notes?.length ?? 0} 个注释
            <span className="text-ink-fainter mx-1.5">·</span>
            {detail.groups?.length ?? 0} 个分组
            {subgraphStack.length > 0 && (
              <>
                <span className="text-ink-fainter mx-1.5">·</span>
                <span className="text-violet-700 dark:text-violet-300">
                  子工作流 #{subgraphStack[subgraphStack.length - 1]!.uid}
                </span>
              </>
            )}
          </p>
          {detail.sourcePath ? (
            detail.sourceMissing ? (
              <p className="mt-1 flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-700 dark:text-red-300">
                <span className="font-semibold">本地文件已丢失：</span>
                <span className="truncate font-mono">{detail.sourcePath}</span>
                <span className="ml-1 shrink-0 text-red-700/80 dark:text-red-400/80">
                  · 修改保存后刷新将自动重连
                </span>
              </p>
            ) : detail.sourceChanged ? (
              <p className="mt-1 flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-700 dark:text-emerald-300">
                <span className="font-semibold">已从本地文件刷新最新内容</span>
                <span className="truncate font-mono text-emerald-700/80 dark:text-emerald-400/80">
                  {detail.sourcePath}
                </span>
              </p>
            ) : (
              <p
                className="mt-1 truncate rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2 py-1 text-[11px] text-emerald-700/80 dark:text-emerald-400/80"
                title={detail.sourcePath}
              >
                已连接本地文件 · 文件改动后刷新即可同步
              </p>
            )
          ) : null}
        </div>
      </div>

      <div className={topBarGroupClass("compact")}>
        {/* 单一格式（不再区分 RAW / API 视图），节点布局统一由
         *  detail.positions 决定；RAW / API 切换 UI 已移除。 */}
        {/* 调试模式 — 节点卡片叠加显示渲染链路模块标签。
         *  读写全局 debug-store（与项目画布共用同一开关），激活态高亮。
         *  开启后 wf-node 卡片底部渲染 DebugChainFooter。 */}
        <button
          type="button"
          onClick={toggleDebugMode}
          className={topBarButtonClass(
            "ghost",
            "compact",
            debugMode ? "bg-violet-500/90 text-white shadow" : "",
          )}
          title="调试模式：在节点卡片上叠加显示渲染链路模块标签（点击复制完整路径）"
        >
          {debugMode ? "✓ 调试中" : "调试"}
        </button>
        {error && (
          <span className="text-xs text-red-700 dark:text-red-400">
            {error}
          </span>
        )}
        {/* the "编辑 IO" / "预览 IO" affordances are available at BOTH
         *  levels — the root workflow AND inside a subgraph.
         *
         *  子图本身没有独立的 IO 契约（它由父工作流经边界 pin 进入），但**父
         *  工作流**完全可以把参数暴露在子图内部的节点上（`LoadImage` 的
         *  `image`、`PrimitiveInt` 的 `value`…）。下钻后仍能勾选，作者才能把
         *  这类内部参数接进父工作流的对外参数；勾选时画布把「从哪一层钻进来」
         *  的宿主节点 id 一并带上（`IoRef.hostNodeId`），运行期据此把内部节点
         *  id 还原成 comfy-cli 展开后的 `宿主id:内部id`。
         *
         *  内层视图没有服务端富化结果（子图路由不产出 workflowIO：它按整份
         *  工作流的下标打键，带进内层会误伤顶层未保存的编辑），IO 预览按当前
         *  视图节点的原始元数据就地派生（见 `enrichFromViewNodes`），保证两层
         *  取名口径一致。 */}
        <button
          type="button"
          onClick={() => setIoEditMode((value) => !value)}
          className={topBarButtonClass(
            ioEditMode ? "ioOn" : "outline",
            "compact",
          )}
          title="进入 IO 编辑模式：在每个节点参数前显示勾选框，勾选即把该参数暴露为工作流的外部输入或输出。退出编辑模式时会一并关闭 IO 预览"
        >
          {ioEditMode ? "✓ 编辑 IO 中" : "📌 编辑 IO"}
          {ioEditMode && Object.keys(workflowIO).length > 0 && (
            <span className="ml-1 rounded-full bg-amber-300/30 px-1.5 text-[11px] font-bold text-amber-800 dark:text-amber-50">
              {Object.keys(workflowIO).length}
            </span>
          )}
        </button>
        {/* IO preview toggle. Sits next to "编辑 IO" so the
         *  author can flip into edit + open the preview in one sweep.
         *  Disabled outside edit mode — preview is meaningful only when
         *  there's an IO selection to render.  When the user opens the
         *  panel but hasn't entered edit mode, auto-flip edit on too,
         *  so checkboxes remain usable alongside the preview.
         *
         *  两个方向都耦合：关预览会一并退出编辑模式（面板消失后画布上不该
         *  再留一排没有结果的勾选框），关编辑模式也一并关预览。耦合落在 store
         *  的 `setIoEditMode` / `setIoPreviewOpen` 上，不在这里手写两处 setState。 */}
        <button
          type="button"
          onClick={() => setIoPreviewOpen((value) => !value)}
          disabled={
            !ioEditMode &&
            !ioPreviewOpen &&
            Object.keys(workflowIO).length === 0
          }
          className={topBarButtonClass(
            ioPreviewOpen ? "ioPreviewOn" : "outline",
            "compact",
            "disabled:opacity-40",
          )}
          title="预览当前勾选的 IO 在最终表单中的样子；预览面板中每个名称都可点击重命名。关闭预览时会一并退出 IO 编辑模式"
        >
          {ioPreviewOpen ? "👁 关闭预览" : "👁 预览 IO"}
        </button>
        {/* 顶部直达 JSON 源码查看器。复用 WorkflowLibrary
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
          className={topBarButtonClass(
            "outline",
            "compact",
            "disabled:opacity-40",
          )}
          title="查看当前工作流的 API + RAW 源码（基于磁盘已保存版本，未保存的画布修改不在内）"
        >
          📋 查看 JSON
        </button>
        <button
          type="button"
          onClick={resetLayout}
          className={topBarButtonClass("outline", "compact")}
          title="把所有节点恢复到进入工作流时的原始位置（撤销全部手动拖动）"
        >
          重置布局
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={topBarButtonClass(
            "solid",
            "compact",
            "disabled:opacity-50",
          )}
        >
          {saving ? "保存中…" : "💾 保存"}
        </button>
      </div>
    </header>
  );
});
