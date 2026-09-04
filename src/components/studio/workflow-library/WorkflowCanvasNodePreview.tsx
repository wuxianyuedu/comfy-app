"use client";

/**
 * WorkflowCanvasNodePreview — 工作流库的「画布样式预览」。
 *
 * 用与项目画布一致（Ardot v5 token：W 图标头 + 状态胶囊 + 本机/工作流/类型
 * chips + 端口行 + 渐变 ActionBtn）的节点卡片呈现当前工作流的输入参数与输出，
 * 并支持就地运行（generate.generate → SSE 任务流）：进度、结果图、错误全部
 * 内联展示，方便不进画布就调试工作流。
 *
 * 与画布的差异：这里是单节点静态环境（无连线），wire 类输入以表单控件呈现，
 * 值为空时不下发、由 ComfyUI 侧工作流自带默认值兜底。
 */

import { useMemo, useRef, useState } from "react";
import {
  startLocalGenerate,
  watchTask,
  type TaskProgressNode,
} from "@/lib/workshop/generation-client";
import { DynamicWorkflowForm } from "../shared/DynamicWorkflowForm";
import {
  getMissingRequiredInputs,
  splitWorkflowIO,
  toWorkflowInputsPayload,
  type WorkflowIOMap,
} from "../shared/workflow-io";
import {
  WorkflowNodeActionButton,
  WorkflowNodeCardShell,
  WorkflowNodeDivider,
  WorkflowNodeHeader,
  WorkflowNodeOutputsRow,
  WorkflowNodePill,
  WorkflowStaticChip,
} from "../shared/WorkflowNodeParts";

type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "running"; pct: number; node?: TaskProgressNode }
  | { kind: "done"; imageUrl?: string }
  | { kind: "failed"; message: string };

interface Props {
  workflowId: string;
  workflowName: string;
  taskType: string;
  workflowIO: WorkflowIOMap | null;
  usable: boolean;
}

