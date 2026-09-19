"use client";

// 详情面板主体：画布预览 / 参数配置 / 源文件三个页签的内容。纯展示。

import { Maximize2 } from "lucide-react";

import type { SourceModalData } from "~/components/studio/SourceModal";
import type { WorkflowIOMap } from "~/components/studio/workflow-io";
import { JsonViewer } from "~/components/ui/json-viewer";
import { Button } from "~/components/ui/button";
import type { DetailTab } from "../workflow-library-detail-config";
import type { WorkflowRow } from "../workflow-library-config";
import { WorkflowCanvasNodePreview } from "../WorkflowCanvasNodePreview";
import { WorkshopEncapsulationPanel } from "./WorkshopEncapsulationPanel";

interface DetailBodyProps {
  workflow: WorkflowRow;
  /** 本面板承载的页签 —— 每个页签各自一个面板（`ui/tabs` 的 Panel）。 */
  tab: DetailTab;
  isLoading: boolean;
  workflowIO: WorkflowIOMap | null;
  /** 模板 paramMap（对外参数落点），画布节点页签据此标出对外参数与落点。 */
  paramMap: Record<string, unknown>;
  sourceData: SourceModalData | null;
  usable: boolean;
  /** 在编辑器中打开当前工作流。 */
  onEdit: () => void;
  /** 多模式工作流的模式切换（画布预览节点的类型 chip 可点选默认模式）。 */
  meta?: {
    modes: string[];
    defaultMode: string;
    onModeChange: (code: string) => void;
  };
  /** seed 类参数的「控件后行为」持久化（画布预览节点与 IO 编辑一致）。 */
  onSeedModeChange?: (ioKey: string, mode: string) => void;
  /** 对外参数落点持久化（画布预览拖圆点改落点）。 */
  onPatchParamMap?: (next: Record<string, unknown>) => Promise<void>;
}

export function DetailBody({
  workflow,
  tab,
  isLoading,
  workflowIO,
  paramMap,
  sourceData,
  usable,
  onEdit,
  meta,
  onSeedModeChange,
  onPatchParamMap,
}: DetailBodyProps) {
  /* 换工作流 / 首次打开时详情查询尚未排空：此时表单拿不到 IO，预览会先渲染
   * 一遍无参卡片再被真实 IO 顶掉（整块高度改变 → 页面跳一下），参数页签同
   * 理。统一的处理是「还没就绪就不渲染页签内容」——container 用 min-h-0 撑满
   * 父级，切换不会闪出占位文案，也不会出现半渲染的中间态。 */
  if (isLoading) return null;

  return (
    <>
      {tab === "canvas" && (
        /* 画布页签**吃满可用高度**（不再钉在 420px）：用户把详情面板看全屏时，
         *  画布要一直铺到面板底部，下面不留一块面板底色（ISSUE #596）。高度链条
         *  靠 flex 传下去 —— 外层的 `min-h-0 flex-1` 与本层的 `h-full` 缺一不可。 */
        <div className="border-border bg-panel-deep flex h-full min-h-[420px] flex-col rounded-2xl border p-1">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-ink-faint text-xs font-medium">
              画布样式预览（与项目画布节点一致，可直接运行调试）
            </span>
            <Button
              variant="primary"
              size="xs"
              onClick={onEdit}
              className="h-auto gap-1 rounded-md px-2 py-1 text-[11px]"
            >
              <Maximize2 className="h-3 w-3" />
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
              <WorkflowCanvasNodePreview
                key={workflow.id}
                workflowId={workflow.id}
                workflowName={workflow.name}
                taskType={workflow.taskType}
                workflowIO={workflowIO}
                paramMap={paramMap}
                usable={usable}
                modes={meta?.modes}
                defaultMode={meta?.defaultMode}
                onModeChange={(code) => {
                  meta?.onModeChange(code);
                }}
                onSeedModeChange={onSeedModeChange}
                onPatchParamMap={onPatchParamMap}
              />
            </div>
          </div>
        </div>
      )}

      {tab === "params" && (
        <WorkshopEncapsulationPanel
          key={workflow.id}
          workflowId={workflow.id}
          displayName={workflow.modelTags?.[0] ?? workflow.name}
          workflowIO={workflowIO}
          paramMap={paramMap}
          mode={
            workflow.defaultMode ??
            workflow.taskType ??
            workflow.modes?.[0] ??
            null
          }
        />
      )}

      {tab === "source" && (
        <div className="border-border bg-panel-deep rounded-2xl border p-1">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-ink-faint text-xs font-medium">
              工作流(RAW)格式原件
            </span>
          </div>
          <div className="bg-canvas-deep max-h-[70vh] overflow-auto rounded-xl">
            {sourceData?.source != null ? (
              <JsonViewer
                data={sourceData.source}
                title="工作流(RAW)格式"
                initialCollapsedDepth={2}
              />
            ) : (
              <p className="text-ink-fainter px-4 py-10 text-center text-xs">
                暂无源文件数据
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
