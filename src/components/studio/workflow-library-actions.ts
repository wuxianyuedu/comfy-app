/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-floating-promises, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */
"use client";

/** 2026-08-22 P4: extracted from WorkflowLibrary's action-callback block
 *  (handleUpgradeConfirm / handleDelete / patchModes / patchModelTags /
 *  downloadJson / resyncWorkflow / handleLoadPending).  The hook receives
 *  the raw state setters + trpc mutations it needs and returns the stable
 *  callbacks; the component keeps only the state declarations and the JSX.
 */
import { useCallback } from "react";
import { type api } from "~/trpc/react";
import { useToast } from "@/components/studio/ToastProvider";
import type { WorkflowRow } from "./workflow-library-helpers";

export interface UseWorkflowActionsArgs {
  setDeleting: (v: boolean) => void;
  setPendingDelete: (v: { id: string; name: string } | null) => void;
  setImportErr: (v: string) => void;
  setBundleBusy: (v: string | null) => void;
  setResyncBusy: (v: string | null) => void;
  setPendingLoading: (
    fn: (s: Record<string, boolean>) => Record<string, boolean>
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
    setImportErr,
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
        load();
      } catch (e: any) {
        setImportErr(e?.message ?? "删除失败");
      } finally {
        setDeleting(false);
      }
    },
    [setDeleting, deleteMut, setPendingDelete, load, setImportErr]
  );

  /** 2026-08-13: 多模式持久化。乐观更新本地列表，失败则回滚（重新拉取列表）。 */
  const patchModes = useCallback(
    async (id: string, modes: string[], defaultMode: string) => {
      setWorkflows((prev) =>
        prev.map((workflow) =>
          workflow.id === id
            ? { ...workflow, modes, defaultMode, taskType: defaultMode }
            : workflow
        )
      );
      try {
        await updateMut.mutateAsync({ id, modes, defaultMode });
      } catch (e: any) {
        toast.error("更新模式失败", e?.message ?? "未知错误");
        load();
      }
    },
    [setWorkflows, updateMut, toast, load]
  );

  /** 2026-08-15: 模型标签绑定持久化。乐观更新本地列表，失败回滚。 */
  const patchModelTags = useCallback(
    async (id: string, names: string[]) => {
      setWorkflows((prev) =>
        prev.map((prev) =>(prev.id === id ? { ...prev, modelTags: names } : prev))
      );
      try {
        await updateMut.mutateAsync({ id, modelTags: names });
      } catch (e: any) {
        toast.error("更新模型标签失败", e?.message ?? "未知错误");
        load();
      }
    },
    [setWorkflows, updateMut, toast, load]
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
        toast.success(
          "已下载工作流",
          `${tpl.name ?? name}.json`
        );
      } catch (e: any) {
        toast.error("下载失败", e?.message ?? "网络错误");
      } finally {
        setBundleBusy(null);
      }
    },
    [toast, setBundleBusy, utils]
  );

  /** 2026-08-10 R16: re-import a local workflow's source file and refresh. */
  const resyncWorkflow = useCallback(
    async (id: string, name: string) => {
      setResyncBusy(id);
      try {
        const d = await resyncMut.mutateAsync({ id });
        if (d?.missing) {
          toast.error(
            "同步失败",
            "磁盘文件已不存在，无法同步（请检查路径或重新载入）"
          );
        } else if (d?.unchanged) {
          toast.info("磁盘文件未变化", name);
        } else if (d?.updated) {
          toast.success("已同步磁盘内容", name);
          await load();
        }
      } catch (e: any) {
        toast.error("同步请求失败", e?.message ?? "网络错误");
      } finally {
        setResyncBusy(null);
      }
    },
    [toast, load, setResyncBusy, resyncMut]
  );

  /** Load one disk-discovered file into the DB via the single-file import
   *  route (R12: the only supported local-import flow). */
  const handleLoadPending = useCallback(
    async (pending: { id: string; name: string; sourcePath: string }) => {
      setPendingLoading((state) => ({ ...state, [pending.id]: true }));
      try {
        await createMut.mutateAsync({
          sourcePath: pending.sourcePath,
          name: pending.name,
        });
        toast.success(`已载入「${pending.name}」`, "开始跟踪文件变化");
        load();
      } catch (e: any) {
        toast.error("载入失败", e?.message ?? "网络错误");
      } finally {
        setPendingLoading((state) => {
          const cp = { ...state };
          delete cp[pending.id];
          return cp;
        });
      }
    },
    [setPendingLoading, createMut, toast, load]
  );

  return {
    handleDelete,
    patchModes,
    patchModelTags,
    downloadJson,
    resyncWorkflow,
    handleLoadPending,
  };
}
