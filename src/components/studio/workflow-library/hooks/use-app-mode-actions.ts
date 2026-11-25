"use client";

/* 工作流库「App Mode 选引脚」页签的业务逻辑层（规范 17 §17.2 第②层）：
 * 面板状态（appModeInfo）+ 三个动作（导出 / 深链打开 / 读回）。视图只消费
 * 这里给的状态与回调，不发请求、不碰页签基础设施。
 *
 * 深链打开复用桌面壳那个稳定 id 为 "comfyui" 的 iframe 页签（同 id 只刷新
 * 地址，不叠重复页签）；浏览器形态同步 window.open（必须在 await 之前调用，
 * 与 use-comfyui-control 的 openComfy 同款次序）。 */

import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { shouldUseBrowserTab } from "~/lib/comfy/comfy-embed";
import { isDesktopShell } from "~/lib/shell/desktop-shell-client";
import { useTRPC } from "~/trpc/react";

import { openComfyAtUrl } from "~/components/studio/comfyui/hooks/use-comfyui-control";

import { useToast } from "~/components/studio/ToastProvider";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}

export function useAppModeActions(workflowId: string) {
  const trpc = useTRPC();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [busyExport, setBusyExport] = useState(false);
  const [busyOpen, setBusyOpen] = useState(false);
  const [busyApply, setBusyApply] = useState(false);

  const infoQuery = useQuery(trpc.workflow.appModeInfo.queryOptions({ id: workflowId }));

  /* 读回会改 workflowIO 列：详情两份缓存与列表都要失效；面板自己的读数也刷新。 */
  const invalidateAfterWrite = useCallback(async () => {
    await queryClient.invalidateQueries(trpc.workflow.detail.queryFilter({ id: workflowId }));
    await queryClient.invalidateQueries(trpc.workflow.detailFull.queryFilter({ id: workflowId }));
    await queryClient.invalidateQueries(trpc.workflow.list.queryFilter());
    await queryClient.invalidateQueries(trpc.workflow.appModeInfo.queryFilter({ id: workflowId }));
  }, [queryClient, trpc, workflowId]);

  const exportMutation = useMutation(trpc.workflow.exportForAppMode.mutationOptions());
  const applyMutation = useMutation(trpc.workflow.applyAppModeSelection.mutationOptions());

  /** 导出 rawJson 到 ComfyUI 用户工作流目录（新建文件，绝不覆盖既有文件）。 */
  const exportForAppMode = useCallback(async () => {
    setBusyExport(true);
    try {
      const res = await exportMutation.mutateAsync({ id: workflowId });
      toast.success("已导出到 ComfyUI 工作流目录", res.fileName);
      await invalidateAfterWrite();
    } catch (error) {
      toast.error("导出失败", errorText(error));
    } finally {
      setBusyExport(false);
    }
  }, [exportMutation, invalidateAfterWrite, toast, workflowId]);

  /** 在 ComfyUI 原生前端里打开这条工作流（带 rootId 时走 URL hash 深链）。
   *  用户随后在原生界面进 App Mode 勾选并 Ctrl+S，选择落进文件的 extra.linearData。 */
  const openInComfy = useCallback(
    async (comfyBase: string, rootId: string | null) => {
      const target = rootId === null ? comfyBase : `${comfyBase}/#${rootId}`;
      if (shouldUseBrowserTab(isDesktopShell())) {
        window.open(target, "_blank", "noopener,noreferrer");
        toast.success("已在新浏览器页签打开 ComfyUI", target);
        return;
      }
      setBusyOpen(true);
      try {
        /* 可嵌性判决与 use-comfyui-control 同一出处：不可嵌时页签照开、
         * 内容换成可读说明（不另开窗口）。 */
        const decision = await openComfyAtUrl({
          url: target,
          base: comfyBase,
          origin: window.location.origin,
        });
        if (decision.target !== "embed") {
          toast.error("ComfyUI 无法内嵌", decision.detail);
        }
      } catch (error) {
        toast.error("打开 ComfyUI 失败", errorText(error));
      } finally {
        setBusyOpen(false);
      }
    },
    [toast],
  );

  /** 读回：把源文件里 App Mode 的引脚选择映射成 workflowIO 暴露面落库。 */
  const applySelection = useCallback(async () => {
    setBusyApply(true);
    try {
      const res = await applyMutation.mutateAsync({ id: workflowId });
      if (res.skipped.length > 0) {
        toast.info(
          "已读回引脚选择",
          `应用 ${res.applied} 条；跳过 ${res.skipped.length} 条（当前图里找不到对应节点）`,
        );
      } else {
        toast.success("已读回引脚选择", `共 ${res.applied} 条`);
      }
      await invalidateAfterWrite();
    } catch (error) {
      toast.error("读回失败", errorText(error));
    } finally {
      setBusyApply(false);
    }
  }, [applyMutation, invalidateAfterWrite, toast, workflowId]);

  return {
    info: infoQuery.data ?? null,
    isLoading: infoQuery.isLoading,
    busyExport,
    busyOpen,
    busyApply,
    exportForAppMode,
    openInComfy,
    applySelection,
  };
}
