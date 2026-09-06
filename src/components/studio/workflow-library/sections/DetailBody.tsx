"use client";

// 详情面板主体：画布预览 / 参数配置 / 源文件三个页签的内容。纯展示。

import { useState } from "react";
import { Maximize2 } from "lucide-react";

import type { SourceModalData } from "~/components/studio/SourceModal";
import { DynamicWorkflowForm } from "~/components/studio/shared/DynamicWorkflowForm";
import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import { JsonViewer } from "~/components/studio/ui/JsonViewer";
import type { DetailTab } from "../workflow-library-detail-config";
import type { WorkflowRow } from "../workflow-library-config";
import { WorkflowCanvasNodePreview } from "../WorkflowCanvasNodePreview";

interface DetailBodyProps {
  workflow: WorkflowRow;
  activeTab: DetailTab;
  isLoading: boolean;
  workflowIO: WorkflowIOMap | null;
  sourceData: SourceModalData | null;
  usable: boolean;
  onEdit: () => void;
  /** 多模式工作流的模式切换（画布预览节点的类型 chip 可点选默认模式）。 */
  meta?: {
    modes: string[];
    defaultMode: string;
    onModeChange: (code: string) => void;
  };
  /** seed 类参数的「控件后行为」持久化（画布预览节点与 IO 编辑一致）。 */
  onSeedModeChange?: (ioKey: string, mode: string) => void;
}

export function DetailBody({
  workflow,
  activeTab,
  isLoading,
  workflowIO,
  sourceData,
  usable,
  onEdit,
  meta,
  onSeedModeChange,
}: DetailBodyProps) {
  return (
    <>
      {isLoading && (
        <div className="flex h-40 items-center justify-center text-xs text-(--color-ink-fainter)">
          加载详情中…
        </div>
      )}

      {activeTab === "canvas" && (
        <div className="flex h-full min-h-[420px] flex-col rounded-2xl border border-(--color-border) bg-(--color-panel-deep) p-1">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-medium text-(--color-ink-faint)">
              画布样式预览（与项目画布节点一致，可直接运行调试）
            </span>
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-violet-600 transition-colors hover:bg-violet-500/10"
            >
              <Maximize2 className="h-3 w-3" />
              在编辑器中打开
            </button>
          </div>
          <div className="flex min-h-0 flex-1 justify-center overflow-y-auto px-2 py-4">
            <WorkflowCanvasNodePreview
              workflowId={workflow.id}
              workflowName={workflow.name}
              taskType={workflow.taskType}
              workflowIO={workflowIO}
              usable={usable}
              modes={meta?.modes}
              defaultMode={meta?.defaultMode}
              onModeChange={meta?.onModeChange}
              onSeedModeChange={onSeedModeChange}
            />
          </div>
        </div>
      )}

      {activeTab === "params" && (
        <div
          key={workflow.id}
          className="mx-auto max-w-2xl rounded-2xl border border-(--color-border) bg-(--color-panel-deep) p-4"
        >
          <h3 className="mb-3 text-sm font-medium text-(--color-ink-strong)">可配置参数</h3>
          <WorkflowParamForm io={workflowIO} workflowId={workflow.id} />
        </div>
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

/** 参数表单持有自己的草稿值：这里只是预览可配置项，写回父级没有意义。 */
function WorkflowParamForm({
  io,
  workflowId,
}: {
  io: WorkflowIOMap | null;
  workflowId: string;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  return (
    <DynamicWorkflowForm
      io={io}
      values={values}
      onChange={setValues}
      workflowId={workflowId}
    />
  );
}
