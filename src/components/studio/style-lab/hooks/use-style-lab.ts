"use client";

// ── 风格实验室 · 第②层（查询与动作编排）─────────────────────────────────
//
// 这一屏的全部 IO 都收在这里：列表读 `styleLab.list`、工作流读 `workflow.list`、
// 建试验走 `styleLab.create`、删走 `styleLab.softDelete`。视图层不再出现 fetch /
// tRPC hook（规范 17 §17.2 红线 S1/S2/S3）——容器拿这一份 controller，视图只渲染。
//
// 「哪些工作流可挑」的判据不在本屏另写一份：客户端拿 `workflow.list` 的行（含
// workflowIO / paramMap），用**服务端 `create` 同一个函数** `deriveEncapsulationStatus`
// 逐模式判就绪，于是「界面上能选」与「提交后会被接受」天然对齐，不会界面放行、
// 后端却拒（两份就绪判据迟早各漂一次）。

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { useToast } from "../../ToastProvider";
import { deriveEncapsulationStatus } from "~/lib/workshop/workshop-encapsulation-status";
import { runAsyncAction, type ActionReport } from "~/lib/async-action";
import { useTRPC } from "~/trpc/react";
import type {
  StyleLabBatchOutcome,
  StyleLabCellWithStatus,
  StyleLabListItem,
  StyleLabStopOutcome,
} from "~/lib/style-lab/style-lab-types";
import type { WorkflowListRow } from "~/lib/workflow/workflow-list-types";

import {
  EMPTY_FORM,
  plannedMatrixPreview,
  summarizeBatch,
  validateCreateForm,
  type StyleLabBatchSummary,
  type StyleLabCreateForm,
  type StyleLabMatrixPreview,
} from "../style-lab-config";

/** 一个可挑的工作流：只带「在它上面真的就绪」的那些模式。 */
export interface StyleLabWorkflowOption {
  id: string;
  name: string;
  /** 就绪模式码（界面据此渲染模式单选；提交时 `mode` 必是其中之一）。 */
  readyModes: string[];
  /** 缺省选中的模式：工作流默认模式若就绪则用它，否则取第一个就绪模式。 */
  defaultMode: string;
}

export interface StyleLabController {
  loading: boolean;
  /** 拉列表失败的一句话；null = 查询本身没问题（动作失败走 toast，不落这里）。 */
  loadError: string | null;
  items: StyleLabListItem[];
  /** 仅封装就绪的工作流（空数组 = 库里还没有可直接驱动的工作流）。 */
  workflowOptions: StyleLabWorkflowOption[];
  form: StyleLabCreateForm;
  /** 当前所选工作流的就绪模式；未选工作流时为空。 */
  selectedModes: string[];
  preview: StyleLabMatrixPreview;
  /** 表单校验信息（不可提交时给视图那句提示）。 */
  formError: string | null;
  canSubmit: boolean;
  creating: boolean;
  setName: (value: string) => void;
  selectWorkflow: (id: string) => void;
  setMode: (mode: string) => void;
  /** 整表回填：`AttributeMultiSelect` 自己管勾选、回调给的是「选中的全集」。 */
  setStyles: (values: string[]) => void;
  setTraitValues: (axisId: string, values: string[]) => void;
  submit: () => Promise<void>;
  /** 软删除的确认步骤：先记下目标 id，视图据此展开「确认吗」那一行。 */
  deleteTargetId: string | null;
  deletingId: string | null;
  askDelete: (id: string) => void;
  cancelDelete: () => void;
  confirmDelete: () => Promise<void>;
  /** 矩阵扇出：展开哪一条试验看它的座位表。 */
  expandedId: string | null;
  /** 展开某条试验（同时清掉上一次的批次结果，避免两批的话串到一行上）。 */
  expand: (id: string) => void;
  collapse: () => void;
  /** 展开那条试验的格子（含任务状态与成品图）；未展开时为空数组。 */
  cells: StyleLabCellWithStatus[];
  cellsLoading: boolean;
  /** 读座位表失败的一句话；null = 查询本身没问题（动作失败走 toast，不落这里）。 */
  cellsError: string | null;
  /** 正在扇出的那条试验（按钮文案与禁用态读它）。 */
  runningBatchId: string | null;
  /** 跑一批：整张矩阵按格串行入队，已出图的座位跳过。 */
  runBatch: (id: string) => Promise<void>;
  /** 正在取消的那条试验。 */
  stoppingBatchId: string | null;
  /** 停一批：取消这一试验名下仍在进行中的格子任务。 */
  stopBatch: (id: string) => Promise<void>;
  /** 最近一次扇出的那三句话；`null` = 这一屏还没跑过批。 */
  batchSummary: StyleLabBatchSummary | null;
  refresh: () => void;
}

