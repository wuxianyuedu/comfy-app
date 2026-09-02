"use client";

// DynamicWorkflowForm 的纯展示视图：只消费 controller 与展示开关，不发请求、
// 不算业务规则，交互一律通过 controller / 回调上抛。

import type { ReactNode } from "react";

import { GroupedControls } from "~/components/studio/shared/GroupedControls";
import { WirePortRows } from "~/components/studio/shared/WorkflowFormControls";
import type { EnrichedWidget } from "~/components/studio/shared/workflow-io";
import type { DynamicWorkflowFormController } from "./hooks/use-dynamic-workflow-form";
import { SectionHeader } from "./SectionHeader";
import { EmptyStateHint } from "./sections/EmptyStateHint";
import { IoEndpointsSection } from "./sections/IoEndpointsSection";
import { LoadingSkeleton } from "./sections/LoadingSkeleton";
import { WidgetInputRow } from "./sections/WidgetInputRow";

interface DynamicWorkflowFormViewProps {
  controller: DynamicWorkflowFormController;
  loading: boolean;
  disabled: boolean;
  /** 画布节点版式：更紧凑的间距 + 单列。 */
  compact: boolean;
  showOutputs: boolean;
  emptyHint?: ReactNode;
  workflowId?: string;
  seedModes?: Record<string, string>;
  onSeedModeChange?: (ioKey: string, mode: string) => void;
  onLabelChange?: (ioKey: string, label: string) => void;
  onRequiredChange?: (ioKey: string, required: boolean) => void;
  onReorder?: (fromKey: string, beforeKey: string | null) => void;
}

export function DynamicWorkflowFormView({
  controller,
  loading,
  disabled,
  compact,
  showOutputs,
  emptyHint,
  workflowId,
  seedModes,
  onSeedModeChange,
  onLabelChange,
  onRequiredChange,
  onReorder,
}: DynamicWorkflowFormViewProps) {
  if (loading) return <LoadingSkeleton />;
  if (controller.isEmpty) return <EmptyStateHint emptyHint={emptyHint} />;

  const {
    values,
    onChange,
    inputs,
    outputs,
    wireInputs,
    groups,
    portEntries,
    widgetSectionEntries,
    fileRef,
    uploading,
    uploadTarget,
    pickFile,
    onFile,
    set,
    dragHandlers,
    draggingKey,
    dragOverKey,
    beginPortDrag,
    endDrag,
  } = controller;

  /* ioLabel() 需要全量 pin 才能在标签撞名时回退到原始 name。 */
  const allPins = [...inputs, ...outputs];

  const renderRow = (entry: EnrichedWidget, withHandle: boolean) => (
    <WidgetInputRow
      key={entry.ioKey}
      entry={entry}
      allPins={allPins}
      value={values[entry.ioKey]}
      compact={compact}
      disabled={disabled}
      uploading={uploading && uploadTarget === entry.ioKey}
      seedMode={seedModes?.[entry.ioKey]}
      onSeedModeChange={
        onSeedModeChange ? (mode: string) => onSeedModeChange(entry.ioKey, mode) : undefined
      }
      onValueChange={(next: unknown) => set(entry.ioKey, next)}
      onPickFile={() => pickFile(entry.ioKey)}
      onLabelChange={
        onLabelChange ? (label: string) => onLabelChange(entry.ioKey, label) : undefined
      }
      onRequiredChange={
        onRequiredChange
          ? (required: boolean) => onRequiredChange(entry.ioKey, required)
          : undefined
      }
      withHandle={withHandle}
    />
  );

  return (
    <div className={compact ? "space-y-0" : "space-y-3"}>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />

      {/* 可编辑参数（compact）：排在端口行之前，让所有输入行都压在输出之上。
       *  画布节点上去掉段头，避免引入节点稿之外的视觉噪音。 */}
      {compact && widgetSectionEntries.length > 0 && (
        <div className="space-y-0">
          {widgetSectionEntries.map((entry) => {
            const row = renderRow(entry, true);
            if (!dragHandlers) return row;

            const isDragging = draggingKey === entry.ioKey;
            const isDropTarget =
              dragOverKey === entry.ioKey && !!draggingKey && draggingKey !== entry.ioKey;

            return (
              <div
                key={entry.ioKey}
                draggable
                onDragStart={dragHandlers.onDragStart(entry.ioKey)}
                onDragOver={dragHandlers.onDragOver(entry.ioKey)}
                onDrop={dragHandlers.onDrop(entry.ioKey)}
                onDragEnd={dragHandlers.onDragEnd}
                className={`relative ${isDragging ? "opacity-50" : ""}`}
              >
                {/* 插入指示线只画在目标行顶边 —— 若整段都画会造成频闪。 */}
                {isDropTarget && (
                  <div className="pointer-events-none absolute inset-x-0 -top-px z-10 h-0.5 bg-violet-400 shadow-[0_0_8px_rgba(124,92,252,0.6)]" />
                )}
                {/* 手柄只是视觉提示（真正可拖来自父层的 draggable）；它自身
                 *  pointer-events-none，点击会落到下面的输入框上。 */}
                <div
                  className="pointer-events-none absolute right-1 top-1/2 z-5 -translate-y-1/2 select-none text-[10px] leading-[6px] text-white/30"
                  aria-hidden
                >
                  ⋮⋮
                </div>
                {row}
              </div>
            );
          })}
        </div>
      )}

      {/* 组合参数：dimension / video 组用单一下拉切换录入范式，避免
       *  width/height、时长/画质/比例 散落成多个独立框。 */}
      {(groups.dimension ?? groups.video) && (
        <GroupedControls
          dimension={groups.dimension}
          video={groups.video}
          values={values}
          onChange={onChange}
          workflowId={workflowId}
          compact={compact}
          disabled={disabled}
        />
      )}

      {/* I/O 端点：wire inputs（必须连线）+ outputs（供外部连线）。 */}
      {(portEntries.length > 0 || (showOutputs && outputs.length > 0)) && (
        <>
          {compact ? (
            <WirePortRows
              wireInputs={portEntries}
              outputs={showOutputs ? outputs : []}
              values={values}
              set={set}
              pickFile={pickFile}
              uploading={uploading}
              uploadTarget={uploadTarget}
              seedModes={seedModes}
              onSeedModeChange={onSeedModeChange}
              /* 双层守卫：外层已按 showOutputs 过滤 outputs，这里再显式透传，
               * 避免日后重构成别的判断方式时复活 images 行 + 紫圆点。 */
              showOutputs={showOutputs}
              draggingKey={draggingKey}
              dragOverKey={dragOverKey}
              onReorder={onReorder}
              onPortDragStart={beginPortDrag}
              onPortDragEnd={endDrag}
            />
          ) : (
            <IoEndpointsSection
              wireInputs={wireInputs}
              inputs={inputs}
              outputs={outputs}
              showOutputs={showOutputs}
            />
          )}
        </>
      )}

      {/* 可编辑参数（非 compact）：带段头的双段版本，给 CreatePanel 与
       *  IO-edit 预览面板用。 */}
      {!compact && widgetSectionEntries.length > 0 && (
        <>
          <SectionHeader
            label="可编辑参数"
            count={widgetSectionEntries.length}
            accent="#FF9C5B"
          />
          {widgetSectionEntries.map((entry) => renderRow(entry, false))}
        </>
      )}
    </div>
  );
}
