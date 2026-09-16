"use client";

/* 工作流库「画布节点」预览的**宿主运行卡片**（三列里的中间那个节点）。
 *
 * 它是 `WorkflowCanvasNodePreview` 的主体：与项目画布节点同构的头（状态胶囊）、
 * chips 双行（来源 / 模型 / 工作流 / 模式）、参数表单、输出行、生成按钮。
 *
 * 为什么单独成文件：它现在跑在 React Flow 的**节点**里（ISSUE #529），而节点
 * 需要一眼看清「哪一段是卡片本体、哪一段是端点」—— 表单与输出行的端点由表单层
 * 自己渲染 `<Handle>`（`withHandle` 口径），这个文件只负责组装结构。
 *
 * 刻意不接 `@xyflow/react`：卡片本体与端点注入解耦，端点长什么样由
 * `DynamicWorkflowForm` / `WorkflowNodeParts` 决定（与项目画布同一份）。
 */

import type { RefObject } from "react";

import type { WorkflowIOEntry } from "@/components/studio/shared/workflow-io";
import { DarkSelect } from "~/components/studio/ui/DarkSelect";
import { modeLabel } from "./workflow-library-config";
import { WorkflowNodeOutputsRow } from "../shared/WorkflowNodeParts";
import { PortHandle } from "../shared/WorkflowPortHandle";
import {
  WorkflowNodeCardShell,
  WorkflowNodeDivider,
  WorkflowNodeHeader,
  WorkflowNodePill,
  WorkflowStaticChip,
} from "../shared/WorkflowNodeParts";

export interface LibraryHostCardProps {
  workflowName: string;
  /** 状态胶囊文案（待开始 / 提交中… / 生成中 n% / 已完成 / 失败）。 */
  statusLabel: string;
  running: boolean;
  /** 运行阶段（决定状态点配色）。 */
  phaseKind: "idle" | "starting" | "running" | "done" | "failed";
  modes?: string[];
  effectiveMode: string | null;
  taskType: string;
  effectiveModeLabel: string;
  onModeChange?: (code: string) => void;
  /** 宿主卡片的 DOM 引用（落点可达性收集用它，见 `reachableKeys`）。 */
  hostRef?: RefObject<HTMLDivElement | null>;
  /** 参数表单（`DynamicWorkflowForm` compact —— 端点由它自己渲染）。 */
  form: React.ReactNode;
  /** 工作流的输出行（`splitWorkflowIO` 的结果）。 */
  outputs: readonly (WorkflowIOEntry & { ioKey: string })[];
  inputs: readonly (WorkflowIOEntry & { ioKey: string })[];
  /** 生成按钮。 */
  actions: React.ReactNode;
}

export function LibraryHostCard({
  workflowName,
  statusLabel,
  running,
  phaseKind,
  modes,
  effectiveMode,
  taskType,
  effectiveModeLabel,
  onModeChange,
  hostRef,
  form,
  outputs,
  inputs,
  actions,
}: LibraryHostCardProps) {
  return (
    <div ref={hostRef} className="relative">
      <WorkflowNodeCardShell>
        <WorkflowNodeHeader
          title={workflowName}
          right={
            <WorkflowNodePill>
              <span
                className={[
                  "h-1.5 w-1.5 rounded-full",
                  running
                    ? "animate-pulse bg-amber-300"
                    : phaseKind === "done"
                      ? "bg-emerald-400"
                      : phaseKind === "failed"
                        ? "bg-rose-400"
                        : "bg-primary",
                ].join(" ")}
              />
              <span
                className="text-ink-soft text-[10px] font-medium"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                {statusLabel}
              </span>
            </WorkflowNodePill>
          }
        />

        <WorkflowNodeDivider />

        {/* chips 双行：与画布 WorkflowNode 同构（Row1 来源+模型，Row2 工作流+模式）；
         *  库内为只读语境，固定「本机 / 全部模型 / 当前工作流 / 任务类型」。 */}
        <div className="flex flex-col gap-1 pr-[14px] pb-1.5 pl-[14px]">
          <div className="flex h-7 min-w-0 items-center gap-1">
            <WorkflowStaticChip>
              <span className="bg-success-strong h-1.5 w-1.5 rounded-full" />
              <span className="text-success-strong text-[11px] font-semibold">
                本机
              </span>
            </WorkflowStaticChip>
            <WorkflowStaticChip className="min-w-0 flex-1">
              <span className="text-ink-bright truncate text-[11px] font-semibold">
                全部模型
              </span>
            </WorkflowStaticChip>
          </div>
          <div className="flex h-7 min-w-0 items-center gap-1">
            <WorkflowStaticChip className="min-w-0 flex-1" title={workflowName}>
              <span className="text-ink-bright truncate text-[11px] font-semibold">
                {workflowName}
              </span>
            </WorkflowStaticChip>
            {modes && modes.length > 1 && onModeChange ? (
              /* 多模式：类型 chip 变成模式切换下拉（与工作流库「类型」同码表） */
              <DarkSelect
                value={effectiveMode ?? taskType}
                onChange={(code) => onModeChange(code)}
                options={modes}
                labels={Object.fromEntries(
                  modes.map((code) => [code, modeLabel(code)]),
                )}
                popoverMinWidth={150}
                autoFitFromOptions={false}
                className="!border-border-strong shrink-0 !bg-transparent text-[11px]"
              />
            ) : (
              <WorkflowStaticChip>
                <span className="text-ink-bright text-[11px] font-medium">
                  {effectiveModeLabel || "—"}
                </span>
              </WorkflowStaticChip>
            )}
          </div>
        </div>

        {form}

        {/* outputs 行：与画布 outputs labelRow 同构，**带输出端点圆点**。
            用户口径是「红框中的输出端口也要有端口圆点」（ISSUE #355）：输出行
            右侧的圆点与项目画布上同一颗（`PortHandle`，在 React Flow 节点里
            就是真正的 `<Handle>`），右侧那列「对外输出参数」卡片再从这颗圆点
            连出去（ISSUE #529）。 */}
        {outputs.length > 0 && (
          <div className="border-border-subtle border-t">
            {outputs.map((output) => (
              <WorkflowNodeOutputsRow
                key={output.nodeId + ":" + output.name}
                output={output}
                inputs={[...inputs]}
                outputs={[...outputs]}
                renderHandle={({ id, dir, type }) => (
                  <PortHandle
                    id={id}
                    dir={dir}
                    type={type}
                    style={{
                      right: -6,
                      top: 14,
                      transform: "translateY(-50%)",
                      boxShadow: "none",
                    }}
                  />
                )}
              />
            ))}
          </div>
        )}

        {actions}
      </WorkflowNodeCardShell>
    </div>
  );
}
