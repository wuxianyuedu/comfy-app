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
import { FileText } from "lucide-react";
import {
  startLocalGenerate,
  watchTask,
  type TaskLogEntry,
  type TaskProgressNode,
} from "@/lib/workshop/generation-client";
import { DarkSelect } from "~/components/studio/ui/DarkSelect";
import { DynamicWorkflowForm } from "../shared/DynamicWorkflowForm";
import {
  getMissingRequiredInputs,
  splitWorkflowIO,
  toWorkflowInputsPayload,
  type WorkflowIOMap,
} from "../shared/workflow-io";
import { seedModeOverrides } from "@/components/studio/project-canvas/CanvasNode/helpers";
import { modeLabel } from "./workflow-library-config";
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
  /** 多模式工作流：提供时第二行右侧的类型 chip 变成模式切换下拉。 */
  modes?: string[];
  defaultMode?: string;
  onModeChange?: (code: string) => void;
  /** seed 类参数「控件后行为」的持久化回调（与 IO 编辑一致）。 */
  onSeedModeChange?: (ioKey: string, mode: string) => void;
}

/* ── 执行日志行样式：与项目画布 GlobalStepLogPanel 同款 ────────────────
 * 级别徽章配色 / 时间格式与画布执行日志面板完全一致，保证工作流库里
 * 「就地运行」看到的日志与项目画布观感统一。 */
