import { ioLabel, type EnrichedWidget, type WorkflowIOEntry } from "../../workflow-io";
import { normalizeTypeChip } from "../../WorkflowFormControls";
import { SectionHeader } from "../SectionHeader";

interface IoEndpointsSectionProps {
  /** Wire-only inputs (必须连线) — rendered as read-only chips. */
  wireInputs: EnrichedWidget[];
  /** All enriched inputs; passed to ioLabel() for conflict-aware labels. */
  inputs: EnrichedWidget[];
  outputs: (WorkflowIOEntry & { ioKey: string })[];
  showOutputs: boolean;
}

/* 宽版「I/O 端点」段 (非 compact，CreatePanel / IO-edit 预览)：wire inputs
 *  (蓝色 chip) + outputs (绿色 chip)，带 SectionHeader 分段头。逐字搬移自
 *  原主组件的非 compact 分支，行为不变。 */
export function IoEndpointsSection({ wireInputs, inputs, outputs, showOutputs }: IoEndpointsSectionProps) {
  return (
    <>
      <SectionHeader
        label="I/O 端点"
        count={wireInputs.length + (showOutputs ? outputs.length : 0)}
        accent="#5BC6FF"
      />
      {wireInputs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {wireInputs.map((wireInput) =>
{
            /* 2026-08-15: conflict-aware — see ioLabel() in
             *  src/components/updream/shared/workflow-io.ts. */
            const label = ioLabel(wireInput, [...inputs, ...outputs]);
            return (
              <span
                key={wireInput.ioKey}
                className="inline-flex items-center gap-1 rounded-md border border-(--color-info)/25 bg-(--color-info)/10 px-1.5 py-0.5 text-[10px] text-(--color-info)"
                title={`${wireInput.nodeTitle ?? ""} · ${wireInput.name} · 仅可通过连线输入`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-(--color-info)" />
                {label}
                <span className="font-mono text-[9px] opacity-70">{wireInput.type}</span>
              </span>
            );
          })}
        </div>
      )}
      {wireInputs.length > 0 && outputs.length > 0 && showOutputs && (
        <div className="h-px shrink-0 border-t border-dashed border-white/6" />
      )}
      {showOutputs && outputs.length > 0 && (
        <>
          <div className="flex items-center gap-1.5 pt-1">
            <span className="text-[10px] font-medium text-gray-500">输出端点</span>
            <div className="flex-1 border-t border-dashed border-white/4" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {outputs.map((output) =>
(
              <span
                key={output.ioKey}
                className="inline-flex items-center gap-1 rounded-md border border-(--color-success)/25 bg-(--color-success)/10 px-1.5 py-0.5 text-[10px] text-(--color-success)"
                title={`${output.nodeTitle ?? ""} · ${output.name}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-(--color-success)" />
                {/* 2026-08-15: conflict-aware — see ioLabel(). */}
                {ioLabel(output, [...inputs, ...outputs])}
                <span className="font-mono text-[9px] opacity-70">{normalizeTypeChip(output.type)}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </>
  );
}
