"use client";

/** P4: extracted from WorkflowLibrary's action-callback block
 *  (handleUpgradeConfirm / handleDelete / patchModes / patchModelTags /
 *  downloadJson / resyncWorkflow / handleLoadPending).  The hook receives
 *  the raw state setters + trpc mutations it needs and returns the stable
 *  callbacks; the component keeps only the state declarations and the JSX.
 *
 *  归位 `hooks/`（规范 17 §17.2 第②层——此前它在 feature 根目录，
 *  名字像逻辑层、位置却不是）。`setImportErr` 同步改名为 `setActionError`：
 *  它承接的是动作失败（删除 / 下载 / 同步 / 载入），不是导入面板的校验错误，
 *  按 §17.5.4 必须走「只有用户重试才清」的通道。
 */
import { useCallback } from "react";
import { type api } from "~/trpc/react";
import { errorMessage } from "~/lib/error-message";
import { useToast } from "../../ToastProvider";
import type { WorkflowRow } from "../workflow-library-config";

export interface UseWorkflowActionsArgs {
  setDeleting: (v: boolean) => void;
  setPendingDelete: (v: { id: string; name: string } | null) => void;
  setActionError: (v: string) => void;
  setBundleBusy: (v: string | null) => void;
  setResyncBusy: (v: string | null) => void;
  setPendingLoading: (
    fn: (s: Record<string, boolean>) => Record<string, boolean>,
  ) => void;
  setWorkflows: (fn: (prev: WorkflowRow[]) => WorkflowRow[]) => void;
  load: () => Promise<void> | void;
  updateMut: ReturnType<typeof api.workflow.update.useMutation>;
  deleteMut: ReturnType<typeof api.workflow.delete.useMutation>;
  resyncMut: ReturnType<typeof api.workflow.resync.useMutation>;
  createMut: ReturnType<typeof api.workflow.create.useMutation>;
  utils: ReturnType<typeof api.useUtils>;
}

