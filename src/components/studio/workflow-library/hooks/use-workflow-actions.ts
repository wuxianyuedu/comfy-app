"use client";

/** P4：从 WorkflowLibrary 的动作回调块抽出
 *  （handleUpgradeConfirm / handleDelete / patchModes / patchModelTags /
 *  downloadJson / resyncWorkflow / handleLoadPending）。该 hook 接收
 *  它需要的原始状态 setter + trpc mutation，返回稳定的
 *  回调；组件只保留状态声明与 JSX。
 *
 *  归位 `hooks/`（规范 17 §17.2 第②层 —— 此前它在 feature 根目录，
 *  名字像逻辑层、位置却不是）。`setImportErr` 同步改名为 `setActionError`：
 *  它承接的是动作失败（删除 / 下载 / 同步 / 载入），不是导入面板的校验错误，
 *  按 §17.5.4 必须走「只有用户重试才清」的通道。
 */
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTRPC, type RouterInputs, type RouterOutputs } from "~/trpc/react";
import { runAsyncAction, type ActionReport } from "~/lib/async-action";
import { downloadJson as saveJsonFile } from "~/lib/browser-io";
import { useToast } from "../../ToastProvider";
import type { WorkflowRow } from "../workflow-library-config";

/** 注入的 mutation 实例只用到 `mutateAsync` 这一面（窄接口口径同
 *  `use-settings-page-save` 的 `MutationLike`）：入参 / 出参类型取自 router
 *  本身（`RouterInputs` / `RouterOutputs`），服务端改了 schema 这里会跟着红，
 *  而不是在动作层里抄一份会漂的字段表。 */
export type MutateAsyncLike<TInput, TOutput> = {
  mutateAsync: (input: TInput) => Promise<TOutput>;
};

export type UseWorkflowActionsArgs = {
  createMut: MutateAsyncLike<
    RouterInputs["workflow"]["create"],
    RouterOutputs["workflow"]["create"]
  >;
  deleteMut: MutateAsyncLike<
    RouterInputs["workflow"]["delete"],
    RouterOutputs["workflow"]["delete"]
  >;
  load: () => Promise<void> | void;
  resyncMut: MutateAsyncLike<
    RouterInputs["workflow"]["resync"],
    RouterOutputs["workflow"]["resync"]
  >;
  /** 「哪一条在下载 / 在同步」的执行态由 `~/components/ui/use-item-action` 给
   *  （规范 16 §16.2.4.40）—— 这里只拿它的 `run`（忙标记 + 同步判重入一次给全）。 */
  runBundle: <T>(id: string, action: () => Promise<T>) => Promise<T | undefined>;
  runResync: <T>(id: string, action: () => Promise<T>) => Promise<T | undefined>;
  setActionError: (v: string) => void;
  setDeleting: (v: boolean) => void;
  setPendingDelete: (v: { id: string; name: string } | null) => void;
  setPendingLoading: (fn: (s: Record<string, boolean>) => Record<string, boolean>) => void;
  setWorkflows: (fn: (prev: Array<WorkflowRow>) => Array<WorkflowRow>) => void;
  updateMut: MutateAsyncLike<
    RouterInputs["workflow"]["update"],
    RouterOutputs["workflow"]["update"]
  >;
};

