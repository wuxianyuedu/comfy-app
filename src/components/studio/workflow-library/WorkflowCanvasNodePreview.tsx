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
 * 与画布的差异：这里是单节点静态环境（无上游接线），wire 类输入以表单控件
 * 呈现，值为空时不下发、由 ComfyUI 侧工作流自带默认值兜底；**对外参数的落点
 * 映射**在这里可编辑（三列 React Flow 画布，见 WorkflowLibraryCanvas）。
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  startLocalGenerate,
  watchTask,
  type TaskProgressNode,
} from "@/lib/workshop/generation-client";
import {
  appendWorkflowRunLog,
  failWorkflowRun,
  getWorkflowRunStoreSnapshot,
  latestRunForWorkflow,
  patchWorkflowRun,
  registerWorkflowRun,
  subscribeWorkflowRunStore,
} from "@/lib/workflow-run-store";
import { DynamicWorkflowForm } from "../shared/DynamicWorkflowForm";
import {
  defaultInputValues,
  getMissingRequiredInputs,
  inferGroups,
  mergeRefreshedDefaults,
  resolveEntrySeedMode,
  filterVisibleInMode,
  splitWorkflowIO,
  toWorkflowInputsPayload,
  type WorkflowIOMap,
} from "../shared/workflow-io";
import { seedModeOverrides } from "@/components/studio/project-canvas/CanvasNode/helpers";
import {
  applyParamMapping,
  buildParamEntries,
  parseParamMapping,
} from "@/lib/workflow-param-mapping";
import {
  applyOutputBindingEdit,
  canApplyOutputBindingEdit,
  clearOutputBindingEdit,
} from "@/lib/workflow-output-binding";
import { ParamOwnerTag } from "./ParamOwnerTag";
import { modeLabel } from "./workflow-library-config";
import { resolveWorkflowMode } from "@/lib/workflow-types";
import {
  deriveLibraryOutputCards,
  deriveLibraryParamCards,
} from "./workflow-library-param-cards";
import { useModeContracts } from "@/components/workshop/hooks/use-mode-contracts";
import { modeContractEntries } from "@/lib/workshop/model-mode-contract";
import { useParamWiring } from "./hooks/use-param-wiring";
import { WorkflowLibraryCanvas } from "./WorkflowLibraryCanvas";
import { LibraryHostCard } from "./LibraryHostCard";
import { WorkflowRunLogModal } from "./WorkflowRunLogModal";
import { WorkflowNodeActionButton } from "../shared/WorkflowNodeParts";

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
  /** 模板 paramMap（含 `source.mode:<模式>` 的对外参数落点）。 */
  paramMap?: Record<string, unknown>;
  usable: boolean;
  /** 多模式工作流：提供时第二行右侧的类型 chip 变成模式切换下拉。 */
  modes?: string[];
  defaultMode?: string;
  onModeChange?: (code: string) => void;
  /** seed 类参数「控件后行为」的持久化回调（与 IO 编辑一致）。 */
  onSeedModeChange?: (ioKey: string, mode: string) => void;
  /** 对外参数落点的持久化回调（库里拖圆点改落点，写回
   *  `paramMap.source.mode:<模式>`）。不传时卡片列只呈现当前落点、不可拖。 */
  onPatchParamMap?: (next: Record<string, unknown>) => void | Promise<void>;
}

