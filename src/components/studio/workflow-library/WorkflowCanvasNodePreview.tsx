"use client";

/**
 * WorkflowCanvasNodePreview — 工作流库的「画布样式预览」。
 *
 * 用与项目画布一致（Ardot v5 token：W 图标头 + 状态胶囊 + 本机/工作流/类型
 * chips + 端口行 + 渐变 ActionBtn）的节点卡片呈现当前工作流的输入参数与输出，
 * 并支持就地运行（generate.generate → SSE 任务流）：进度、结果图、错误全部
 * 内联展示，方便不进画布就调试工作流。
 *
 * 执行日志走全屏弹窗（WorkflowRunLogModal，与项目画布执行日志面板同款），
 * 不再挂在节点下方。运行态/日志由 workflow-run-store 托管：关闭窗口（组件
 * 卸载）再打开，生成中状态与日志依然可见（SSE 重连由服务端回放补齐历史）。
 *
 * 与画布的差异：这里是单节点静态环境（无连线），wire 类输入以表单控件呈现，
 * 值为空时不下发、由 ComfyUI 侧工作流自带默认值兜底。
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  startLocalGenerate,
  watchTask,
  type TaskProgressNode,
} from "@/lib/workshop/generation-client";
import {
  appendWorkflowRunLog,
  getWorkflowRunStoreSnapshot,
  latestRunForWorkflow,
  patchWorkflowRun,
  registerWorkflowRun,
  subscribeWorkflowRunStore,
} from "@/lib/workflow-run-store";
import { DarkSelect } from "~/components/studio/ui/DarkSelect";
import { DynamicWorkflowForm } from "../shared/DynamicWorkflowForm";
import {
  defaultInputValues,
  getMissingRequiredInputs,
  mergeRefreshedDefaults,
  resolveEntrySeedMode,
  splitWorkflowIO,
  toWorkflowInputsPayload,
  type WorkflowIOMap,
} from "../shared/workflow-io";
import { seedModeOverrides } from "@/components/studio/project-canvas/CanvasNode/helpers";
import { modeLabel } from "./workflow-library-config";
import { WorkflowRunLogModal } from "./WorkflowRunLogModal";
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
  /* 当前运行对应的 taskId；挂到 store 后窗口关闭再打开仍能恢复。 */
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  /* 全屏执行日志弹窗开关。 */
  const [logOpen, setLogOpen] = useState(false);
  const [viewTaskId, setViewTaskId] = useState<string | null>(null);

  /* 模式默认值播种：workflow 或 defaultMode 变化时，用该模式（或默认模式）的
   *  两级默认值（模式覆盖 -> 作者 value -> 图内 defaultValue）回填表单，使
   *  「画布样式预览」初始即展示该模式下配置的默认值。不强制（io 尚未就绪 /
   *  defaultMode 空时跳过），用户后续可自由覆盖。 */
  const seedRef = useRef<string | null>(null);
  /* 上一次播种下去的默认值表 —— 判断「用户有没有改过这一格」的基线（见
   *  mergeRefreshedDefaults）。它必须始终是「播种时的那一份」，所以只在播种
   * 处写入，其余时候连引用都不能动。 */
  const baselineRef = useRef<Record<string, unknown>>({});
  /* 播种键同时含 workflowId 与 defaultMode：换工作流 / 换模式都会落到下面的
   * 「整表重播」分支。这一步是必须的——若只按 mode 判定，上一个工作流的
   * 用户覆盖值会被当成新工作流的覆盖值保留下来（ioKey 恰好同名时）。 */
  const activeSeedKey = `${workflowId ?? ""}|${defaultMode ?? ""}`;
  useEffect(() => {
    if (!workflowIO) return;
    const fresh = defaultInputValues(workflowIO, defaultMode ?? null);
    if (seedRef.current === activeSeedKey) {
      /* 同一个工作流 + 同一个模式，IO 变了 = 作者在编辑器里改了默认值。
       *  此时不能整表覆盖（会吃掉用户已填的覆盖值），只把「仍等于旧默认值」
       *  的那一格刷新到新默认值；用户改过的格子原样保留。 */
      setValues((current) => {
        const merged = mergeRefreshedDefaults(current, baselineRef.current, fresh);
        return merged ?? current;
      });
      baselineRef.current = fresh;
      return;
    }
    /* 首次播种 / 换工作流 / 换模式：整表采用新默认值，清掉上一份残留。 */
    seedRef.current = activeSeedKey;
    baselineRef.current = fresh;
    setValues(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在 workflow/模式变化时整表播种，IO 变化走上面的保覆盖刷新
  }, [workflowIO, workflowId, defaultMode]);

  /* 重开窗口恢复：若 store 里有本工作流仍在运行的登记，恢复「生成中」视角。
   * 恢复走惰性初始化（useState 的初始化函数在挂载时读 store），避免 effect
   * 里同步 setState 的级联渲染。 */
  const storeSnapshot = useSyncExternalStore(
    subscribeWorkflowRunStore,
    getWorkflowRunStoreSnapshot,
    getWorkflowRunStoreSnapshot,
  );
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    if (phase.kind !== "idle" || activeTaskId) return;
    const resume = latestRunForWorkflow(workflowId);
    if (resume && (resume.status === "running" || !resume.status)) {
      // 不自动弹全屏日志（避免打断用户）；由用户点「执行日志」查看。
      void watchTask(resume.taskId, {
        onProgress: (pct, node: TaskProgressNode | undefined) =>
          setPhase({ kind: "running", pct, ...(node ? { node } : {}) }),
        onLog: (entry) => {
          appendWorkflowRunLog(resume.taskId, entry);
        },
        onOutput: (out) => {
          if (out.kind === "image" && out.url) {
            resultUrlRef.current = out.url;
            setResultUrl(out.url);
            patchWorkflowRun(resume.taskId, { resultUrl: out.url });
          }
        },
        onSettled: (r) => {
          if (r.ok) {
            setPhase({ kind: "done", imageUrl: resultUrlRef.current ?? undefined });
            patchWorkflowRun(resume.taskId, { status: "done" });
          } else {
            setPhase({ kind: "failed", message: r.message ?? "生成失败" });
            patchWorkflowRun(resume.taskId, {
              status: "failed",
              errorMessage: r.message ?? "生成失败",
            });
          }
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载/回到本工作流时恢复一次
  }, [workflowId]);

  const running = phase.kind === "running" || phase.kind === "starting";
  const missing = useMemo(
    () =>
      workflowIO ? getMissingRequiredInputs(workflowIO, values, defaultMode ?? null) : [],
    [workflowIO, values, defaultMode],
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

  /* seed 类参数的「控件后行为」：按当前模式解析（模式覆盖优先，回退条目全局）。
   *  defaultMode 空时与旧行为一致，只读条目全局 seedMode。 */
  const seedModes = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [ioKey, entry] of Object.entries(workflowIO ?? {})) {
      const resolved = resolveEntrySeedMode(entry, defaultMode);
      if (resolved) map[ioKey] = resolved;
    }
    return map;
  }, [workflowIO, defaultMode]);

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
      /* seed「控件后行为」与画布运行同源：条目上配置了 seedMode 的参数
       * 附加 control_after_generate 输入，后端按 fixed/randomize 等处理。 */
      const cagInputs = seedModeOverrides(workflowIO ?? null, seedModes);
      const taskId = await startLocalGenerate({
        workflow: workflowId,
        workflowInputs: [...workflowInputs, ...cagInputs],
      });
      setPhase({ kind: "running", pct: 0 });
      setActiveTaskId(taskId);
      setViewTaskId(taskId);
      /* 登记运行记录；日志弹窗不再自动打开，由用户点「执行日志」查看。 */
      registerWorkflowRun({
        taskId,
        workflowId,
        workflowName,
        taskType,
        startedAt: Date.now(),
        status: "running",
      });
      await new Promise<void>((resolve) => {
        watchTask(taskId, {
          onProgress: (pct, node: TaskProgressNode | undefined) =>
            setPhase({ kind: "running", pct, ...(node ? { node } : {}) }),
          onLog: (entry) => {
            appendWorkflowRunLog(taskId, entry);
          },
          onOutput: (out) => {
            if (out.kind === "image" && out.url) {
              resultUrlRef.current = out.url;
              setResultUrl(out.url);
              patchWorkflowRun(taskId, { resultUrl: out.url });
            }
          },
          onSettled: (r) => {
            if (r.ok) {
              setPhase({
                kind: "done",
                imageUrl: resultUrlRef.current ?? undefined,
              });
              patchWorkflowRun(taskId, { status: "done" });
            } else {
              setPhase({ kind: "failed", message: r.message ?? "生成失败" });
              patchWorkflowRun(taskId, {
                status: "failed",
                errorMessage: r.message ?? "生成失败",
              });
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
  /* 运行态/日志按「当前工作流」隔离：切到哪个工作流就展示哪个工作流的运行，
   * 不再把别的工作流的运行串到本节点上。currentRuns 取本工作流记录（新→旧）。 */
  const currentRuns = storeSnapshot.runs.filter(
    (r) => r.workflowId === workflowId,
  );
  const hasRuns = currentRuns.length > 0;
  const activeRun = currentRuns[0] ?? null;

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
                  running ? "animate-pulse bg-amber-300" : phase.kind === "done"
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
              <span className="h-1.5 w-1.5 rounded-full bg-(--color-success-strong)" />
              <span className="text-[11px] font-semibold text-(--color-success-strong)">
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
                className="!bg-transparent !border-(--color-border-strong) shrink-0 text-[11px]"
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
          mode={defaultMode}
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
          <div className="border-t border-(--color-border-subtle)">
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
          <div className="mb-1 flex items-center justify-between text-[11px] text-(--color-ink-faint)">
            <span>
              {nodeLabel ? `正在执行 ${nodeLabel}` : "正在执行工作流"}
              {phase.node ? `（${phase.node.value}/${phase.node.max}）` : ""}
            </span>
            <span className="font-medium text-violet-600">{pct}%</span>
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-(--color-surface-2)"
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
          <p className="mb-1 text-[11px] text-(--color-ink-faint)">运行结果</p>
          <img
            src={resultUrl}
            alt="运行结果"
            className="w-full rounded-xl border border-(--color-border)"
          />
        </div>
      )}

      {/* 错误 / 必填提示 */}
      {phase.kind === "failed" && (
        <div className="w-[380px] rounded-lg border border-red-500/20 bg-red-500/8 px-3 py-2 text-[11px] leading-relaxed text-red-600">
          {phase.message}
        </div>
      )}
      {!running && missingLabels.length > 0 && (
        <p className="w-[380px] text-[11px] text-amber-600/80">
          必填参数未填：{missingLabels.join("、")}
        </p>
      )}

      {/* 执行日志入口：点击打开全屏日志弹窗（与项目画布执行日志面板同款）。
       *  有运行记录即显示（跨窗口存活），运行中带呼吸点提示。 */}
      {hasRuns && (
        <button
          type="button"
          onClick={() => {
            /* 打开日志默认定位到本工作流最近一次运行（切到的工作流独立展示）。 */
            if (!viewTaskId && activeRun) setViewTaskId(activeRun.taskId);
            setLogOpen(true);
          }}
          data-testid="wflib-log-open"
          className="flex w-[380px] items-center justify-between rounded-xl border border-(--color-border) bg-(--color-panel-deep) px-3 py-2 text-left transition-colors hover:border-(--color-border-strong)"
          title="打开执行日志"
        >
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-(--color-ink-strong)">
            执行日志
            {running && (
              <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" />
            )}
          </span>
          <span className="text-[10.5px] text-(--color-ink-fainter)">
            {activeRun
              ? activeRun.status === "done"
                ? "上次已完成"
                : activeRun.status === "failed"
                  ? "上次已失败"
                  : "生成中…"
              : `${currentRuns.length} 次运行`}
            <span className="ml-2">›</span>
          </span>
        </button>
      )}

      {/* 全屏执行日志弹窗：与项目画布 GlobalStepLogPanel 同款交互。 */}
      <WorkflowRunLogModal
        open={logOpen}
        workflowId={workflowId}
        viewTaskId={viewTaskId}
        onViewTaskIdChange={setViewTaskId}
        onClose={() => setLogOpen(false)}
      />
    </div>
  );
}
