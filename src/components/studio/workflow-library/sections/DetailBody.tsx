"use client";

// 详情面板主体：画布预览 / 参数配置 / 源文件三个页签的内容。纯展示。

import { useMemo, useState } from "react";
import { Maximize2 } from "lucide-react";

import type { SourceModalData } from "~/components/studio/SourceModal";
import { DynamicWorkflowForm } from "~/components/studio/shared/DynamicWorkflowForm";
import {
  defaultInputValues,
  mergeRefreshedDefaults,
  type WorkflowIOMap,
} from "~/components/studio/shared/workflow-io";
import { JsonViewer } from "~/components/studio/ui/JsonViewer";
import type { DetailTab } from "../workflow-library-detail-config";
import type { WorkflowRow } from "../workflow-library-config";
import { WorkflowCanvasNodePreview } from "../WorkflowCanvasNodePreview";

interface DetailBodyProps {
  workflow: WorkflowRow;
  activeTab: DetailTab;
  isLoading: boolean;
  workflowIO: WorkflowIOMap | null;
  /** 模板 paramMap（对外参数落点），画布节点页签据此标出对外参数与落点。 */
  paramMap: Record<string, unknown>;
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
  paramMap,
  sourceData,
  usable,
  onEdit,
  meta,
  onSeedModeChange,
}: DetailBodyProps) {
  /* 换工作流 / 首次打开时详情查询尚未排空：此时表单拿不到 IO，预览会先渲染
   * 一遍无参卡片再被真实 IO 顶掉（整块高度改变 → 页面跳一下），参数页签同
   * 理。统一的处理是「还没就绪就不渲染页签内容」——container 用 min-h-0 撑满
   * 父级，切换不会闪出占位文案，也不会出现半渲染的中间态。 */
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
              onClick={onEdit}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-violet-600 transition-colors hover:bg-violet-500/10"
            >
              <Maximize2 className="h-3 w-3" />
              在编辑器中打开
            </button>
          </div>
          {/* 画布预览：宿主运行卡片居中；工作流暴露了对外参数时，左侧并排一列
              只读的对外参数卡片（与宿主卡片一起参与居中，不用固定留白挂靠）。 */}
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

/** 参数配置页签的表单：值只是本地草稿，不回写父级。
 *
 *  默认值刷新（保覆盖）：IO 编辑里改了默认值后回到本页签，未覆盖的参数要
 *  跟着刷新到新默认值，用户改过的参数保持原值（ISSUE #288）。入参带
 *  `key={workflow.id}` —— 换工作流时整个组件重建，播种基线随之重置。 */
function WorkflowParamForm({
  io,
  workflowId,
}: {
  io: WorkflowIOMap | null;
  workflowId: string;
}) {
  /* 值 + 播种基线一起持有：基线是判断「用户有没有改过这一格」的唯一依据，
   * 必须和值同步更新（见 mergeRefreshedDefaults）。 */
  const [state, setState] = useState<{
    seededFor: string | null;
    values: Record<string, unknown>;
    baseline: Record<string, unknown>;
  }>({ seededFor: null, values: {}, baseline: {} });

  /* 播种走渲染期校正（而非 effect）：effect 内同步 setState 会触发级联渲染，
   * 被 lint 的 set-state-in-effect 拦下；渲染期校正由 React 立即重跑本组件，
   * 用户看不到中间态。 */
  const defaults = useMemo(() => (io ? defaultInputValues(io, null) : null), [io]);
  if (defaults && state.seededFor !== workflowId) {
    /* 首次播种 / 换了工作流：整表采用默认值。 */
    setState({ seededFor: workflowId, values: defaults, baseline: defaults });
  } else if (defaults && state.baseline !== defaults) {
    /* IO 变了（作者在编辑器里改了默认值）：只刷新未被用户覆盖的格子。 */
    const merged = mergeRefreshedDefaults(state.values, state.baseline, defaults);
    setState({
      seededFor: workflowId,
      values: merged ?? state.values,
      baseline: defaults,
    });
  }

  return (
    <DynamicWorkflowForm
      io={io}
      values={state.values}
      onChange={(next) => setState((prev) => ({ ...prev, values: next }))}
      workflowId={workflowId}
    />
  );
}