export function useWorkflowActions(args: UseWorkflowActionsArgs) {
  const {
    createMut,
    deleteMut,
    load,
    resyncMut,
    runBundle,
    runResync,
    setActionError,
    setDeleting,
    setPendingDelete,
    setPendingLoading,
    setWorkflows,
    updateMut,
  } = args;
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toast = useToast();

  /* 反馈通道适配：**成功静默**（这一批动作大多刷新列表即可见，
   * 再弹一句是噪声），失败走 toast（规范 16 §16.2.4.30）。 */
  const report: ActionReport = useCallback(
    (kind, detail) => {
      if (kind === "err") {
        toast.error(detail);
      }
    },
    [toast],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setDeleting(true);
      /* 删除失败走**行内错误条**（`setActionError`）而不是 toast：它是
       * §17.5.4 的「只有用户重试才清」通道 —— 这一批里唯一一条会因为
       * 「文件被占用」反复失败的动作用户需要看着它改。反馈通道由调用处
       * 注入，所以这里换一个 `report`（出口只负责文案归一）。 */
      try {
        const result = await runAsyncAction(() => deleteMut.mutateAsync({ id }), {
          failureText: "删除失败",
          report: (kind, detail) => {
            if (kind === "err") {
              setActionError(detail);
            }
          },
        });
        if (result.ok) {
          setPendingDelete(null);
          void load();
        }
      } finally {
        /* 复位绑在 `finally` 上 —— 收口前写在动作之后，`load()` 里任意一行
         * 抛错就永远停在「删除中」。 */
        setDeleting(false);
      }
    },
    [setDeleting, deleteMut, setPendingDelete, load, setActionError],
  );

  /** 多模式持久化。乐观更新本地列表，失败则回滚（重新拉取列表）。 */
  const patchModes = useCallback(
    async (id: string, modes: Array<string>, defaultMode: string) => {
      setWorkflows((prev) =>
        prev.map((workflow) =>
          workflow.id === id
            ? { ...workflow, defaultMode, modes, taskType: defaultMode }
            : workflow,
        ),
      );
      // taskType 与 defaultMode 一并回写：服务端仅在显式传入时才更新该列，
      // 缺了它 DB 的 taskType 会与本地乐观更新的值漂移（旧 type 筛选失准）。
      const result = await runAsyncAction(
        () =>
          updateMut.mutateAsync({
            defaultMode,
            id,
            modes,
            taskType: defaultMode,
          }),
        { failureText: "更新模式失败", report },
      );
      /* 失败回滚：重新拉取列表，本地乐观更新的值被服务端真值替换。 */
      if (!result.ok) {
        void load();
      }
    },
    [setWorkflows, updateMut, report, load],
  );

  /** 模型标签绑定持久化。乐观更新本地列表，失败回滚。 */
  const patchModelTags = useCallback(
    async (id: string, names: Array<string>) => {
      setWorkflows((prev) =>
        prev.map((workflow) => (workflow.id === id ? { ...workflow, modelTags: names } : workflow)),
      );
      const result = await runAsyncAction(() => updateMut.mutateAsync({ id, modelTags: names }), {
        failureText: "更新模型标签失败",
        report,
      });
      if (!result.ok) {
        void load();
      }
    },
    [setWorkflows, updateMut, report, load],
  );

  /** 整体落库 workflowIO（详情预览里改 seed「控件后行为」等参数级配置）。
   *  成功后失效 detail 缓存，预览面板按富化后的数据重渲染。 */
  /** 对外参数落点（`paramMap.source.mode:<模式>`）持久化。
   *
   *  与 `patchWorkflowIO` 同一路径（PATCH 整列 + 失效两个 detail 缓存）：库里
   *  拖一条线改落点，预览与编辑器都不该读到一个过期的 paramMap。 */
  const patchParamMap = useCallback(
    async (id: string, paramMap: Record<string, unknown>) => {
      await runAsyncAction(
        async () => {
          await updateMut.mutateAsync({ id, paramMap });
          await queryClient.invalidateQueries(trpc.workflow.detail.queryFilter({ id }));
          await queryClient.invalidateQueries(trpc.workflow.detailFull.queryFilter({ id }));
        },
        { failureText: "更新参数映射失败", report },
      );
    },
    [updateMut, trpc, queryClient, report],
  );

  const patchWorkflowIO = useCallback(
    async (id: string, workflowIO: Record<string, unknown>) => {
      await runAsyncAction(
        async () => {
          await updateMut.mutateAsync({ id, workflowIO });
          /* detailFull 才是预览表单的数据源（它带服务端富化的 defaultValue），
           * 只失效 detail 的话富化 IO 的缓存查询不会重拉 → 默认值不刷新。 */
          await queryClient.invalidateQueries(trpc.workflow.detail.queryFilter({ id }));
          await queryClient.invalidateQueries(trpc.workflow.detailFull.queryFilter({ id }));
        },
        { failureText: "更新参数配置失败", report },
      );
    },
    [updateMut, trpc, queryClient, report],
  );

  /** 下载当前工作流 JSON —— 下载的是**这条工作流自己的原件**
   *  （ComfyUI 的工作流 / RAW 格式，与导入时逐字一致）。 */
  const downloadJson = useCallback(
    async (id: string, name: string) => {
      await runBundle(id, async () => {
        /* 三条「没做成」各有各的说辞（没取到模板 / 没有可下载内容 / 请求失败），
         * 所以**不**用出口的 `successText` —— 出口管的是「结果怎么变成反馈」，
         * 分支文案仍归调用处。抛错那一支仍走出口（`errorMessage` 兜底）。 */
        await runAsyncAction(
          async () => {
            const d = await queryClient.fetchQuery(trpc.workflow.detail.queryOptions({ id }));
            const tpl = d?.template;
            if (!tpl) {
              toast.error("获取工作流失败", "未知错误");
              return true;
            }
            const payload = tpl.rawJson ?? null;
            if (payload == null) {
              toast.error("下载失败", "该工作流没有可下载的内容");
              return true;
            }
            saveJsonFile(payload, `${tpl.name ?? name}.json`);
            toast.success("已下载工作流", `${tpl.name ?? name}.json`);
            return true;
          },
          { failureText: "下载失败", report },
        );
        /* 忙标记由 `useItemAction` 的 `finally` 清（收口前这里是手写的
         * `setBundleBusy(null)`，漏一处就留下一个永不解除的忙标记）。 */
      });
    },
    [toast, runBundle, trpc, queryClient, report],
  );

  /** 重新导入本地工作流的源文件并刷新。 */
  const resyncWorkflow = useCallback(
    async (id: string, name: string) => {
      await runResync(id, async () => {
        /* 三个结果分支各有各的说辞（磁盘没了 / 没变 / 已同步）——
         * 那是本动作的域判据，留在调用处；抛错那一支走出口。 */
        await runAsyncAction(
          async () => {
            const d = await resyncMut.mutateAsync({ id });
            if (d?.missing) {
              toast.error("同步失败", "磁盘文件已不存在，无法同步（请检查路径或重新载入）");
            } else if (d?.unchanged) {
              toast.info("磁盘文件未变化", name);
            } else if (d?.updated) {
              toast.success("已同步磁盘内容", name);
              await load();
            }
            return true;
          },
          { failureText: "同步请求失败", report },
        );
      });
    },
    [toast, load, runResync, resyncMut, report],
  );

  /** 把磁盘上发现的一个文件经单文件导入
   *  路由载入 DB（唯一受支持的本地导入流程）。 */
  const handleLoadPending = useCallback(
    async (pending: { id: string; name: string; sourcePath: string }) => {
      setPendingLoading((state) => ({ ...state, [pending.id]: true }));
      const result = await runAsyncAction(
        () =>
          createMut.mutateAsync({
            name: pending.name,
            sourcePath: pending.sourcePath,
          }),
        {
          failureText: "载入失败",
          report,
          successText: `已载入「${pending.name}」`,
        },
      );
      if (result.ok) {
        void load();
      }
      setPendingLoading((state) => {
        const cp = { ...state };
        delete cp[pending.id];
        return cp;
      });
    },
    [setPendingLoading, createMut, report, load],
  );

  return {
    downloadJson,
    handleDelete,
    handleLoadPending,
    patchModelTags,
    patchModes,
    patchParamMap,
    patchWorkflowIO,
    resyncWorkflow,
  };
}