/**
 * 由一行工作流算出它的就绪模式。
 *
 * 候选模式取 `modes ∪ defaultMode ∪ taskType` 的并集：一条工作流可声明多模式，
 * 而 `taskType` 常是默认模式、`defaultMode` 可能不在 `modes` 里 —— 三处都试一遍才
 * 不会漏掉某个其实能跑的模式。就绪判据逐模式现算（不缓存，工作流数量级小）。
 */
function readyModesOf(row: WorkflowListRow): string[] {
  const candidates = Array.from(
    new Set([
      ...row.modes,
      ...(row.defaultMode ? [row.defaultMode] : []),
      row.taskType,
    ]),
  );
  return candidates.filter(
    (mode) =>
      deriveEncapsulationStatus({
        io: row.workflowIO,
        paramMap: row.paramMap,
        mode,
      }).ready,
  );
}

/** 风格实验室的全部逻辑。容器与视图只消费这一份 controller。 */
export function useStyleLab(): StyleLabController {
  const trpc = useTRPC();
  const toast = useToast();

  const listQ = useQuery(
    trpc.styleLab.list.queryOptions(undefined, {
      placeholderData: (prev) => prev,
    }),
  );
  const workflowsQ = useQuery(
    trpc.workflow.list.queryOptions(undefined, { staleTime: 30_000 }),
  );

  const createMut = useMutation(trpc.styleLab.create.mutationOptions());
  const deleteMut = useMutation(trpc.styleLab.softDelete.mutationOptions());
  const runBatchMut = useMutation(trpc.styleLab.runBatch.mutationOptions());
  const stopBatchMut = useMutation(trpc.styleLab.stopBatch.mutationOptions());

  const [form, setForm] = useState<StyleLabCreateForm>(EMPTY_FORM);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /* 座位表按「展开了哪一条」现取：列表那 60 行不需要每行都带着一串任务状态，
     而展开的那一条要立刻看得见「这一格排队中 / 已完成」。 */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [batchSummary, setBatchSummary] = useState<StyleLabBatchSummary | null>(
    null,
  );

  const workflowOptions = useMemo<StyleLabWorkflowOption[]>(() => {
    /* `workflow.list` 返回的是聚合体 `{ workflows, localPending, localRoots }`，
     * 可挑的只有已落库那些行（`workflows`）；本地待导入 / 根目录不参与就绪判定。 */
    const rows = workflowsQ.data?.workflows ?? [];
    const out: StyleLabWorkflowOption[] = [];
    for (const row of rows) {
      const modes = readyModesOf(row);
      if (modes.length === 0) continue;
      out.push({
        id: row.id,
        name: row.name,
        readyModes: modes,
        defaultMode:
          row.defaultMode && modes.includes(row.defaultMode)
            ? row.defaultMode
            : modes[0] ?? "",
      });
    }
    return out;
  }, [workflowsQ.data]);

  const items = listQ.data?.items ?? [];
  const selectedOption = useMemo(
    () => workflowOptions.find((o) => o.id === form.workflowId) ?? null,
    [workflowOptions, form.workflowId],
  );

  const setName = useCallback(
    (value: string) => setForm((f) => ({ ...f, name: value })),
    [],
  );
  const selectWorkflow = useCallback(
    (id: string) => {
      // 换工作流时把 mode 一并落到「这个工作流真的就绪」的那个模式上，
      // 否则会出现「workflowId 换了、mode 还是上一个的」这种提交必被后端拒的态。
      setForm((f) => {
        const next = f.workflowId === id ? f : { ...f, workflowId: id };
        const option = workflowOptions.find((o) => o.id === id);
        const mode = option
          ? option.defaultMode
          : id === ""
            ? ""
            : next.mode;
        return { ...next, mode };
      });
    },
    [workflowOptions],
  );
  const setMode = useCallback(
    (mode: string) => setForm((f) => ({ ...f, mode })),
    [],
  );
  const setStyles = useCallback(
    (values: string[]) => setForm((f) => ({ ...f, styles: values })),
    [],
  );
  const setTraitValues = useCallback(
    (axisId: string, values: string[]) =>
      setForm((f) => ({ ...f, traits: { ...f.traits, [axisId]: values } })),
    [],
  );

  const preview = useMemo(
    () =>
      plannedMatrixPreview(
        form.styles,
        form.traits,
        listQ.data?.medianSecPerImage ?? null,
      ),
    [form.styles, form.traits, listQ.data?.medianSecPerImage],
  );
  const validation = useMemo(() => validateCreateForm(form), [form]);

  /* 反馈通道注入给 runAsyncAction：成功走 toast.success、失败走 toast.error，
     与全库同一口径（规范 §16.2.4.30）。 */
  const report: ActionReport = useCallback(
    (kind, detail) => {
      if (kind === "ok") toast.success(detail);
      else toast.error(detail);
    },
    [toast],
  );

  const submit = useCallback(async () => {
    if (!validation.ok) return;
    const result = await runAsyncAction(
      async () => {
        await createMut.mutateAsync({
          name: form.name.trim(),
          workflowId: form.workflowId,
          mode: form.mode,
          styles: form.styles,
          traits: form.traits,
          params: {},
        });
      },
      {
        report,
        /* 就绪校验、组合闸、归属都在后端：runAsyncAction 的 catch 走
           errorMessage(error, failureText)，服务端那句「缺哪个口」原样上屏，
           压成「创建失败」就丢掉了下一步动作的依据。 */
        failureText: "创建试验失败，请稍后重试",
        successText: "已登记试验 —— 在列表里展开这一条就能跑这批",
        readResultEnvelope: false,
      },
    );
    if (!result.ok) return;
    setForm(EMPTY_FORM);
    void listQ.refetch();
  }, [createMut, form, listQ, report, validation.ok]);

  const askDelete = useCallback((id: string) => setDeleteTargetId(id), []);
  const cancelDelete = useCallback(() => setDeleteTargetId(null), []);

  const confirmDelete = useCallback(async () => {
    const id = deleteTargetId;
    if (!id) return;
    setDeletingId(id);
    const result = await runAsyncAction(
      async () => {
        await deleteMut.mutateAsync({ id });
      },
      {
        report,
        failureText: "删除失败，请稍后重试",
        successText: "已删除试验",
        readResultEnvelope: false,
      },
    );
    setDeletingId(null);
    setDeleteTargetId(null);
    if (result.ok) void listQ.refetch();
  }, [deleteMut, deleteTargetId, listQ, report]);

  /* 座位表：展开了那一条才读。`enabled` 挡住未展开时的往返 —— 列表那几十行不必
     每行都带着一串任务状态与产物图。 */
  const detailQ = useQuery({
    ...trpc.styleLab.detail.queryOptions({ id: expandedId ?? "" }),
    enabled: expandedId !== null,
  });

  const expand = useCallback((id: string) => {
    /* 换一条看就把上一次的批次结果清掉：那三句话说的是**那一批**，留在另一条试验
       的行下面会变成「这条也跑过了」的假账。 */
    setExpandedId((prev) => {
      if (prev !== id) setBatchSummary(null);
      return id;
    });
  }, []);
  const collapse = useCallback(() => {
    setExpandedId(null);
    setBatchSummary(null);
  }, []);

  const runBatch = useCallback(
    async (id: string) => {
      /* 扇出的结果要拿来拼那三句话，而 `runAsyncAction` 只回「成/败 + 文案」，
         所以在这里接住原值：反馈仍然由它统一走（失败时服务端那句「尚未封装就绪，
         缺：提示词」或「一次最多跑 60 格」原样上屏 —— 压成「生成失败」就丢掉了
         下一步动作的依据），成功那一句由结果派生。

         用 holder 而不是 `let outcome = null` 再在闭包里赋值：TS 不跟踪闭包里的
         赋值，外面那次判空会被收窄成「永远是 null」，下一步就报 `never`。 */
      const got: { outcome: StyleLabBatchOutcome | null } = { outcome: null };
      const result = await runAsyncAction(
        async () => {
          got.outcome = await runBatchMut.mutateAsync({ id });
        },
        {
          report,
          failureText: "跑这批失败",
          readResultEnvelope: false,
        },
      );
      const outcome = got.outcome;
      if (!result.ok || !outcome) return;
      const summary = summarizeBatch(outcome);
      setBatchSummary(summary);
      report("ok", summary.queuedText);
      void listQ.refetch();
      void detailQ.refetch();
    },
    [detailQ, listQ, report, runBatchMut],
  );

  const stopBatch = useCallback(
    async (id: string) => {
      const got: { outcome: StyleLabStopOutcome | null } = { outcome: null };
      const result = await runAsyncAction(
        async () => {
          got.outcome = await stopBatchMut.mutateAsync({ id });
        },
        {
          report,
          failureText: "取消这批失败",
          readResultEnvelope: false,
        },
      );
      const outcome = got.outcome;
      if (!result.ok || !outcome) return;
      /* 「0 条」也要说：按了停止却一句话没有，用户分不清「没得取消」与「没取消掉」。 */
      report(
        "ok",
        outcome.cancelled > 0
          ? `已取消 ${String(outcome.cancelled)} 格` +
            (outcome.alreadyDone > 0
              ? `，另有 ${String(outcome.alreadyDone)} 格已出完`
              : "")
          : "这一批没有在跑的任务可取消",
      );
      void listQ.refetch();
      void detailQ.refetch();
    },
    [detailQ, listQ, report, stopBatchMut],
  );

  return {
    loading: listQ.isPending,
    loadError: listQ.isError ? "读不到试验记录，后端可能刚重启" : null,
    items,
    workflowOptions,
    form,
    selectedModes: selectedOption?.readyModes ?? [],
    preview,
    formError: validation.ok ? null : validation.message,
    canSubmit: validation.ok && !createMut.isPending,
    creating: createMut.isPending,
    setName,
    selectWorkflow,
    setMode,
    setStyles,
    setTraitValues,
    submit,
    deleteTargetId,
    deletingId,
    askDelete,
    cancelDelete,
    confirmDelete,
    expandedId,
    expand,
    collapse,
    cells: detailQ.data?.cells ?? [],
    cellsLoading: detailQ.isPending && expandedId !== null,
    cellsError: detailQ.isError ? "读不到这一条的格子，后端可能刚重启" : null,
    runningBatchId: runBatchMut.isPending ? (runBatchMut.variables?.id ?? null) : null,
    runBatch,
    stoppingBatchId: stopBatchMut.isPending ? (stopBatchMut.variables?.id ?? null) : null,
    stopBatch,
    batchSummary,
    refresh: () => void listQ.refetch(),
  };
}
