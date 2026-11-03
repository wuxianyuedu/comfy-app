"use client";

// 详情面板主体：画布预览 / 参数配置 / 源文件三个页签的内容。纯展示。

import React from "react";

import { Maximize2 } from "lucide-react";

import type { SourceModalData } from "~/components/studio/SourceModal";
import type { WorkflowIOMap } from "~/components/studio/workflow-io";
import { Button } from "~/components/ui/button";
import type { DetailTab } from "../workflow-library-detail-config";
import type { WorkflowRow } from "../workflow-library-config";
import { LazyJsonViewer } from "~/components/ui/lazy-json-viewer";
import { ErrorBoundary } from "~/components/ui/error-boundary";
import { useLazyChunkFallback } from "~/components/ui/use-lazy-chunk-fallback";
import { EMBEDDED_SCROLL_MAX_HEIGHT } from "~/components/ui/overlay-max-height";
import { WorkshopEncapsulationPanel } from "./WorkshopEncapsulationPanel";

/* ── 两个页签的重型内容各自懒加载（规范 §12.19 / 02 §2.9）──
 * 本面板常驻，下面挂着画布引擎 `@xyflow/react` 与 `react18-json-view`；此前静态
 * import，打开工作流库看一眼列表也要把两者拖进静态图（见 check-barrel-heavy-deps）。
 * 改 `React.lazy` 后只在切到对应页签时下载；`key=workflow.id` 重建语义不变。 */
const LazyWorkflowCanvasNodePreview = React.lazy(() =>
  import("../WorkflowCanvasNodePreview").then((m) => ({
    default: m.WorkflowCanvasNodePreview,
  })),
);

type DetailBodyProps = {
  /** **两个页签共用的当前模式**（详情层持有，见 `WorkflowLibraryDetailController`
   *  的 `activeMode`）：画布卡片列与工坊封装按同一个模式渲染，用户在两处切换的
   *  是同一件事。 */
  activeMode: string | null;
  isLoading: boolean;
  /** 多模式工作流的模式切换（画布预览节点的类型 chip 可点选默认模式）。 */
  meta?: {
    defaultMode: string;
    modes: Array<string>;
    onModeChange: (code: string) => void;
  };
  /** 切换当前模式（只改查看 / 测试语境，不落库）。 */
  onActiveModeChange: (mode: string) => void;
  /** 在编辑器中打开当前工作流。 */
  onEdit: () => void;
  /** 对外参数落点持久化（画布预览拖圆点改落点）。 */
  onPatchParamMap?: (next: Record<string, unknown>) => Promise<void>;
  /** seed 类参数的「控件后行为」持久化（画布预览节点与 IO 编辑一致）。 */
  onSeedModeChange?: (ioKey: string, mode: string) => void;
  /** 模板 paramMap（对外参数落点），画布节点页签据此标出对外参数与落点。 */
  paramMap: Record<string, unknown>;
  sourceData: SourceModalData | null;
  /** 本面板承载的页签 —— 每个页签各自一个面板（`ui/tabs` 的 Panel）。 */
  tab: DetailTab;
  usable: boolean;
  workflow: WorkflowRow;
  workflowIO: WorkflowIOMap | null;
};

