"use client";

// ── 角色库：逻辑层（规范 17 §17.2 第②层）──────────────────────────────
// 承载列表查询（关键词 / 标签 AND / 状态）、预置入库、批量生图入队、生成对账
// 轮询、详情与删除。CharacterLibrary 视图只消费本 hook 返回的 controller。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useInterval } from "~/components/ui/use-interval";
import { runAsyncAction } from "~/lib/async-action";
import type { RouterOutputs } from "~/trpc/react";

import { useToast } from "../../ToastProvider";
import { useTRPC } from "~/trpc/react";
import type { CharacterStatusFilter } from "../character-status";

/** 列表接口的行形状（服务端响应原样；createdAt 跨 JSON 边界转字符串）。 */
export type CharacterListItem = Omit<
  RouterOutputs["characterLibrary"]["list"]["items"][number],
  "createdAt"
> & {
  createdAt: string;
};

/** 详情接口的行形状。 */
export type CharacterDetail = RouterOutputs["characterLibrary"]["detail"];

/** 工作流库列表行（生图工作流选择器用）。 */
export type WorkflowRow = RouterOutputs["workflow"]["list"]["workflows"][number];

/** 生成对账的轮询间隔（有生成中角色时；确定性短间隔，ISSUE #4118 口径）。 */
const SYNC_INTERVAL_MS = 5000;

export type CharacterLibraryController = {
  /** 取消删除（ConfirmDialog 的关闭侧）。 */
  cancelRemove: () => void;
  /** 关闭详情弹层（open 由 detailId 派生，不清掉它就「关不掉」）。 */
  closeDetail: () => void;
  /** 删除（非阻塞确认由视图挂 ConfirmDialog 承接）。 */
  confirmRemove: () => Promise<void>;
  /** 手工创建角色（标签由服务端从描述提取）。 */
  createCharacter: (values: {
    archetype: string;
    description: string;
    gender: string;
    name: string;
  }) => Promise<boolean>;
  /** 创建进行中（按钮禁用）。 */
  creating: boolean;
  /** 删除进行中（按钮禁用）。 */
  deleting: boolean;
  /** 详情弹层的内容（打开时现取；关闭时为 null）。 */
  detail: CharacterDetail | null;
  /** 详情弹层正在展示的角色 id。 */
  detailId: string | null;
  detailLoading: boolean;
  /** 空态文案（区分「还没有角色」与「当前筛选下没有」）。 */
  empty: { hint: string; title: string };
  /** 批量生图（入队后立即刷新列表；进度由轮询对账推进）。 */
  enqueueGeneration: (workflowId: string, limit: number) => Promise<boolean>;
  /** 生图入队进行中（按钮禁用）。 */
  enqueuing: boolean;
  /** 最近一次批量打分发现的问题立绘数（null = 还没打过分）。 */
  flaggedCount: number | null;
  /** 是否存在「生成中」角色（驱动轮询与按钮态）。 */
  generating: boolean;
  /** 角色行（列表接口的形状）。 */
  items: Array<CharacterListItem>;
  loading: boolean;
  /** 打开详情弹层。 */
  openDetail: (id: string) => void;
  /** 打开删除确认弹窗（非阻塞，与资产库同一纪律）。 */
  openRemove: (id: string) => void;
  /** 关键词（受控输入）。 */
  q: string;
  refresh: () => void;
  /** 重新生成有问题的立绘（低分者退回待生成并按原链入队）。 */
  regenerateFlagged: () => Promise<boolean>;
  /** 重生成进行中（按钮禁用）。 */
  regenerating: boolean;
  /** 待删除目标（ConfirmDialog 的 open 侧）。 */
  removeTarget: string | null;
  /** 质量打分（批量）：依次给每张已就绪立绘打分；返回有问题的张数（失败 = -1）。 */
  scoreAllQuality: () => Promise<number>;
  /** 质量打分（单张，详情弹窗用）。 */
  scoreOne: (id: string) => Promise<boolean>;
  /** 批量打分进行中（按钮禁用）。 */
  scoring: boolean;
  /** 预置一批角色（组合式生成器；同种子重跑幂等）。 */
  seed: (count: number) => Promise<boolean>;
  seeding: boolean;
  /** 当前选中的标签（多选，AND 语义）。 */
  selectedTags: Array<string>;
  /** 关键词输入。 */
  setQ: (q: string) => void;
  /** 切状态过滤档。 */
  setStatus: (status: CharacterStatusFilter) => void;
  status: CharacterStatusFilter;
  /** 状态角标（各状态角色数）。 */
  statusCounts: Record<string, number>;
  /** 手动触发一次生成对账（轮询之外的即时口）。 */
  syncNow: () => void;
  /** 标签分面（当前过滤条件下每个标签的命中数，降序）。 */
  tagFacets: Array<{ count: number; tag: string }>;
  /** 切换一个标签的选中态。 */
  toggleTag: (tag: string) => void;
  /** 更新角色档案（描述 / 原型变了由服务端重提标签）。 */
  updateCharacter: (
    id: string,
    values: { archetype: string; description: string; gender: string },
  ) => Promise<boolean>;
  /** 保存修改进行中（按钮禁用）。 */
  updating: boolean;
  /** 工作流库列表（生图工作流选择器；挑可执行图片工作流的职责在视图）。 */
  workflows: Array<WorkflowRow>;
  workflowsLoading: boolean;
};

