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
 *
 * 本组件是容器（§17.2 ④）：状态机与编排都收在 hooks/ ——
 * • `hooks/use-generation-runner.ts` 生成的相位状态机 + SSE 订阅（发起与恢复）；
 * • `hooks/use-default-value-seeding.ts` 输入值状态 + 模式默认值播种；
 * • `hooks/use-output-wiring.ts` 对外输出落点的编辑编排。
 */

import { useCallback, useMemo, useRef, useState } from "react";

import {
  buildParamEntries,
  sizeGroupIds,
} from "~/lib/workflow/workflow-param-mapping";
import { resolveWorkflowMode } from "~/lib/workflow/workflow-types";
import { modeContractEntries } from "~/lib/workshop/model-mode-contract";
import {
  getMissingRequiredInputs,
  inferGroups,
  resolveEntrySeedMode,
  splitWorkflowIO,
  type WorkflowIOMap,
} from "../workflow-io";
import { useModeContracts } from "~/components/workshop/mode-contract/hooks/use-mode-contracts";
import { DynamicWorkflowForm } from "~/components/studio/workflow-form/DynamicWorkflowForm";
import { WorkflowNodeActionButton } from "~/components/studio/workflow-form/WorkflowNodeParts";
import { ParamOwnerTag } from "./ParamOwnerTag";
import { modeLabel } from "./workflow-library-config";
import {
  deriveLibraryOutputCards,
  deriveLibraryParamCards,
} from "./workflow-library-param-cards";
import { useParamWiring } from "./hooks/use-param-wiring";
import { useGenerationRunner, type Phase } from "./hooks/use-generation-runner";
import { useDefaultValueSeeding } from "./hooks/use-default-value-seeding";
import { useOutputWiring } from "./hooks/use-output-wiring";
import { WorkflowLibraryCanvas } from "./WorkflowLibraryCanvas";
import { LibraryHostCard } from "./LibraryHostCard";
import { WorkflowPreviewUsePanel } from "./WorkflowPreviewUsePanel";
import { WorkflowPreviewRunFeedback } from "./WorkflowPreviewRunFeedback";
import { WorkflowRunLogModal } from "./WorkflowRunLogModal";
import { latestRunForWorkflow } from "~/lib/workflow/workflow-run-store";

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
  /** 视图模式（受控，顶层页签持有）：
   *  "edit" = 编辑对外参数（参数连线画布，禁止执行生成）
   *  "use"  = 实际使用（简化视图，可生成、可看结果）
   *  缺省按 "edit"（首个页签；测试等只读消费方无需关心视图模式）。 */
  viewMode?: "edit" | "use";
}