type LogLevel = TaskLogEntry["level"];
const LOG_LEVEL_STYLES: Record<LogLevel, string> = {
  error: "bg-rose-500/15 text-rose-400 border-rose-500/20",
  warn: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  success: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  progress: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  info: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
};
function logLevelBadge(level: LogLevel): string {
  switch (level) {
    case "error": return "ERROR";
    case "warn": return "WARN";
    case "success": return "OK";
    case "progress": return "PROG";
    default: return "INFO";
  }
}
/* 与应用日志同款，带毫秒。 */
function fmtLogTime(t: number): string {
  return new Date(t).toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

export function WorkflowCanvasNodePreview({
  workflowId,
  workflowName,
  taskType,
  workflowIO,
  usable,
  modes,
  defaultMode,
  onModeChange,
  onSeedModeChange,
}: Props) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  // onOutput 与 onSettled 都来自同一 SSE 闭包，state 读取会拿到渲染期旧值——
  // 用 ref 保证 onSettled 能看到 onOutput 刚写入的结果图。
  const resultUrlRef = useRef<string | null>(null);
  /* 就地运行的工作流执行步骤日志（SSE `log` 帧累积），与项目画布执行日志同款。
   * 用 ref 在 onSettled/onLog 异步闭包里读「本次是否成功」不会干扰日志累积。 */
  const [logs, setLogs] = useState<TaskLogEntry[]>([]);
  /* 执行日志折叠展开态；运行中自动展开，结束后可手动收起。 */
  const [logOpen, setLogOpen] = useState(false);
  /* 当前运行是否已结束（用于展开提示文案与折叠按钮显隐）。 */
  const [logDone, setLogDone] = useState(false);

  const running = phase.kind === "running" || phase.kind === "starting";
  const missing = useMemo(
    () => (workflowIO ? getMissingRequiredInputs(workflowIO, values) : []),
    [workflowIO, values],
  );
  /* 缺参提示人性化：ioKey（76::widget::text）→ 展示标签（pos text 等）。 */
  const missingLabels = useMemo(
    () =>
      missing.map((ioKey) => {
        const entry = workflowIO?.[ioKey];
        if (!entry) return ioKey;
        const fromInputs = splitWorkflowIO(workflowIO).inputs.find(
          (input) => input.ioKey === ioKey,
        );
        return fromInputs?.label ?? fromInputs?.name ?? ioKey;
      }),
    [missing, workflowIO],
  );
  const canRun = usable && !running && missing.length === 0;
  /* 与画布 WorkflowNode 同源的双行结构：inputs 由 DynamicWorkflowForm(compact)
   * 渲染（库内无 React Flow 上下文，不带端点），outputs 单独成段在表单之后。 */
  const { inputs, outputs } = splitWorkflowIO(workflowIO);

  /* seed 类参数的「控件后行为」：从 workflowIO 条目派生（与 IO 编辑同一存储）。 */
  const seedModes = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [ioKey, entry] of Object.entries(workflowIO ?? {})) {
      if (entry?.seedMode) map[ioKey] = entry.seedMode;
    }
    return map;
  }, [workflowIO]);

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
    setLogs([]);
    setLogDone(false);
    setLogOpen(true);
    setPhase({ kind: "starting" });
    try {
      const workflowInputs = toWorkflowInputsPayload(
        workflowIO ?? undefined,
        values,
      );
      /* seed「控件后行为」与画布运行同源：条目上配置了 seedMode 的参数
       * 附加 control_after_generate 输入，后端按 fixed/randomize 等处理。 */
      const cagInputs = seedModeOverrides(workflowIO ?? null, seedModes);
      const taskId = await startLocalGenerate({
        workflow: workflowId,
        workflowInputs: [...workflowInputs, ...cagInputs],
      });
      setPhase({ kind: "running", pct: 0 });
      await new Promise<void>((resolve) => {
        watchTask(taskId, {
          onProgress: (pct, node: TaskProgressNode | undefined) =>
            setPhase({ kind: "running", pct, ...(node ? { node } : {}) }),
          onLog: (entry) => setLogs((prev) => [...prev, entry]),
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
            setLogDone(true);
            resolve();
          },
        });
      });
    } catch (e) {
      setPhase({
        kind: "failed",
        message: e instanceof Error ? e.message : String(e),
      });
      setLogDone(true);
    }
  }

  const pct = phase.kind === "running" ? phase.pct : 0;
  const nodeLabel =
    phase.kind === "running" && phase.node?.label ? phase.node.label : null;

  return (
    /* 容器只做布局：边框/标题/背景由 DetailBody 的页签面板负责（此前在这里
     * 又包了一层同款边框 + 重复标题，出现「面板套面板」）。卡片宽 380，
     * 进度/结果/错误行与其对齐。 */
    <div className="flex w-full flex-col items-center gap-3">
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
            {modes && modes.length > 1 && onModeChange ? (
              /* 多模式：类型 chip 变成模式切换下拉（与工作流库「类型」同码表） */
              <DarkSelect
                value={defaultMode ?? taskType}
                onChange={(code) => onModeChange(code)}
                options={modes}
                labels={Object.fromEntries(modes.map((code) => [code, modeLabel(code)]))}
                popoverMinWidth={150}
                autoFitFromOptions={false}
                className="!bg-transparent !border-white/15 shrink-0 text-[11px]"
              />
            ) : (
              <WorkflowStaticChip>
                <span className="text-[11px] font-medium text-(--color-ink-bright)">
                  {modeLabel(taskType) || "—"}
                </span>
              </WorkflowStaticChip>
            )}
          </div>
        </div>

        {/* compact = 与项目画布节点完全同版的密度与结构（无「组合参数 /
         *  可编辑参数」等分组标题），库内预览对齐画布观感。端点圆点在
         *  非 React Flow 节点内由 PortHandle 降级为装饰。 */}
        <DynamicWorkflowForm
          io={workflowIO ?? undefined}
          values={values}
          onChange={setValues}
          showOutputs={false}
          compact
          seedModes={seedModes}
          onSeedModeChange={
            onSeedModeChange
              ? (ioKey: string, mode: string) => onSeedModeChange(ioKey, mode)
              : undefined
          }
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
            missingLabels.length > 0
              ? `必填参数未填：${missingLabels.join("、")}`
              : undefined
          }
        />
      </WorkflowNodeCardShell>

      {/* 进度条（running 时） */}
      {phase.kind === "running" && (
        <div className="w-[380px]" aria-live="polite">
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
        <div className="w-[380px]">
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
        <div className="w-[380px] rounded-lg border border-red-500/20 bg-red-500/8 px-3 py-2 text-[11px] leading-relaxed text-red-300">
          {phase.message}
        </div>
      )}
      {!running && missingLabels.length > 0 && (
        <p className="w-[380px] text-[11px] text-amber-300/80">
          必填参数未填：{missingLabels.join("、")}
        </p>
      )}

      {/* 执行步骤日志 —— 与项目画布执行日志同款行样式（时间 + 级别徽章 + 消息）。
       *  就地运行期间自动展开；结束后可手动收起/保留审查。 */}
      {logs.length > 0 && (
        <div className="w-[380px] overflow-hidden rounded-xl border border-white/8 bg-[#0B0B10]">
          <button
            type="button"
            onClick={() => setLogOpen((o) => !o)}
            title={logOpen ? "收起执行日志" : "展开执行日志"}
            className="flex w-full items-center justify-between gap-2 border-b border-white/6 bg-white/2 px-3 py-2 text-left"
          >
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-white/70">
              <FileText size={12} className="shrink-0 text-violet-400" />
              执行日志
              {!logDone && (
                <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" />
              )}
            </span>
            <span className="flex items-center gap-2 text-[10.5px] text-white/40">
              <span>{logs.length} 条</span>
              <span
                className={`inline-block transition-transform ${
                  logOpen ? "rotate-180" : ""
                }`}
              >
                ▾
              </span>
            </span>
          </button>
          {logOpen && (
            <div className="custom-scrollbar max-h-56 overflow-y-auto bg-[#0d0d14]/60">
              {logs.map((log, index) => (
                <div
                  key={`${log.t}:${index}`}
                  data-testid="wflib-log-line"
                  data-level={log.level}
                  className="flex items-start gap-2 border-b border-white/3 px-3 py-1 font-mono text-[11.5px] leading-snug hover:bg-white/2"
                >
                  <span className="shrink-0 text-gray-500">{fmtLogTime(log.t)}</span>
                  <span
                    className={`shrink-0 rounded border px-1 py-px text-[10px] font-medium uppercase ${LOG_LEVEL_STYLES[log.level]}`}
                  >
                    {logLevelBadge(log.level)}
                  </span>
                  <span className="min-w-0 flex-1 break-words text-gray-300">
                    {log.msg}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