export function useWorkflowActions(args: UseWorkflowActionsArgs) {
  const {
    setDeleting,
    setPendingDelete,
    setActionError,
    setBundleBusy,
    setResyncBusy,
    setPendingLoading,
    setWorkflows,
    load,
    updateMut,
    deleteMut,
    resyncMut,
    createMut,
    utils,
  } = args;
  const toast = useToast();

  const handleDelete = useCallback(
    async (id: string) => {
      setDeleting(true);
      try {
        await deleteMut.mutateAsync({ id });
        setPendingDelete(null);
        void load();
      } catch (e) {
        setActionError(errorMessage(e, "删除失败"));
      } finally {
        setDeleting(false);
      }
    },
    [setDeleting, deleteMut, setPendingDelete, load, setActionError],
  );

  /** 多模式持久化。乐观更新本地列表，失败则回滚（重新拉取列表）。 */
  const patchModes = useCallback(
    async (id: string, modes: string[], defaultMode: string) => {
      setWorkflows((prev) =>
        prev.map((workflow) =>
          workflow.id === id
            ? { ...workflow, modes, defaultMode, taskType: defaultMode }
            : workflow,
        ),
      );
      try {
        // taskType 与 defaultMode 一并回写：服务端仅在显式传入时才更新该列，
        // 缺了它 DB 的 taskType 会与本地乐观更新的值漂移（旧 type 筛选失准）。
        await updateMut.mutateAsync({
          id,
          modes,
          defaultMode,
          taskType: defaultMode,
        });
      } catch (e) {
        toast.error("更新模式失败", errorMessage(e, "未知错误"));
        void load();
      }
    },
    [setWorkflows, updateMut, toast, load],
  );

  /** 模型标签绑定持久化。乐观更新本地列表，失败回滚。 */
  const patchModelTags = useCallback(
    async (id: string, names: string[]) => {
      setWorkflows((prev) =>
        prev.map((workflow) =>
          workflow.id === id ? { ...workflow, modelTags: names } : workflow,
        ),
      );
      try {
        await updateMut.mutateAsync({ id, modelTags: names });
      } catch (e) {
        toast.error("更新模型标签失败", errorMessage(e, "未知错误"));
        void load();
      }
    },
    [setWorkflows, updateMut, toast, load],
  );

  /** 整体落库 workflowIO（详情预览里改 seed「控件后行为」等参数级配置）。
   *  成功后失效 detail 缓存，预览面板按富化后的数据重渲染。 */
  /** 对外参数落点（`paramMap.source.mode:<模式>`）持久化。
   *
   *  与 `patchWorkflowIO` 同一路径（PATCH 整列 + 失效两个 detail 缓存）：库里
   *  拖一条线改落点，预览与编辑器都不该读到一个过期的 paramMap。 */
  const patchParamMap = useCallback(
    async (id: string, paramMap: Record<string, unknown>) => {
      try {
        await updateMut.mutateAsync({ id, paramMap });
        await utils.workflow.detail.invalidate({ id });
        await utils.workflow.detailFull.invalidate({ id });
      } catch (e) {
        toast.error("更新参数映射失败", errorMessage(e, "未知错误"));
      }
    },
    [updateMut, utils, toast],
  );

  const patchWorkflowIO = useCallback(
    async (id: string, workflowIO: Record<string, unknown>) => {
      try {
        await updateMut.mutateAsync({ id, workflowIO });
        /* detailFull 才是预览表单的数据源（它带服务端富化的 defaultValue），
         * 只失效 detail 的话富化 IO 的缓存查询不会重拉 → 默认值不刷新。 */
        await utils.workflow.detail.invalidate({ id });
        await utils.workflow.detailFull.invalidate({ id });
      } catch (e) {
        toast.error("更新参数配置失败", errorMessage(e, "未知错误"));
      }
    },
    [updateMut, utils, toast],
  );

  /** 下载当前工作流 JSON（只有一种格式，直接下载 graph）。 */
  const downloadJson = useCallback(
    async (id: string, name: string) => {
      setBundleBusy(id);
      try {
        const d = await utils.workflow.detail.fetch({ id });
        const tpl = d?.template;
        if (!tpl) {
          toast.error("获取工作流失败", "未知错误");
          return;
        }
        const payload = tpl.graph ?? null;
        if (payload == null) {
          toast.error("下载失败", "graph 为空");
          return;
        }
        const blob = new Blob([JSON.stringify(payload, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${tpl.name ?? name}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success("已下载工作流", `${tpl.name ?? name}.json`);
      } catch (e) {
        toast.error("下载失败", errorMessage(e, "网络错误"));
      } finally {
        setBundleBusy(null);
      }
    },
    [toast, setBundleBusy, utils],
  );

  /** re-import a local workflow's source file and refresh. */
  const resyncWorkflow = useCallback(
    async (id: string, name: string) => {
      setResyncBusy(id);
      try {
        const d = await resyncMut.mutateAsync({ id });
        if (d?.missing) {
          toast.error(
            "同步失败",
            "磁盘文件已不存在，无法同步（请检查路径或重新载入）",
          );
        } else if (d?.unchanged) {
          toast.info("磁盘文件未变化", name);
        } else if (d?.updated) {
          toast.success("已同步磁盘内容", name);
          await load();
        }
      } catch (e) {
        toast.error("同步请求失败", errorMessage(e, "网络错误"));
      } finally {
        setResyncBusy(null);
      }
    },
    [toast, load, setResyncBusy, resyncMut],
  );

  /** Load one disk-discovered file into the DB via the single-file import
   *  route (the only supported local-import flow). */
  const handleLoadPending = useCallback(
    async (pending: { id: string; name: string; sourcePath: string }) => {
      setPendingLoading((state) => ({ ...state, [pending.id]: true }));
      try {
        await createMut.mutateAsync({
          sourcePath: pending.sourcePath,
          name: pending.name,
        });
        toast.success(`已载入「${pending.name}」`, "开始跟踪文件变化");
        void load();
      } catch (e) {
        toast.error("载入失败", errorMessage(e, "网络错误"));
      } finally {
        setPendingLoading((state) => {
          const cp = { ...state };
          delete cp[pending.id];
          return cp;
        });
      }
    },
    [setPendingLoading, createMut, toast, load],
  );

  return {
    handleDelete,
    patchModes,
    patchModelTags,
    patchParamMap,
    patchWorkflowIO,
    downloadJson,
    resyncWorkflow,
    handleLoadPending,
  };
}