export function WorkflowCanvasNodePreview({
  workflowId,
  workflowName,
  taskType,
  workflowIO,
  usable,
}: Props) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  // onOutput 与 onSettled 都来自同一 SSE 闭包，state 读取会拿到渲染期旧值——
  // 用 ref 保证 onSettled 能看到 onOutput 刚写入的结果图。
  const resultUrlRef = useRef<string | null>(null);

  const running = phase.kind === "running" || phase.kind === "starting";
  const missing = useMemo(
    () => (workflowIO ? getMissingRequiredInputs(workflowIO, values) : []),
    [workflowIO, values],
  );
  const canRun = usable && !running && missing.length === 0;
  /* 与画布 WorkflowNode 同源的双行结构：inputs 由 DynamicWorkflowForm(compact)
   * 渲染（库内无 React Flow 上下文，不带端点），outputs 单独成段在表单之后。 */
  const { inputs, outputs } = splitWorkflowIO(workflowIO);

  const statusLabel =
    phase.kind === "running"
      ? `生成中 ${phase.pct}%`
      : phase.kind === "starting"
        ? "提交中…"
        : phase.kind === "done"
          ? "已完成"
          : phase.kind === "failed"
            ? "失败"
            : "待开始";

  async function run() {
    if (!canRun) return;
    setResultUrl(null);
    resultUrlRef.current = null;
    setPhase({ kind: "starting" });
    try {
      const workflowInputs = toWorkflowInputsPayload(
        workflowIO ?? undefined,
        values,
      );
      const taskId = await startLocalGenerate({
        workflow: workflowId,
        workflowInputs,
      });
      setPhase({ kind: "running", pct: 0 });
      await new Promise<void>((resolve) => {
        watchTask(taskId, {
          onProgress: (pct, node: TaskProgressNode | undefined) =>
            setPhase({ kind: "running", pct, ...(node ? { node } : {}) }),
          onOutput: (out) => {
            if (out.kind === "image" && out.url) {
              resultUrlRef.current = out.url;
              setResultUrl(out.url);
            }
          },
          onSettled: (r) => {
            if (r.ok) {
              setPhase({
                kind: "done",
                imageUrl: resultUrlRef.current ?? undefined,
              });
            } else {
              setPhase({ kind: "failed", message: r.message ?? "生成失败" });
            }
            resolve();
          },
        });
      });
    } catch (e) {
      setPhase({
        kind: "failed",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const pct = phase.kind === "running" ? phase.pct : 0;
  const nodeLabel =
    phase.kind === "running" && phase.node?.label ? phase.node.label : null;

  return (
    <div className="flex min-h-[420px] flex-col items-center gap-3 rounded-2xl border border-white/8 bg-[#0B0B10] p-6">
      <p className="self-start text-xs font-medium text-white/60">
        画布样式预览（与项目画布节点一致，可直接运行调试）
      </p>

      {/* ── 画布同款节点卡片：唯一视觉源在 shared/workflow-node-parts ── */}
      <WorkflowNodeCardShell>
        <WorkflowNodeHeader
          title={workflowName}
          right={
            <WorkflowNodePill>
              <span
                className={[
                  "h-1.5 w-1.5 rounded-full",
                  phase.kind === "running" || phase.kind === "starting"
                    ? "animate-pulse bg-amber-300"
                    : phase.kind === "done"
                      ? "bg-emerald-400"
                      : phase.kind === "failed"
                        ? "bg-rose-400"
                        : "bg-(--color-primary)",
                ].join(" ")}
              />
              <span
                className="text-[10px] font-medium text-(--color-ink-soft)"
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
              <span className="h-1.5 w-1.5 rounded-full bg-[#33D499]" />
              <span className="text-[11px] font-semibold text-[#33D499]">
                本机
              </span>
            </WorkflowStaticChip>
            <WorkflowStaticChip className="min-w-0 flex-1">
              <span className="truncate text-[11px] font-semibold text-(--color-ink-bright)">
                全部模型
              </span>
            </WorkflowStaticChip>
          </div>
          <div className="flex h-7 min-w-0 items-center gap-1">
            <WorkflowStaticChip className="min-w-0 flex-1" title={workflowName}>
              <span className="truncate text-[11px] font-semibold text-(--color-ink-bright)">
                {workflowName}
              </span>
            </WorkflowStaticChip>
            <WorkflowStaticChip>
              <span className="text-[11px] font-medium text-(--color-ink-bright)">
                {taskType || "—"}
              </span>
            </WorkflowStaticChip>
          </div>
        </div>

        {/* 动态表单：与画布同一渲染器。注意不能加 `compact`——compact 的
         *  端口行会渲染 React Flow 的 <Handle>，需要 ReactFlowProvider
         *  祖先，库内没有（reactflow.dev/error#001）；showOutputs=false
         *  与画布一致，outputs 由下方 WorkflowNodeOutputsRow 呈现。 */}
        <DynamicWorkflowForm
          io={workflowIO ?? undefined}
          values={values}
          onChange={setValues}
          showOutputs={false}
          workflowId={workflowId}
        />

        {/* outputs 行：与画布 outputs labelRow 镜像同构（库内无端点） */}
        {outputs.length > 0 && (
          <div className="border-t border-white/6">
            {outputs.map((output) => (
              <WorkflowNodeOutputsRow
                key={output.nodeId + ":" + output.name}
                output={output}
                inputs={inputs}
                outputs={outputs}
              />
            ))}
          </div>
        )}

        <WorkflowNodeActionButton
          label={running ? `生成中 ${pct}%` : "▶ 用此工作流生成"}
          disabled={!canRun}
          onClick={run}
          title={
            missing.length > 0
              ? `必填参数未填：${missing.join("、")}`
              : undefined
          }
        />
      </WorkflowNodeCardShell>

      {/* 进度条（running 时） */}
      {phase.kind === "running" && (
        <div className="w-[340px]" aria-live="polite">
          <div className="mb-1 flex items-center justify-between text-[11px] text-white/60">
            <span>
              {nodeLabel ? `正在执行 ${nodeLabel}` : "正在执行工作流"}
              {phase.node ? `（${phase.node.value}/${phase.node.max}）` : ""}
            </span>
            <span className="font-medium text-violet-300">{pct}%</span>
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-white/8"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-linear-to-r from-violet-500 to-fuchsia-500 transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* 运行结果图 */}
      {resultUrl && (
        <div className="w-[340px]">
          <p className="mb-1 text-[11px] text-white/50">运行结果</p>
          <img
            src={resultUrl}
            alt="运行结果"
            className="w-full rounded-xl border border-white/10"
          />
        </div>
      )}

      {/* 错误 / 必填提示 */}
      {phase.kind === "failed" && (
        <div className="w-[340px] rounded-lg border border-red-500/20 bg-red-500/8 px-3 py-2 text-[11px] leading-relaxed text-red-300">
          {phase.message}
        </div>
      )}
      {!running && missing.length > 0 && (
        <p className="w-[340px] text-[11px] text-amber-300/80">
          必填参数未填：{missing.join("、")}
        </p>
      )}
    </div>
  );
}
