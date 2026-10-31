"use client";

/* ── 「实际使用」页签的简化视图（表单 + 生成按钮 + 日志入口 + 模式切换）──
 *
 * values / 生效模式 / seed 行为 / 运行相位都由容器
 * （<WorkflowCanvasNodePreview>）持有，本组件只负责把这一页签的控件摆出来。
 */

import { DynamicWorkflowForm } from "~/components/studio/workflow-form/DynamicWorkflowForm";
import { WorkflowNodeActionButton } from "~/components/studio/workflow-form/WorkflowNodeParts";
import { SelectMenu } from "~/components/ui/select-menu";
import type { WorkflowIOMap } from "../workflow-io";
import { WorkflowRunLogButton } from "./WorkflowRunLogButton";
import { modeLabel } from "./workflow-library-config";

interface Props {
  canRun: boolean;
  effectiveMode: string | null;
  effectiveModeLabel: string;
  logViewTaskId: string | null;
  /** 缺参提示人性化后的展示标签（pos text 等，不是 ioKey）。 */
  missingLabels: Array<string>;
  /** 多模式工作流：提供时右上角变成模式切换下拉。 */
  modes?: Array<string>;
  onModeChange?: (code: string) => void;
  onOpenLog: () => void;
  onSeedModeChange?: (ioKey: string, mode: string) => void;
  /** 素材上传的可见出口：ComfyUI 未运行 / 正在启动 / 启动超时都落在这里。 */
  onUploadNotice: (message: string) => void;
  onValuesChange: (
    next: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>),
  ) => void;
  pct: number;
  run: () => void;
  running: boolean;
  seedModes: Record<string, string>;
  taskType: string;
  values: Record<string, unknown>;
  workflowId: string;
  workflowIO: WorkflowIOMap | null;
  workflowName: string;
}

export function WorkflowPreviewUsePanel({
  workflowId,
  workflowName,
  workflowIO,
  effectiveMode,
  taskType,
  modes,
  onModeChange,
  effectiveModeLabel,
  values,
  onValuesChange,
  seedModes,
  onSeedModeChange,
  onUploadNotice,
  running,
  canRun,
  run,
  pct,
  missingLabels,
  logViewTaskId,
  onOpenLog,
}: Props) {
  return (
    <div className="flex w-full max-w-120 flex-col gap-3">
      <div className="border-border bg-panel rounded-xl border p-4">
        <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
          <span className="text-ink min-w-0 truncate text-sm font-semibold">{workflowName}</span>
          <WorkflowRunLogButton
            alwaysVisible
            onOpen={onOpenLog}
            source="canvas-node"
            taskId={logViewTaskId}
            workflowId={workflowId}
          />
          {/* 多模式工作流在这儿也要能换模式：两个页签读的是**同一个**
              生效模式（详情层持有），而 use 模式此前只把它当纯文本打出来
              —— 用户在「实际使用」里换不了模式，只能切回「编辑对外参数」
              再换（那一页的模式下拉在宿主卡片上）。形态与 `LibraryHostCard`
              的同一个下拉逐字一致，免得同一件事在两处长得不一样。 */}
          {modes && modes.length > 1 && onModeChange ? (
            <SelectMenu
              autoFitFromOptions={false}
              className="border-border-strong! text-2xs shrink-0 bg-transparent!"
              labels={Object.fromEntries(modes.map((code) => [code, modeLabel(code)]))}
              onChange={onModeChange}
              options={modes}
              popoverMinWidth={150}
              value={effectiveMode ?? taskType}
            />
          ) : (
            <span className="text-ink-faint shrink-0 text-xs">{effectiveModeLabel}</span>
          )}
        </div>
        <DynamicWorkflowForm
          compact
          io={workflowIO ?? undefined}
          mode={effectiveMode}
          onChange={onValuesChange}
          onSeedModeChange={onSeedModeChange}
          onUploadError={onUploadNotice}
          onUploadProgress={onUploadNotice}
          seedModes={seedModes}
          showOutputs={false}
          values={values}
          workflowId={workflowId}
        />
        <div className="mt-4">
          <WorkflowNodeActionButton
            disabled={!canRun}
            hint={
              missingLabels.length > 0 ? `必填参数未填：${missingLabels.join("、")}` : undefined
            }
            label={running ? `生成中 ${pct}%` : "▶ 用此工作流生成"}
            onClick={run}
          />
        </div>
      </div>
    </div>
  );
}
