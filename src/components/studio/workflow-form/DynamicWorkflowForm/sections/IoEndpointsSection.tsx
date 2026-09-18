import {
  ioLabel,
  typeDisplay,
  type EnrichedWidget,
  type WorkflowIOEntry,
} from "../../../workflow-io";
import { SectionHeader } from "../SectionHeader";

interface IoEndpointsSectionProps {
  /** Wire-only inputs (必须连线) — rendered as read-only chips. */
  wireInputs: EnrichedWidget[];
  /** 全部已富化输入；传给 ioLabel() 做冲突感知标签。 */
  inputs: EnrichedWidget[];
  outputs: (WorkflowIOEntry & { ioKey: string })[];
  showOutputs: boolean;
}

/* 宽版「I/O 端点」段 (非 compact，CreatePanel / IO-edit 预览)：wire inputs
 *  (蓝色 chip) + outputs (绿色 chip)，带 SectionHeader 分段头。 */
export function IoEndpointsSection({
  wireInputs,
  inputs,
  outputs,
  showOutputs,
}: IoEndpointsSectionProps) {
  return (
    <>
      <SectionHeader
        label="I/O 端点"
        count={wireInputs.length + (showOutputs ? outputs.length : 0)}
        accent="#5BC6FF"
      />
      {wireInputs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {wireInputs.map((wireInput) => {
            /* conflict-aware：两个 pin 撞名时 ioLabel() 会回退到原始 name，
             * 因此必须传全量 pin，而不只是当前这一段。 */
            const label = ioLabel(wireInput, [...inputs, ...outputs]);
            return (
              <span
                key={wireInput.ioKey}
                className="border-info/25 bg-info/10 text-info inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px]"
                title={`${wireInput.nodeTitle ?? ""} · ${wireInput.name} · 仅可通过连线输入`}
              >
                <span className="bg-info h-1.5 w-1.5 rounded-full" />
                {label}
                {/* chip 打印 pin 真实类型（含 IMAGEUPLOAD 等自定义类型）。 */}
                <span className="font-mono text-[9px] opacity-70">
                  {typeDisplay(wireInput.type)}
                </span>
              </span>
            );
          })}
        </div>
      )}
      {wireInputs.length > 0 && outputs.length > 0 && showOutputs && (
        <div className="border-border-strong h-px shrink-0 border-t border-dashed" />
      )}
      {showOutputs && outputs.length > 0 && (
        <>
          <div className="flex items-center gap-1.5 pt-1">
            <span className="text-ink-muted text-[10px] font-medium">
              输出端点
            </span>
            <div className="border-border-subtle flex-1 border-t border-dashed" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {outputs.map((output) => (
              <span
                key={output.ioKey}
                className="border-success/25 bg-success/10 text-success inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px]"
                title={`${output.nodeTitle ?? ""} · ${output.name}`}
              >
                <span className="bg-success h-1.5 w-1.5 rounded-full" />
                {/* conflict-aware：同上，撞名时回退到原始 name。 */}
                {ioLabel(output, [...inputs, ...outputs])}
                <span className="font-mono text-[9px] opacity-70">
                  {typeDisplay(output.type)}
                </span>
              </span>
            ))}
          </div>
        </>
      )}
    </>
  );
}
