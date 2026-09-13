"use client";

// 详情面板主体：画布预览 / 参数配置 / 源文件三个页签的内容。纯展示。

import { useState } from "react";
import { Maximize2 } from "lucide-react";

import type { SourceModalData } from "~/components/studio/SourceModal";
import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import { JsonViewer } from "~/components/studio/ui/JsonViewer";
import type { DetailTab } from "../workflow-library-detail-config";
import type { WorkflowRow } from "../workflow-library-config";
import { WorkflowCanvasNodePreview } from "../WorkflowCanvasNodePreview";
import { WorkshopEncapsulationPanel } from "./WorkshopEncapsulationPanel";

interface DetailBodyProps {
  workflow: WorkflowRow;
  activeTab: DetailTab;
  isLoading: boolean;
  workflowIO: WorkflowIOMap | null;
  /** 模板 paramMap（对外参数落点），画布节点页签据此标出对外参数与落点。 */
  paramMap: Record<string, unknown>;
  sourceData: SourceModalData | null;
  usable: boolean;
  /** 在编辑器中打开当前工作流；入参是**当前生效模式** —— 用户在库里选了哪个
   *  模式，编辑器就落在同一个模式上（不再固定打开默认模式）。 */
  onEdit: (mode?: string | null) => void;
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
  activeTab,
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
  /* 「在编辑器中打开」要带上的模式：默认取工作流默认模式，用户在画布预览里
   *  切换模式后跟着它走 —— 编辑器打开时落在同一个模式上，连线与落点不会换成
   *  另一套（不带的话看起来就像「我连的线丢了」）。 */
  const [editorMode, setEditorMode] = useState<string | null>(
    meta?.defaultMode ?? null,
  );

  if (isLoading) return null;

  return (
    <>
      {activeTab === "canvas" && (
        <div className="flex h-full min-h-[420px] flex-col rounded-2xl border border-(--color-border) bg-(--color-panel-deep) p-1">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-medium text-(--color-ink-faint)">
              画布样式预览（与项目画布节点一致，可直接运行调试）
            </span>
            <button
              type="button"
              onClick={() => onEdit(editorMode)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-violet-600 transition-colors hover:bg-violet-500/10"
            >
              <Maximize2 className="h-3 w-3" />
              在编辑器中打开
            </button>
          </div>
          {/* 画布预览：宿主运行卡片居中，两侧各并排一列卡片 —— 左侧是「对外
              输入参数」（要什么、落到哪一行），右侧是「对外输出参数」（给什么）。
              三列一起参与居中，不用固定留白挂靠；窄面板放不下时由 outer 的
              `overflow-auto` 横向滚动。 */}
          <div className="flex min-h-0 flex-1 justify-center overflow-auto px-2 py-4">
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
                setEditorMode(code);
                meta?.onModeChange(code);
              }}
              onSeedModeChange={onSeedModeChange}
              onPatchParamMap={onPatchParamMap}
            />
          </div>
        </div>
      )}

      {activeTab === "params" && (
        <WorkshopEncapsulationPanel
          key={workflow.id}
          workflowId={workflow.id}
          displayName={workflow.modelTags?.[0] ?? workflow.name}
          workflowIO={workflowIO}
          paramMap={paramMap}
          mode={workflow.defaultMode ?? workflow.taskType ?? workflow.modes?.[0] ?? null}
        />
      )}

      {activeTab === "source" && (
        <div className="rounded-2xl border border-(--color-border) bg-(--color-panel-deep) p-1">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-medium text-(--color-ink-faint)">
              {sourceData?.isApiFallback ? "可执行图（无原始文件）" : "原始导入 JSON"}
            </span>
          </div>
          <div className="max-h-[70vh] overflow-auto rounded-xl bg-black/30">
            {sourceData?.source != null ? (
              <JsonViewer
                data={sourceData.source}
                title={sourceData.isApiFallback ? "API 格式" : "源文件"}
                initialCollapsedDepth={2}
              />
            ) : (
              <p className="px-4 py-10 text-center text-xs text-(--color-ink-fainter)">暂无源文件数据</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