export function useCharacterLibrary(): CharacterLibraryController {
  const trpc = useTRPC();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<CharacterStatusFilter>("all");
  const [selectedTags, setSelectedTags] = useState<Array<string>>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  /** 最近一次批量打分发现的问题立绘数（null = 还没打过分）。 */
  const [flaggedCount, setFlaggedCount] = useState<number | null>(null);
  /** 轮询去重：一次只允许一个对账请求在飞。 */
  const syncingRef = useRef(false);

  const listQ = useQuery(
    trpc.characterLibrary.list.queryOptions({
      q,
      status,
      tags: selectedTags,
      take: 200,
    }),
  );
  const workflowsQ = useQuery(trpc.workflow.list.queryOptions(undefined));
  const workflows = useMemo(() => workflowsQ.data?.workflows ?? [], [workflowsQ.data]);
  const detailQ = useQuery(
    trpc.characterLibrary.detail.queryOptions(
      { id: detailId ?? "" },
      { enabled: detailId !== null },
    ),
  );

  const invalidateList = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: trpc.characterLibrary.list.queryKey() });
  }, [queryClient, trpc]);

  const items = useMemo<CharacterListItem[]>(
    () =>
      (listQ.data?.items ?? []).map((row) => ({
        ...row,
        createdAt:
          row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      })),
    [listQ.data],
  );

  /* ── 写动作：预置 / 入队 / 对账 / 删除 ─────────────────────────── */

  const seedMut = useMutation(trpc.characterLibrary.seed.mutationOptions());
  const enqueueMut = useMutation(trpc.characterLibrary.enqueueGeneration.mutationOptions());
  const syncMut = useMutation(trpc.characterLibrary.syncGeneration.mutationOptions());
  const deleteMut = useMutation(trpc.characterLibrary.delete.mutationOptions());
  const createMut = useMutation(trpc.characterLibrary.create.mutationOptions());
  const updateMut = useMutation(trpc.characterLibrary.update.mutationOptions());
  const scoreAllMut = useMutation(trpc.characterLibrary.scoreAllQuality.mutationOptions());
  const scoreOneMut = useMutation(trpc.characterLibrary.scoreQuality.mutationOptions());
  const regenerateMut = useMutation(trpc.characterLibrary.regenerateFlagged.mutationOptions());

  /** 手工创建一个角色（标签由服务端从描述提取）。 */
  const createCharacter = useCallback(
    async (values: { archetype: string; description: string; gender: string; name: string }) => {
      const result = await runAsyncAction(
        async () => {
          await createMut.mutateAsync(values);
          return { ok: true, detail: `已创建角色「${values.name}」` };
        },
        {
          report: (kind, detail) => (kind === "ok" ? toast.success(detail) : toast.error(detail)),
          failureText: "创建角色失败，请稍后重试",
        },
      );
      invalidateList();
      return result.ok;
    },
    [createMut, invalidateList, toast],
  );

  /** 更新角色档案（描述 / 原型变了由服务端重提标签；撞名转 409 文案）。 */
  const updateCharacter = useCallback(
    async (id: string, values: { archetype: string; description: string; gender: string }) => {
      const result = await runAsyncAction(
        async () => {
          await updateMut.mutateAsync({ id, ...values });
          return { ok: true, detail: "已保存修改" };
        },
        {
          report: (kind, detail) => (kind === "ok" ? toast.success(detail) : toast.error(detail)),
          failureText: "保存修改失败，请稍后重试",
        },
      );
      invalidateList();
      void queryClient.invalidateQueries({ queryKey: trpc.characterLibrary.detail.queryKey() });
      return result.ok;
    },
    [invalidateList, queryClient, toast, trpc, updateMut],
  );

  const seed = useCallback(
    async (count: number): Promise<boolean> => {
      const result = await runAsyncAction(
        async () => {
          const res = await seedMut.mutateAsync({
            count,
            // 固定种子：同参数重跑幂等（撞名跳过），不会翻倍膨胀。
            seed: 20_261_125,
          });
          return {
            ok: true,
            detail:
              res.skipped > 0
                ? `已预置 ${res.created} 个角色（${res.skipped} 个与现有角色同名，已跳过）`
                : `已预置 ${res.created} 个角色`,
          };
        },
        {
          report: (kind, detail) => (kind === "ok" ? toast.success(detail) : toast.error(detail)),
          failureText: "预置角色失败，请稍后重试",
        },
      );
      invalidateList();
      return result.ok;
    },
    [invalidateList, seedMut, toast],
  );

  const enqueueGeneration = useCallback(
    async (workflowId: string, limit: number): Promise<boolean> => {
      const result = await runAsyncAction(
        async () => {
          const res = await enqueueMut.mutateAsync({ workflowId, limit });
          return {
            ok: true,
            detail: `已入队 ${res.enqueued} 个角色的生图任务（工作流：${res.workflowName}）`,
          };
        },
        {
          report: (kind, detail) => (kind === "ok" ? toast.success(detail) : toast.error(detail)),
          failureText: "生图任务入队失败，请稍后重试",
        },
      );
      invalidateList();
      return result.ok;
    },
    [enqueueMut, invalidateList, toast],
  );

  /** 对账一次：把生成中角色的任务终态回写，再刷新列表。 */
  const syncNow = useCallback(async () => {
    if (syncingRef.current) {
      return;
    }
    syncingRef.current = true;
    try {
      await syncMut.mutateAsync();
      invalidateList();
    } catch {
      // 对账失败不打断轮询：下一轮再试（任务仍在队列里推进）。
    } finally {
      syncingRef.current = false;
    }
  }, [invalidateList, syncMut]);

  const confirmRemove = useCallback(async (): Promise<void> => {
    if (removeTarget === null) {
      return;
    }
    const target = items.find((row) => row.id === removeTarget)?.name ?? "角色";
    await runAsyncAction(
      async () => {
        await deleteMut.mutateAsync({ id: removeTarget });
        return { ok: true, detail: `已删除角色 ${target}` };
      },
      {
        report: (kind, detail) => (kind === "ok" ? toast.success(detail) : toast.error(detail)),
        failureText: "删除失败，请稍后重试",
      },
    );
    setRemoveTarget(null);
    invalidateList();
  }, [deleteMut, invalidateList, items, removeTarget, toast]);

  /** 质量打分（批量）：依次给每张已就绪立绘打分；返回有问题的张数。 */
  const scoreAllQuality = useCallback(async (): Promise<number> => {
    let flagged = 0;
    const result = await runAsyncAction(
      async () => {
        const res = await scoreAllMut.mutateAsync();
        flagged = res.flagged.length;
        setFlaggedCount(res.flagged.length);
        return {
          ok: true,
          detail:
            res.flagged.length > 0
              ? `已为 ${res.scored} 张立绘打分：${res.flagged.length} 张有问题，建议重新生成`
              : `已为 ${res.scored} 张立绘打分：全部正常`,
        };
      },
      {
        report: (kind, detail) => (kind === "ok" ? toast.success(detail) : toast.error(detail)),
        failureText: "质量打分失败，请稍后重试",
      },
    );
    invalidateList();
    return result.ok ? flagged : -1;
  }, [invalidateList, scoreAllMut, toast]);

  /** 质量打分（单张，详情弹窗用）。 */
  const scoreOne = useCallback(
    async (id: string): Promise<boolean> => {
      const result = await runAsyncAction(
        async () => {
          const res = await scoreOneMut.mutateAsync({ id });
          return {
            ok: true,
            detail: `「${res.name}」立绘质量分 ${res.score}${res.needsRegeneration ? "（建议重新生成）" : ""}`,
          };
        },
        {
          report: (kind, detail) => (kind === "ok" ? toast.success(detail) : toast.error(detail)),
          failureText: "质量打分失败，请稍后重试",
        },
      );
      invalidateList();
      return result.ok;
    },
    [invalidateList, scoreOneMut, toast],
  );

  /** 重新生成有问题的立绘：低分角色退回待生成并按原链入队。 */
  const regenerateFlagged = useCallback(async (): Promise<boolean> => {
    const imageWorkflows = workflows.filter(
      (workflow) => workflow.taskType === "T2I" || workflow.taskType === "TXT2IMG",
    );
    const workflowId =
      imageWorkflows.find((workflow) => workflow.name.toLowerCase().includes("minimax"))?.id ??
      imageWorkflows[0]?.id ??
      null;
    if (workflowId === null) {
      toast.error("没有可用的文生图工作流，无法重新生成");
      return false;
    }
    const result = await runAsyncAction(
      async () => {
        const res = await regenerateMut.mutateAsync({ workflowId });
        return {
          ok: true,
          detail: `已重新生成 ${res.regenerated} 张问题立绘（工作流：${res.workflowName}）`,
        };
      },
      {
        report: (kind, detail) => (kind === "ok" ? toast.success(detail) : toast.error(detail)),
        failureText: "重新生成失败，请稍后重试",
      },
    );
    invalidateList();
    return result.ok;
  }, [invalidateList, regenerateMut, toast, workflows]);

  /* ── 生成中角色的确定性轮询（P12：轮询统一走 useInterval，不自己写
   * setInterval）。没有生成中角色时 run 直接返回、不发请求；轮询随页签
   * 隐藏自动暂停（useInterval 内建），回来时按 immediate 补跑一拍。 ── */
  const generating = (listQ.data?.statusCounts.generating ?? 0) > 0;
  const generatingRef = useRef(false);
  useEffect(() => {
    generatingRef.current = generating;
  }, [generating]);

  useInterval(
    () => {
      if (!generatingRef.current) {
        return;
      }
      void syncNow();
    },
    { ms: SYNC_INTERVAL_MS },
  );

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }, []);

  const empty = useMemo(() => {
    if (q.trim() === "" && selectedTags.length === 0 && status === "all") {
      return {
        title: "角色库还是空的",
        hint: "先「预置角色」批量生成一批档案，再用「批量生图」给它们逐一立绘。",
      };
    }
    return { title: "没有匹配的角色", hint: "换个关键词、少选几个标签，或切一个状态档试试。" };
  }, [q, selectedTags.length, status]);

  return {
    cancelRemove: () => {
      setRemoveTarget(null);
    },
    confirmRemove,
    createCharacter,
    creating: createMut.isPending,
    deleting: deleteMut.isPending,
    detail: detailQ.isSuccess ? detailQ.data : null,
    detailId,
    detailLoading: detailQ.isFetching,
    closeDetail: () => {
      setDetailId(null);
    },
    empty,
    enqueueGeneration,
    enqueuing: enqueueMut.isPending,
    generating,
    items,
    loading: listQ.isPending,
    openDetail: (id: string) => {
      setDetailId(id);
    },
    openRemove: (id: string) => {
      setRemoveTarget(id);
    },
    q,
    refresh: invalidateList,
    removeTarget,
    seed,
    seeding: seedMut.isPending,
    selectedTags,
    setQ,
    setStatus,
    status,
    statusCounts: listQ.data?.statusCounts ?? {},
    syncNow: () => {
      void syncNow();
    },
    scoreAllQuality,
    scoring: scoreAllMut.isPending,
    scoreOne,
    regenerateFlagged,
    regenerating: regenerateMut.isPending,
    flaggedCount,
    tagFacets: listQ.data?.tagFacets ?? [],
    toggleTag,
    updateCharacter,
    updating: updateMut.isPending,
    workflows,
    workflowsLoading: workflowsQ.isPending,
  };
}