export function DetailBody({
  workflow,
  tab,
  isLoading,
  workflowIO,
  paramMap,
  sourceData,
  usable,
  activeMode,
  onActiveModeChange,
  onEdit,
  meta,
  onSeedModeChange,
  onPatchParamMap,
}: DetailBodyProps) {
  /* 懒加载的画布预览撞上「分块已被换掉」时，这一块自己给出路（见下方边界）。 */
  const chunkFallback = useLazyChunkFallback("画布预览");
  /* 换工作流 / 首次打开时详情查询尚未排空：此时表单拿不到 IO，预览会先渲染
   * 一遍无参卡片再被真实 IO 顶掉（整块高度改变 → 页面跳一下），参数页签同
   * 理。统一的处理是「还没就绪就不渲染页签内容」——container 用 min-h-0 撑满
   * 父级，切换不会闪出占位文案，也不会出现半渲染的中间态。 */
  if (isLoading) {
    return null;
  }

  return (
    <>
      {(tab === "canvas" || tab === "use") && (
        /* 「编辑对外参数 / 实际使用」是同一份预览的两个视图模式：两个分支**必须
         * 渲染同一棵元素树**（同样包裹层 + `WorkflowCanvasNodePreview`，只差
         * `viewMode`），页签切换时 React 才认成同一实例，表单值/运行态/结果图不丢
         * （外层常驻容器见 `WorkflowLibraryDetailView`）。画布页签吃满可用高度
         * （ISSUE #596），外层 `min-h-0 flex-1` 与本层 `h-full` 缺一不可。 */
        <div className="border-border bg-panel-deep flex h-full min-h-105 flex-col rounded-2xl border p-1">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-ink-faint text-xs font-medium">
              画布样式预览（与项目画布节点一致，可直接运行调试）
            </span>
            <Button
              className="text-2xs h-auto gap-1 rounded-md px-2 py-1"
              onClick={onEdit}
              size="xs"
              variant="primary"
            >
              <Maximize2 className="size-3" data-icon="inline-start" />
              在编辑器中打开
            </Button>
          </div>
          {/* 画布预览：宿主运行卡片居中，两侧各并排一列卡片 —— 左侧是「对外
              输入参数」（要什么、落到哪一行），右侧是「对外输出参数」（给什么）。
              三列一起参与居中，不用固定留白挂靠；窄面板放不下时由 outer 的
              `overflow-auto` 横向滚动。 */}
          <div className="flex min-h-0 flex-1 justify-center px-2 py-4">
            {/* 横向仍可滚（三列常宽过面板）；纵向交给画布撑开（见上面的高度链条）。*/}
            <div className="flex min-h-0 w-full min-w-0 flex-1 justify-center overflow-x-auto overflow-y-hidden">
              {/* key=workflow.id：切换左侧工作流时重建预览，避免上一工作流的
                运行结果/状态/表单残留（详情区复用的是同一 DOM 位置）。 */}
              {/* 画布预览是懒加载的（下面挂着画布引擎）：dev server 重建后它的分块
                  可能已被换掉，`import()` 只剩 reject。没有这层边界时错误会冒到路由级
                  边界、把整个工作流库打成错误页。 */}
              <ErrorBoundary fallback={chunkFallback}>
                <LazyWorkflowCanvasNodePreview
                  /* 生效模式取详情层那一份（两个页签共用）；`defaultMode` 仍传，
                   * 作为「未切过时的初值」与卡片上的默认标记。 */
                  defaultMode={activeMode ?? meta?.defaultMode}
                  key={workflow.id}
                  modes={meta?.modes}
                  onModeChange={(code) => {
                    meta?.onModeChange(code);
                  }}
                  onPatchParamMap={onPatchParamMap}
                  onSeedModeChange={onSeedModeChange}
                  paramMap={paramMap}
                  taskType={workflow.taskType}
                  usable={usable}
                  /* 页签即视图模式：「实际使用」页签可生成、可看结果，
                   * 「编辑对外参数」页签是参数落点编辑画布。 */
                  viewMode={tab === "use" ? "use" : "edit"}
                  workflowId={workflow.id}
                  workflowIO={workflowIO}
                  workflowName={workflow.name}
                />
              </ErrorBoundary>
            </div>
          </div>
        </div>
      )}

      {tab === "params" && (
        <WorkshopEncapsulationPanel
          displayName={workflow.modelTags?.[0] ?? workflow.name}
          key={workflow.id}
          /* 模式取详情层的当前模式（与画布节点页签同一份），并通过
           * `onModeChange` 让用户在本页直接换模式跑流程测试 —— 多模式工作流
           * 以前在这里只能测默认模式（ISSUE #720 第 3 条）。 */
          mode={activeMode}
          /* 可切换的模式清单与画布卡片上的模式下拉**同一份**
           * （`metaEditor.modes`：缺省回退 [taskType]，兼容旧行）。 */
          modes={meta?.modes ?? []}
          onModeChange={onActiveModeChange}
          paramMap={paramMap}
          workflowId={workflow.id}
          workflowIO={workflowIO}
        />
      )}

      {tab === "source" && (
        <div className="border-border bg-panel-deep rounded-2xl border p-1">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-ink-faint text-xs font-medium">工作流(RAW)格式原件</span>
          </div>
          <div className={`bg-canvas-deep ${EMBEDDED_SCROLL_MAX_HEIGHT} overflow-auto rounded-xl`}>
            {/* oxlint-disable-next-line eqeqeq -- 同时判 null 与 undefined */}
            {sourceData?.source == null ? (
              <p className="text-ink-fainter px-4 py-10 text-center text-xs">暂无源文件数据</p>
            ) : (
              <LazyJsonViewer
                data={sourceData.source}
                initialCollapsedDepth={2}
                title="工作流(RAW)格式"
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