export function WorkflowCanvasNodePreview({
  workflowId,
  workflowName,
  taskType,
  workflowIO,
  paramMap,
  usable,
  modes,
  defaultMode,
  onModeChange,
  onSeedModeChange,
  onPatchParamMap,
}: Props) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  /* 素材上传的可见出口：ComfyUI 未运行 / 正在启动 / 启动超时都落在这里。
   * 上传位自身没有错误区，只记 console 用户看不到任何原因（ISSUE #345）。 */
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  // onOutput 与 onSettled 都来自同一 SSE 闭包，state 读取会拿到渲染期旧值——
  // 用 ref 保证 onSettled 能看到 onOutput 刚写入的结果图。
  const resultUrlRef = useRef<string | null>(null);
  /* 当前运行对应的 taskId；挂到 store 后窗口关闭再打开仍能恢复。 */
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  /* 全屏执行日志弹窗开关。 */
  const [logOpen, setLogOpen] = useState(false);
  /* 选中的对外参数（点卡片或点它那条线）—— 选中后按 ⌫ 断开，或按卡片头 ↺ 恢复默认。 */
  const [selectedParamId, setSelectedParamId] = useState<string | null>(null);
  /* 右列选中的对外输出口 —— 与左列的选中互斥（同一时刻只有一处被选，否则
   *  「按 ⌫ 断的是哪一根」说不清）。 */
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null);
  const [viewTaskId, setViewTaskId] = useState<string | null>(null);

  /* 生效模式与节点上的模式 chip 同一口径（defaultMode → modes[0] → taskType）——
   * 卡片列、宿主表单、seed 模式、必填判定全都按它解析，不会再出现「chip 显示着
   * 单图生视频、卡片却说需要先选模式」这类自相矛盾。 */
  const effectiveMode = useMemo(
    () => resolveWorkflowMode({ modes, defaultMode, taskType }),
    [modes, defaultMode, taskType],
  );

  /* 模式默认值播种：workflow 或**生效模式**变化时，用该模式的两级默认值
   *  （模式覆盖 -> 作者 value -> 图内 defaultValue）回填表单，使「画布样式
   *  预览」初始即展示该模式下配置的默认值（模式 chip 上显示的就是它）。
   *  io 尚未就绪时跳过，用户后续可自由覆盖。 */
  const seedRef = useRef<string | null>(null);
  /* 上一次播种下去的默认值表 —— 判断「用户有没有改过这一格」的基线（见
   *  mergeRefreshedDefaults）。它必须始终是「播种时的那一份」，所以只在播种
   * 处写入，其余时候连引用都不能动。 */
  const baselineRef = useRef<Record<string, unknown>>({});
  /* 播种键同时含 workflowId 与生效模式：换工作流 / 换模式都会落到下面的
   * 「整表重播」分支。这一步是必须的——若只按 mode 判定，上一个工作流的
   * 用户覆盖值会被当成新工作流的覆盖值保留下来（ioKey 恰好同名时）。 */
  const activeSeedKey = `${workflowId ?? ""}|${effectiveMode ?? ""}`;
  useEffect(() => {
    if (!workflowIO) return;
    const fresh = defaultInputValues(workflowIO, effectiveMode);
    if (seedRef.current === activeSeedKey) {
      /* 同一个工作流 + 同一个模式，IO 变了 = 作者在编辑器里改了默认值。
       *  此时不能整表覆盖（会吃掉用户已填的覆盖值），只把「仍等于旧默认值」
       *  的那一格刷新到新默认值；用户改过的格子原样保留。 */
      setValues((current) => {
        const merged = mergeRefreshedDefaults(
          current,
          baselineRef.current,
          fresh,
        );
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
  }, [workflowIO, workflowId, effectiveMode]);

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
            setPhase({
              kind: "done",
              imageUrl: resultUrlRef.current ?? undefined,
            });
            patchWorkflowRun(resume.taskId, { status: "done" });
          } else {
            setPhase({ kind: "failed", message: r.message ?? "生成失败" });
            /* 失败原因同时落一条 error 日志（横幅之外，用户筛选/回放也能看到）。 */
            failWorkflowRun(resume.taskId, r.message ?? "生成失败");
          }
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载/回到本工作流时恢复一次
  }, [workflowId]);

  const running = phase.kind === "running" || phase.kind === "starting";
  const missing = useMemo(
    () =>
      workflowIO
        ? getMissingRequiredInputs(workflowIO, values, effectiveMode)
        : [],
    [workflowIO, values, effectiveMode],
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

  /* 组合控件（宽/高、比例/像素/倍数、时长/画质/比例）把这些端口收进同一块控件，
   *  表单里因此**没有独立的一行**（窄版的组合控件仍把这几个端口摆成逐行参数，
   *  各带自己的端点）。对外参数卡片据此不再重复列这些端口 —— 那块控件本身就是
   *  它们的入口。判定与表单同一份（`inferGroups`），不另算一遍避免漂移。 */
  const groupedKeys = useMemo(
    () => inferGroups(splitWorkflowIO(workflowIO).widgetInputs).groupedKeys,
    [workflowIO],
  );

  /* 宿主卡片此刻**真的画得出来**的端口（ioKey 集合）。
   *
   *  它是「这个端口现在连得上」的事实源：卡片上的候选端点按它收窄 —— 画不出
   *  端点的端口不给拖（拖过去也只会被画布闸门拒绝，用户看到的就是「点击端点
   *  拉线出现禁用标记」）。
   *
   *  口径与宿主表单**同一份**（不是另算一遍）：`splitWorkflowIO` 拆出输入 →
   *  `filterVisibleInMode` 按当前模式去掉隐藏项 → 组合控件接管的端口也算画得出来
   *  （窄版控件把它们摆成逐行参数，各有端点）。纯派生：不必等 DOM 测量，也不会在
   *  渲染里读 ref。 */
  const reachableKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const entry of splitWorkflowIO(workflowIO).inputs) {
      if (!filterVisibleInMode([entry], effectiveMode).length) continue;
      keys.add(entry.ioKey);
    }
    for (const ioKey of groupedKeys) keys.add(ioKey);
    return keys;
  }, [workflowIO, effectiveMode, groupedKeys]);

  /* seed 类参数的「控件后行为」：按生效模式解析（模式覆盖优先，回退条目全局）。
   *  没有模式时与旧行为一致，只读条目全局 seedMode。 */
  const seedModes = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [ioKey, entry] of Object.entries(workflowIO ?? {})) {
      const resolved = resolveEntrySeedMode(entry, effectiveMode);
      if (resolved) map[ioKey] = resolved;
    }
    return map;
  }, [workflowIO, effectiveMode]);

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
      /* 运行期载荷按**映射表**组装（不是裸的「暴露 pin 全量下发」）：
       *  「尺寸」这类一个对外参数接多个端口的口子，值要逐端口派生成各自认的形状
       *  （比例标签 / 百万像素 / 对齐倍数）—— 否则用户在图里连出来的那几条线
       *  在运行期收不到值（ISSUE #355：「尺寸那三项每一项都需要从外部获取值」）。
       *
       *  映射表来源与画布同一份（`paramMap.source.mode:<模式>`，库里改过就跟当前
       *  `wiring.effectiveParamMap`）。映射还没就绪（没有模式）时退回原路径。 */
      const mapped = workflowIO
        ? applyParamMapping({
            io: workflowIO,
            entries: buildParamEntries(workflowIO, undefined, {
              mode: effectiveMode,
            }),
            mapping: parseParamMapping(wiring.effectiveParamMap),
            values,
            mode: effectiveMode,
            groupedKeys,
          })
        : null;
      const workflowInputs =
        mapped && mapped.inputs.length > 0
          ? mapped.inputs
          : toWorkflowInputsPayload(workflowIO ?? undefined, values);
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
        startedAt: nowMs(),
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
              failWorkflowRun(taskId, r.message ?? "生成失败");
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

  /* 模式契约口清单 —— 卡片头的话术与「工坊封装」页签**同一份**
   * （`modeContractEntries`：用户改过的模式走注册表，未改过的回落内置默认）。
   * 两处各读各的会让同一页面的两个页签列出两种名字（ISSUE #596）。 */
  const { contracts: storedContracts } = useModeContracts();
  const contractEntries = useMemo(
    () => modeContractEntries(effectiveMode, storedContracts),
    [effectiveMode, storedContracts],
  );

  /* ── 对外参数卡片列（映射可编辑）──
   * 每个对外参数一张卡片，与宿主卡片并排；卡片说「这个对外参数由哪些端口组成」，
   * 表单行说「这一格填的是什么值」，两者不重复表达同一个落点。
   *
   * 库里这份映射**能改**（ISSUE #355：「连线要能编辑，现在编辑不了」）：从卡片
   * 右侧的圆点拖到宿主卡片的某一行即改落点，点线选中后按 ⌫ 断开，卡片头 ↺ 恢复
   * 默认。落库形状与编辑器画布逐字一致（`paramMap.source.mode:<模式>`）。 */
  /* 宿主卡片此刻**真的画得出来**的端口（ioKey 集合）。
   *
   *  它是「这个端口现在连得上 / 现在能从外部取到值」的事实源：卡片右侧每个候选
   *  圆点按它收窄（画不出端点的端口不给拖，否则拖过去只会被落点解析拒绝 —— 用户
   *  看到的就是「点击端点拉线出现禁用标记」）。
   *
   *  行集合会随模式切换（可见性）、折叠状态、IO 富化结果变化，故每次宿主表单渲染
   *  后重新收集一次；用 `useSyncExternalStore` 之外的最简办法：渲染后布局稳定时
   *  从 DOM 现收（见下面的 effect）。 */
  const hostRef = useRef<HTMLDivElement | null>(null);

  /* 映射编辑编排：本地 overlay + 落库。没有 `onPatchParamMap`（只读消费方）时
   * 仍然派生正确的落点，只是拖不动。 */
  const wiring = useParamWiring({
    paramMap: paramMap ?? {},
    mode: effectiveMode,
    onPatchParamMap,
  });
  /* 本地 overlay 已经并入 wiring 内部的生效 paramMap，但卡片列与连线要读的
   * 是同一份 —— 故把 overlay 之后的 paramMap 回传给派生。`reportParamMap`
   * 让 hook 把「生效的那一份」吐出来（见 useParamWiring 的 effectiveParamMap）。 */
  const paramCards = useMemo(
    () =>
      deriveLibraryParamCards({
        io: workflowIO,
        paramMap: wiring.effectiveParamMap,
        mode: effectiveMode,
        groupedKeys,
        /* 候选端点收窄到「宿主卡片此刻真的画得出来的行」——画不出端点的端口不给
         * 拖，拖过去也落不上（与编辑器画布的 `reachableKeys` 同一口径）。 */
        reachableKeys,
      }),
    [
      workflowIO,
      wiring.effectiveParamMap,
      effectiveMode,
      groupedKeys,
      reachableKeys,
    ],
  );
  /* ── 对外输出参数（右列）──
   * 与左列对称：左列是「对外要什么 → 落到哪一行」，右列是「对外给什么 →
   * 从哪一行取值」。输出不参与**运行期**映射（没有 `source` 键空间），但它
   * 从哪一行取值是作者能改的：拖圆点写 `paramMap.output.mode:<模式>`，卡片头
   * ↺ 恢复默认 —— 手势与落库都经下面的 `outputWiring`。 */
  const outputCards = useMemo(
    () =>
      deriveLibraryOutputCards({
        io: workflowIO,
        paramMap: wiring.effectiveParamMap,
        mode: effectiveMode,
      }),
    [workflowIO, wiring.effectiveParamMap, effectiveMode],
  );
  /* 生效模式名（chip 上显示的那个）。卡片刻的名字、表单按它解析的 required /
   * seed 行为、「在编辑器中打开」带过去的模式，全都取自同一个生效模式。 */
  const effectiveModeLabel = useMemo(
    () => (effectiveMode ? modeLabel(effectiveMode) : modeLabel(taskType)),
    [effectiveMode, taskType],
  );

  /* ── 对外输出参数的落点编辑（右列）──
   *
   * 与左列同一份编排思路（本地叠加 + 落库），但键空间分开：输出的取值行写在
   * `paramMap.output.mode:<模式>`。同一份本地 overlay 承载它，落库回调也共用
   * `onPatchParamMap` —— 库里不必等一次 PATCH 往返才看得见结果。
   *
   * 没有 `onPatchParamMap`（只读消费方）时不可拖：回调为 undefined，连线层据此
   * 不起手（拖不动的东西不摆出能拖的样子）。 */
  const outputWiring = useMemo(
    () => ({
      isManual: (ioKey: string) => outputCards.isManual(ioKey),
      connect: (outputIoKey: string, targetIoKey: string) => {
        if (!effectiveMode || !onPatchParamMap) return;
        if (
          !canApplyOutputBindingEdit(
            { ioKey: targetIoKey, mode: effectiveMode },
            workflowIO,
          )
        )
          return;
        /* 连回它**默认**取值的那一行 = 撤销这条手工线（而不是把它写成一条
         *  多余的覆盖）—— 否则「恢复默认」与「拖回来」会留下两种等价状态。 */
        const revert = outputIoKey === targetIoKey;
        const next = revert
          ? clearOutputBindingEdit(
              wiring.effectiveParamMap,
              outputIoKey,
              effectiveMode,
            )
          : applyOutputBindingEdit(wiring.effectiveParamMap, {
              outputIoKey,
              ioKey: targetIoKey,
              mode: effectiveMode,
            });
        void onPatchParamMap(next);
      },
      disconnect: (outputIoKey: string) => {
        if (!effectiveMode || !onPatchParamMap) return;
        void onPatchParamMap(
          applyOutputBindingEdit(wiring.effectiveParamMap, {
            outputIoKey,
            ioKey: null,
            mode: effectiveMode,
          }),
        );
      },
      reset: (outputIoKey: string) => {
        if (!effectiveMode || !onPatchParamMap) return;
        void onPatchParamMap(
          clearOutputBindingEdit(
            wiring.effectiveParamMap,
            outputIoKey,
            effectiveMode,
          ),
        );
      },
    }),
    [
      outputCards,
      effectiveMode,
      onPatchParamMap,
      wiring.effectiveParamMap,
      workflowIO,
    ],
  );

  const hasRuns = currentRuns.length > 0;
  const activeRun = currentRuns[0] ?? null;

  return (
    /* 容器只做布局：边框/标题/背景由 DetailBody 的页签面板负责（此前在这里
     * 又包了一层同款边框 + 重复标题，出现「面板套面板」）。卡片宽 380，
     * 进度/结果/错误行与其对齐。 */
    <div className="flex w-full flex-col items-center gap-3">
      {/* ── 画布视口外框（拖动平移 / 滚轮缩放 / 适应 / 复位）──
          三列（对外参数 / 宿主卡片 / 对外输出参数）合起来常宽过面板，超出去的
          部分此前看不到（ISSUE #355：「需要可以拖动整个画布查看其他超出边框的
          内容」）。状态与手势都在这一层，拖动画布不会让预览主体重渲染。 */}
      {/* ── 画布：三列各一个 React Flow 节点（ISSUE #529）──
          拖动平移 / 滚轮缩放 / 适应 / 复位由 React Flow 承担；连线是真正的
          edge，端点是真正的 <Handle>，「这一行收不收这个口子」收敛到
          `isValidConnection`（与编辑器画布同一套语义）。
          三列（对外参数 / 宿主卡片 / 对外输出参数）合起来常宽过面板，
          超出边框的部分靠拖动平移看全。 */}
      <WorkflowLibraryCanvas
        io={workflowIO}
        paramCards={paramCards}
        outputCards={outputCards}
        entries={buildParamEntries(workflowIO ?? null, undefined, {
          mode: effectiveMode,
        })}
        /* 契约口清单：卡片头与「工坊封装」页签同一份措辞（ISSUE #596）。 */
        contractEntries={contractEntries}
        canWire={!!effectiveMode && !!onPatchParamMap}
        selectedEntryId={selectedParamId}
        selectedOutputId={selectedOutputId}
        onSelectParam={(id) => {
          setSelectedParamId(id);
          if (id) setSelectedOutputId(null);
        }}
        onSelectOutput={(id) => {
          setSelectedOutputId(id);
          if (id) setSelectedParamId(null);
        }}
        onResetParam={wiring.resetToAuto}
        onResetOutput={outputWiring.reset}
        onConnect={
          effectiveMode && onPatchParamMap ? wiring.connect : undefined
        }
        onConnectOutput={
          effectiveMode && onPatchParamMap ? outputWiring.connect : undefined
        }
        host={
          <LibraryHostCard
            workflowName={workflowName}
            statusLabel={statusLabel}
            running={running}
            phaseKind={phase.kind}
            modes={modes}
            effectiveMode={effectiveMode}
            taskType={taskType}
            effectiveModeLabel={effectiveModeLabel}
            onModeChange={onModeChange}
            hostRef={hostRef}
            form={
              <DynamicWorkflowForm
                io={workflowIO ?? undefined}
                values={values}
                onChange={setValues}
                showOutputs={false}
                compact
                mode={effectiveMode}
                seedModes={seedModes}
                /* 被某个对外参数落到的那一行，行尾标出它属于谁 —— 与左侧卡片的
                 * 端口行互为两端，一眼看出「这个参数到底喂给了哪一行」。 */
                rowTrailing={(entry) => (
                  <ParamOwnerTag label={paramCards.ownersByPin[entry.ioKey]} />
                )}
                onSeedModeChange={
                  onSeedModeChange
                    ? (ioKey: string, mode: string) => onSeedModeChange(ioKey, mode)
                    : undefined
                }
                workflowId={workflowId}
                onUploadProgress={(message) => setUploadNotice(message)}
                onUploadError={(message) => setUploadNotice(message)}
              />
            }
            outputs={outputs}
            inputs={inputs}
            actions={
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
            }
          />
        }
      />

      {/* 进度条（running 时） */}
      {phase.kind === "running" && (
        <div className="w-[380px]" aria-live="polite">
          <div className="mb-1 flex items-center justify-between text-[11px] text-ink-faint">
            <span>
              {nodeLabel ? `正在执行 ${nodeLabel}` : "正在执行工作流"}
              {phase.node ? `（${phase.node.value}/${phase.node.max}）` : ""}
            </span>
            <span className="font-medium text-violet-700 dark:text-violet-300">{pct}%</span>
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
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
          <p className="mb-1 text-[11px] text-ink-faint">运行结果</p>
          <img
            src={resultUrl}
            alt="运行结果"
            className="w-full rounded-xl border border-border"
          />
        </div>
      )}

      {/* 错误 / 必填提示 */}
      {phase.kind === "failed" && (
        <div className="w-[380px] rounded-lg border border-red-500/20 bg-red-500/8 px-3 py-2 text-[11px] leading-relaxed text-red-700 dark:text-red-300">
          {phase.message}
        </div>
      )}

      {/* 素材上传被「ComfyUI 未就绪」挡住时的出口：说明当前在等什么，
          并给出去设置页手动启动的路（自动启动失败 / 手动关闭过才有这个必要）。 */}
      {uploadNotice && (
        <div
          className="w-[380px] rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0 flex-1">{uploadNotice}</span>
            <button
              type="button"
              onClick={() => setUploadNotice(null)}
              className="shrink-0 rounded px-1 text-amber-800 dark:text-amber-300/70 transition-colors hover:text-amber-800"
              aria-label="关闭上传提示"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      {!running && missingLabels.length > 0 && (
        <p className="w-[380px] text-[11px] text-amber-700 dark:text-amber-300/80">
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
          className="flex w-[380px] items-center justify-between rounded-xl border border-border bg-panel-deep px-3 py-2 text-left transition-colors hover:border-border-strong"
          title="打开执行日志"
        >
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-ink-strong">
            执行日志
            {running && (
              <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" />
            )}
          </span>
          <span className="text-[10.5px] text-ink-fainter">
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

/** 当前时间戳（毫秒）。
 *
 *  抽成模块级函数而不是在组件体里直接 `Date.now()`：React 的纯度检查会顺着
 *  组件作用域内的调用点判定「渲染期调用了非纯函数」，而这里其实只在**点击运行
 *  的事件回调**里执行（永远不会在渲染期跑到）。由列出的这个事实源统一取时间，
 *  也方便将来在测试里打桩。 */
function nowMs(): number {
  return Date.now();
}