/* 相位 → 状态胶囊文案（running 的百分比是动态的，查表只覆盖静态四种）。 */
const STATUS_LABEL: Record<Exclude<Phase["kind"], "running">, string> = {
  idle: "待开始",
  starting: "提交中…",
  done: "已完成",
  failed: "失败",
};

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
  viewMode: viewModeProp,
}: Props) {
  /* 视图模式归一：未指定按 "edit"（首个页签，见 Props 注释）。 */
  const viewMode = viewModeProp ?? "edit";
  /* 素材上传的可见出口：ComfyUI 未运行 / 正在启动 / 启动超时都落在这里。
   * 上传位自身没有错误区，只记 console 用户看不到任何原因（ISSUE #345）。 */
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  /* 选中的对外参数（点卡片或点它那条线）—— 选中后按 ⌫ 断开，或按卡片头 ↺ 恢复默认。 */
  const [selectedParamId, setSelectedParamId] = useState<string | null>(null);
  /* 右列选中的对外输出口 —— 与左列的选中互斥（同一时刻只有一处被选，否则
   *  「按 ⌫ 断的是哪一根」说不清）。 */
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null);

  /* 生效模式与节点上的模式 chip 同一口径（defaultMode → modes[0] → taskType）——
   * 卡片列、宿主表单、seed 模式、必填判定全都按它解析，不会再出现「chip 显示着
   * 单图生视频、卡片却说需要先选模式」这类自相矛盾。 */
  const effectiveMode = useMemo(
    () => resolveWorkflowMode({ modes, defaultMode, taskType }),
    [modes, defaultMode, taskType],
  );

  /* 输入值状态 + 模式默认值播种（见 use-default-value-seeding）。 */
  const { values, setValues } = useDefaultValueSeeding({
    workflowId,
    workflowIO,
    effectiveMode,
  });

  /* 与画布 WorkflowNode 同源的双行结构：inputs 由 DynamicWorkflowForm(compact)
   * 渲染（库内无 React Flow 上下文，不带端点），outputs 单独成段在表单之后。
   * 拆一次按 workflowIO 记忆，供卡片派生 / 缺参标签 / 组合控件判定共用。 */
  const { inputs, outputs, widgetInputs } = useMemo(
    () => splitWorkflowIO(workflowIO),
    [workflowIO],
  );

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
        const fromInputs = inputs.find((input) => input.ioKey === ioKey);
        return fromInputs?.label ?? fromInputs?.name ?? ioKey;
      }),
    [missing, inputs, workflowIO],
  );

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

  /* 组合控件（宽/高、比例/像素/倍数、时长/画质/比例）把这些端口收进同一块控件，
   *  表单里因此**没有独立的一行**（窄版的组合控件仍把这几个端口摆成逐行参数，
   *  各带自己的端点）。对外参数卡片据此不再重复列这些端口 —— 那块控件本身就是
   *  它们的入口。判定与表单同一份（`inferGroups`），不另算一遍避免漂移。 */
  const groupedKeys = useMemo(
    () => inferGroups(widgetInputs).groupedKeys,
    [widgetInputs],
  );

  /* 生成运行器。`enabled` 是除「已在运行」外的可运行条件；载荷（含生效映射）
   * 由下面的 run() 在点击时组装 —— 生效映射持有在 wiring 里，倒灌进运行器
   * 会与 useParamWiring 的回调依赖互相成环。 */
  const { phase, running, canRun, resultUrl, startRun, clearFailure } =
    useGenerationRunner({
      workflowId,
      enabled: usable && missing.length === 0 && viewMode === "use",
    });

  /* 失败态只保留到用户采取行动前：改输入值或改落点都算「采取了行动」。 */
  const setValuesAndClearFailure = useCallback(
    (
      next:
        | Record<string, unknown>
        | ((prev: Record<string, unknown>) => Record<string, unknown>),
    ) => {
      clearFailure();
      setValues(next);
    },
    [clearFailure, setValues],
  );
  const handlePatchParamMap = useCallback(
    (next: Record<string, unknown>) => {
      clearFailure();
      return onPatchParamMap?.(next);
    },
    [clearFailure, onPatchParamMap],
  );

  /* 本页签独立的「执行日志」入口：按钮带 canvas-node 来源过滤，弹窗同理，
   * 与「工坊封装」页签各自一处（ISSUE #611 旧形态：两个页签各写各的）。 */
  const [logOpen, setLogOpen] = useState(false);
  const [logTaskId, setLogTaskId] = useState<string | null>(null);
  const latestLogTaskId = useMemo(
    () => latestRunForWorkflow(workflowId, "canvas-node")?.taskId ?? null,
    [workflowId],
  );
  const logViewTaskId = logTaskId ?? latestLogTaskId;

  const statusLabel =
    phase.kind === "running"
      ? `生成中 ${phase.pct}%`
      : STATUS_LABEL[phase.kind];
  const pct = phase.kind === "running" ? phase.pct : 0;
  const nodeLabel =
    phase.kind === "running" && phase.node?.label ? phase.node.label : null;

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
    onPatchParamMap: handlePatchParamMap,
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
        /* 卡片列的口子清单与上面那份**同一份**（用户改过契约的模式必须按改过的
         *  清单列 —— 用内置默认会多列出契约里没有的口，见 `deriveLibraryParamCards`）。 */
        contractIds: contractEntries.map((item) => item.id),
      }),
    [
      workflowIO,
      wiring.effectiveParamMap,
      effectiveMode,
      groupedKeys,
      contractEntries,
    ],
  );
  /* ── 对外输出参数（右列）──
   * 与左列对称：左列是「对外要什么 → 落到哪一行」，右列是「对外给什么 →
   * 从哪一行取值」。输出不参与**运行期**映射（没有 `source` 键空间），但它
   * 从哪一行取值是作者能改的：拖圆点写 `paramMap.output.mode:<模式>`，卡片头
   * ↺ 恢复默认 —— 手势与落库都经 `useOutputWiring`。 */
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
  const outputWiring = useOutputWiring({
    workflowIO,
    effectiveMode,
    onPatchParamMap,
    outputCards,
    effectiveParamMap: wiring.effectiveParamMap,
    commitParamMap: wiring.commitParamMap,
  });

  /** 提交到本机生成并等待落定（相位与 SSE 订阅在 use-generation-runner）。 */
  function run() {
    if (!canRun) return;
    startRun({
      workflowId,
      workflowName,
      taskType,
      workflowIO,
      effectiveMode,
      values,
      effectiveParamMap: wiring.effectiveParamMap,
      seedModes,
    });
  }

  return (
    <div
      className={`flex h-full min-h-0 w-full flex-col items-center gap-3 ${
        /* use 模式的产出（表单 + 进度 + 结果图 + 提示）比可视区高是常态，
           而它所在的父级是 `overflow-y-hidden`（edit 模式的画布靠它兜住
           React Flow 的撑高）—— 纵向滚动只能由本层自己出，否则结果图下半
           截被裁掉且滚不到（用户实测：「产出内容看不全」）。 */
        viewMode === "use" ? "custom-scrollbar overflow-y-auto" : ""
      }`}
    >
      {/* ── edit 模式：参数连线画布（三列 React Flow） ── */}
      {viewMode === "edit" && (
        <WorkflowLibraryCanvas
          io={workflowIO}
          paramCards={paramCards}
          outputCards={outputCards}
          /* 闸门（`isValidConnection`）按它判类型 —— 必须与卡片列**同一份**
             契约（含作者自定义的口），否则自定义口的圆点拖到宿主行上会被判成
             「这一行不收这个口子」，而卡片列明明画着它。 */
          entries={buildParamEntries(workflowIO ?? null, undefined, {
            mode: effectiveMode,
            contractIds: contractEntries.map((item) => item.id),
          })}
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
          onResetParam={(id) => {
            wiring.resetMany(sizeGroupIds(id));
          }}
          onResetOutput={outputWiring.reset}
          onConnect={
            effectiveMode && onPatchParamMap ? wiring.connect : undefined
          }
          onConnectOutput={
            effectiveMode && onPatchParamMap ? outputWiring.connect : undefined
          }
          onDeleteWire={
            effectiveMode && onPatchParamMap
              ? (namespace, entryId) => {
                  if (namespace === "param") wiring.disconnect(entryId);
                  else outputWiring.disconnect(entryId);
                }
              : undefined
          }
          host={
            <LibraryHostCard
              workflowName={workflowName}
              /* 编辑对外参数页签是配置界面，不应显示上次运行的失败状态（红点 +
               *  「失败」文案）。这里把失败态渲染成「待开始」的中性状态，运行中 /
               *  已完成等状态保留，方便用户必要时感知运行进度。 */
              statusLabel={
                viewMode === "edit" && phase.kind === "failed"
                  ? "待开始"
                  : statusLabel
              }
              running={running}
              phaseKind={
                viewMode === "edit" && phase.kind === "failed"
                  ? "idle"
                  : phase.kind
              }
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
                  onChange={setValuesAndClearFailure}
                  showOutputs={false}
                  compact
                  mode={effectiveMode}
                  seedModes={seedModes}
                  rowTrailing={(entry) => (
                    <ParamOwnerTag
                      label={paramCards.ownersByPin[entry.ioKey]}
                    />
                  )}
                  onSeedModeChange={onSeedModeChange}
                  workflowId={workflowId}
                  onUploadProgress={setUploadNotice}
                  onUploadError={setUploadNotice}
                />
              }
              outputs={outputs}
              inputs={inputs}
              actions={
                <WorkflowNodeActionButton
                  label="▶ 用此工作流生成"
                  disabled={true}
                  onClick={run}
                  hint="切换到「实际使用」页签后可执行"
                />
              }
            />
          }
        />
      )}

      {/* ── use 模式：简化视图（表单 + 生成按钮 + 日志入口 + 模式切换） ── */}
      {viewMode === "use" && (
        <WorkflowPreviewUsePanel
          workflowId={workflowId}
          workflowName={workflowName}
          workflowIO={workflowIO}
          effectiveMode={effectiveMode}
          taskType={taskType}
          modes={modes}
          onModeChange={onModeChange}
          effectiveModeLabel={effectiveModeLabel}
          values={values}
          onValuesChange={setValuesAndClearFailure}
          seedModes={seedModes}
          onSeedModeChange={onSeedModeChange}
          onUploadNotice={setUploadNotice}
          running={running}
          canRun={canRun}
          run={run}
          pct={pct}
          missingLabels={missingLabels}
          logViewTaskId={logViewTaskId}
          onOpenLog={() => setLogOpen(true)}
        />
      )}

      {/* ── 运行的内联反馈（进度 / 结果 / 失败原因 / 上传与缺参提示） ── */}
      <WorkflowPreviewRunFeedback
        phase={phase}
        pct={pct}
        nodeLabel={nodeLabel}
        resultUrl={resultUrl}
        workflowName={workflowName}
        viewMode={viewMode}
        running={running}
        missingLabels={missingLabels}
        uploadNotice={uploadNotice}
        onDismissUploadNotice={() => setUploadNotice(null)}
      />
      <WorkflowRunLogModal
        open={logOpen}
        workflowId={workflowId}
        source="canvas-node"
        viewTaskId={logViewTaskId}
        onViewTaskIdChange={setLogTaskId}
        onClose={() => setLogOpen(false)}
      />
    </div>
  );
}
