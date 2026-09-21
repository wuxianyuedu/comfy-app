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
import { Button } from "~/components/ui/button";
import { lastSegments } from "~/lib/path-display";
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
        <Button
          variant="ghost"
          size="icon-lg"
          onClick={onClose}
          className="text-ink-muted hover:bg-subtle hover:text-ink-soft rounded-lg"
        >
          <ArrowLeft size={18} />
        </Button>
        <div className="flex flex-col">
          {/* 面包屑：根工作流名 · 子图 1 · 子图 2 …
           *  首段永远是**根**工作流的显示
           *  名（首次顶层拉取时捕获，跨子图导航时保留），
           *  所以下钻进子图永远不会
           *  把首段改写成子图自己的名字。
           *  点根段跳回顶层。每个
           *  中间层子图段是可点击按钮，
           *  下钻回那一层。**最后**一段（用户
           *  当前所在的子图）渲染成不可交互的
           *  span，配紫色选择框 —— 点它
           *  不会重入同一子图（那会把另一层压进
           *  `subgraphStack`，很令人困惑）。
           *  截断用 `max-w` + `truncate`，超长名字
           *  收成省略号；全名仍可经
           *  `title` 属性（浏览器原生 tooltip）读到。 */}
          <div className="flex items-center gap-1.5 text-[12px]">
            <Button
              variant="ghost"
              onClick={() => {
                if (subgraphStack.length > 0) {
                  setSubgraphStack([]);
                  void fetchDetail();
                }
              }}
              /* 标题本身就是触发器：吃掉基元的高度/圆角/内边距（`h-auto`），
               *  只留 hover 变色（16 §16.2.4.2）。 */
              className="text-ink-bright font-title hover:text-primary-strong h-auto max-w-70 truncate rounded-md px-0 py-0 text-[18px] leading-tight font-bold tracking-tight hover:bg-transparent"
              title={
                subgraphStack.length
                  ? `${rootWorkflowName || detail.name}（返回顶层工作流）`
                  : rootWorkflowName || detail.name
              }
            >
              {rootWorkflowName || detail.name}
            </Button>
            {subgraphStack.map((crumb, i) => {
              const isLast = i === subgraphStack.length - 1;
              /* 所有面包屑通用的截断样式。 */
              const baseCls =
                "max-w-[260px] truncate text-[14px] font-medium transition-colors";
              if (isLast) {
                /* 当前子图：不可点击的 span，配紫色
                 *  选中药丸，视觉上钉住「此处」
                 *  标记。不用按钮 = 不会误触重入
                 *  （那会把幽灵层压进
                 *  `subgraphStack`）。 */
                return (
                  <React.Fragment key={crumb.uid + i}>
                    <span className="text-ink-fainter text-[14px]">/</span>
                    <span
                      className={`${baseCls} border-primary-500/40 bg-primary-500/15 text-primary-strong rounded-md border px-2 py-0.5`}
                      style={{ cursor: "default" }}
                      title={crumb.name}
                    >
                      {crumb.name}
                    </span>
                  </React.Fragment>
                );
              }
              /* 中间层子图（i < last）：可点击按钮，
               *  下钻回到那一层（把栈截到 i+1
               *  并重新拉取该子图的数据）。 */
              return (
                <React.Fragment key={crumb.uid + i}>
                  <span className="text-ink-fainter text-[14px]">/</span>
                  <Button
                    variant="ghost"
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
                    className={`${baseCls} text-ink-soft hover:bg-subtle hover:text-primary-strong h-auto rounded-md px-1.5 py-0.5`}
                    title={`${crumb.name}（跳到此层）`}
                  >
                    {crumb.name}
                  </Button>
                </React.Fragment>
              );
            })}
            {subgraphStack.length > 0 && (
              <Button
                variant="primary"
                onClick={onExitSubgraph}
                className="ml-2 h-auto rounded-md px-2 py-0.5 text-[11px]"
                title="返回上一级"
              >
                <ArrowLeft size={10} strokeWidth={2.5} />
                返回上一级
              </Button>
            )}
            {/* 终极方案 #4：🔄 一键强制重载缓存.
             *   - 清 sessionStorage + 跳过 server LRU + 重置 in-flight req
             *   - 任何 之前的旧缓存条目都不会被读到，因为入口扫描删了
             *   - 任何之后人为改了 route.ts 没同步 SCHEMA_FINGERPRINT 的，
             *     schema 不匹配会直接导致 cacheKey 不命中，走冷路径 */}
            <Button
              variant="danger"
              onClick={() => forceReloadDetail(viewHostNodeId)}
              className="ml-1 h-auto rounded-md px-2 py-0.5 text-[11px]"
              title="强制重载（清 sessionStorage + 跳过 server LRU + 重拉数据）"
            >
              <RotateCw size={10} strokeWidth={2.5} />
              强制重载
            </Button>
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
                <span className="text-primary-strong">
                  子工作流 #{subgraphStack[subgraphStack.length - 1]!.uid}
                </span>
              </>
            )}
          </p>
          {detail.sourcePath ? (
            detail.sourceMissing ? (
              <p className="border-destructive/30 bg-destructive/10 text-danger-strong mt-1 flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]">
                <span className="font-semibold">本地文件已丢失：</span>
                <span className="truncate font-mono" title={detail.sourcePath}>
                  {lastSegments(detail.sourcePath, 3)}
                </span>
                <span className="text-danger-strong/80 ml-1 shrink-0">
                  · 修改保存后刷新将自动重连
                </span>
              </p>
            ) : detail.sourceOutdated ? (
              <p className="mt-1 flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300">
                <span className="font-semibold">磁盘文件有更新</span>
                <span className="opacity-80">
                  · 回工作流库点「同步」拉取最新内容
                </span>
                <span
                  className="text-success-strong/80 truncate font-mono"
                  title={detail.sourcePath}
                >
                  {lastSegments(detail.sourcePath, 3)}
                </span>
              </p>
            ) : (
              <p
                className="border-success/20 bg-success/5 text-success-strong/80 mt-1 truncate rounded-md border px-2 py-1 text-[11px]"
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
        <Button
          variant="ghost"
          onClick={toggleDebugMode}
          className={topBarButtonClass(
            "ghost",
            "compact",
            debugMode
              ? "bg-primary-500 text-primary-foreground hover:bg-primary-500 shadow"
              : "",
          )}
          title="调试模式：在节点卡片上叠加显示渲染链路模块标签（点击复制完整路径）"
        >
          {debugMode ? "✓ 调试中" : "调试"}
        </Button>
        {error && (
          <span className="text-xs text-red-700 dark:text-red-400">
            {error}
          </span>
        )}
        {/* 「编辑 IO」/「预览 IO」在**两层**都可用
         *  —— 根工作流与子图内部都可用。
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
        <Button
          variant="ghost"
          onClick={() => setIoEditMode((value) => !value)}
          className={topBarButtonClass(
            ioEditMode ? "ioOn" : "outline",
            "compact",
          )}
          title="进入 IO 编辑模式：在每个节点参数前显示勾选框，勾选即把该参数暴露为工作流的外部输入或输出。退出编辑模式时会一并关闭 IO 预览"
        >
          {ioEditMode ? "✓ 编辑 IO 中" : "📌 编辑 IO"}
          {ioEditMode && Object.keys(workflowIO).length > 0 && (
            <span className="bg-warning/30 text-warning-strong ml-1 rounded-full px-1.5 text-[11px] font-bold">
              {Object.keys(workflowIO).length}
            </span>
          )}
        </Button>
        {/* IO 预览开关。挨着「编辑 IO」放，好让
         *  作者一次就切进编辑 + 打开预览。
         *  编辑模式外禁用 —— 预览只有在
         *  有 IO 选择可渲染时才有意义。用户打开
         *  面板但还没进编辑模式时，也自动切进编辑，
         *  好让复选框与预览一起可用。
         *
         *  两个方向都耦合：关预览会一并退出编辑模式（面板消失后画布上不该
         *  再留一排没有结果的勾选框），关编辑模式也一并关预览。耦合落在 store
         *  的 `setIoEditMode` / `setIoPreviewOpen` 上，不在这里手写两处 setState。 */}
        <Button
          variant="ghost"
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
        </Button>
        {/* 顶部直达 JSON 源码查看器。复用 WorkflowLibrary
         *  的 SourceModal —— 从缓存里的 disk snapshot 拿 graph/rawJson,
         *  无需再 fetch。打开 modal 前判读 detail 是否已就绪,否则 toast 提醒。 */}
        <Button
          variant="ghost"
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
          title="查看当前工作流的 RAW 源码（基于磁盘已保存版本，未保存的画布修改不在内）"
        >
          📋 查看 JSON
        </Button>
        <Button
          variant="ghost"
          onClick={resetLayout}
          className={topBarButtonClass("outline", "compact")}
          title="把所有节点恢复到进入工作流时的原始位置（撤销全部手动拖动）"
        >
          重置布局
        </Button>
        <Button
          variant="ghost"
          onClick={handleSave}
          disabled={saving}
          className={topBarButtonClass(
            "solid",
            "compact",
            "disabled:opacity-50",
          )}
        >
          {saving ? "保存中…" : "💾 保存"}
        </Button>
      </div>
    </header>
  );
});
