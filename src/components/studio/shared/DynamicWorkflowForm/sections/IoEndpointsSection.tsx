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
 *  (蓝色 chip) + outputs (绿色 chip)，带 SectionHeader 分段头。 */
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
            /* conflict-aware：两个 pin 撞名时 ioLabel() 会回退到原始 name，
             * 因此必须传全量 pin，而不只是当前这一段。 */
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
                {/* conflict-aware：同上，撞名时回退到原始 name。 */}
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
