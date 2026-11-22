"use client";

// ── 历史详情弹窗：动作逻辑（规范 17 §17.2 第②层）────────────────────────────
// 原先「打开目录 / 复制路径 / 下载工作流」三条流程内联在 HistoryDetailModal 的 JSX 里
// （含 comfyapp:// 协议探测、剪贴板降级、blob 下载）。抽到 hook 后弹窗变成纯展示；
// tRPC 调用集中在 ~/lib/history-detail-actions；失败路径统一走 toast
// （硬规则：失败必须有日志 + 用户可见出口）。

import { useCallback, useMemo } from "react";

import { downloadJson } from "~/lib/browser-io";
import { useBusyAction } from "~/components/ui/use-busy-action";
import { runAsyncAction, type ActionReport } from "~/lib/async-action";

import { useToast } from "../../ToastProvider";

/** 把 toast 适配成本模块的动作反馈通道（规范 16 §16.2.4.30）。
 *
 *  「成功 / 失败接哪个方法、带不带第二行说明」是**调用处的表现层选择**，
 *  所以适配器住在这里而不是出口里 —— 设置页接的是整页提示条，
 *  工作流库接的也是 toast，但带第二行说明的写法不同。 */
function toastReport(toast: {
  error: (t: string, d?: string) => unknown;
  success: (t: string, d?: string) => unknown;
}): ActionReport {
  return (kind, detail) => (kind === "ok" ? toast.success(detail) : toast.error(detail));
}

export type HistoryDetailActions = {
  /** 「下载工作流」进行中。 */
  downloading: boolean;
  downloadWorkflow: (taskId: string) => Promise<void>;
  openFolder: (taskId: string) => Promise<void>;
  /** 「打开目录」进行中（防双击）。 */
  openFolderBusy: boolean;
};

/**
 * 动作层：接收两个 tRPC 调用（由调用方注入，便于测试替换）。
 * 注入而非直接 import vanillaApi，是为了让逻辑层可脱离网络单测。
 */
export type HistoryDetailActionsDeps = {
  fetchWorkflow: (id: string) => Promise<{ workflow?: unknown } | null>;
  /** 本机文件管理器定位（算目录 + 越界判定 + spawn 一次做完，见 lib/history-detail-actions）。 */
  openFolder: (id: string) => Promise<{ detail: string; ok: boolean }>;
};

export function useHistoryDetailActions(deps: HistoryDetailActionsDeps): HistoryDetailActions {
  const toast = useToast();
  /* 两个忙碌位走唯一出口（规范 16 §16.2.4.71）：`downloading` 的复位此前
   * 写在动作之后，`runAsyncAction` 之外的任意一行抛错就永远停在「下载中」。 */
  const openFolderAction = useBusyAction();
  const downloadAction = useBusyAction();

  /* 反馈通道的适配只做一次（`toast` 的身份在 Provider 里是稳定的）。 */
  const report = useMemo(() => toastReport(toast), [toast]);

  const openFolder = useCallback(
    async (taskId: string) => {
      /* 忙碌位走唯一出口（规范 16 §16.2.4.71）。成败与文案都由
       * `revealTaskFolder` 的 `{ ok, detail }` 表达（与队列 / 历史列表同一口径），
       * 本机 spawn 直接把目录交给文件管理器 —— 不再依赖 comfyapp:// 协议助手
       * 与浏览器确认框（那条路失败时只剩「复制路径」浮层，用户以为打不开）。 */
      await openFolderAction.run(async () => {
        const result = await deps.openFolder(taskId);
        await runAsyncAction(() => Promise.resolve(result), {
          report,
          failureText: "打开目录失败",
        });
      });
    },
    [deps, report, openFolderAction],
  );

  const downloadWorkflow = useCallback(
    async (taskId: string) => {
      /* 「拿到快照 → 落盘」这一整段走同一个出口：成功静默（文件已经在
       * 浏览器的下载目录里，再弹一句是噪声），失败走 `errorMessage`。 */
      await downloadAction.run(() =>
        runAsyncAction(
          async () => {
            const result = await deps.fetchWorkflow(taskId);
            const workflow = result?.workflow;
            const hasWorkflow = Boolean(workflow);
            if (!hasWorkflow) {
              return false;
            }
            downloadJson(workflow, "workflow.json");
            return true;
          },
          { report, failureText: "下载失败" },
        ),
      );
    },
    [deps, report, downloadAction],
  );

  return {
    openFolderBusy: openFolderAction.busy,
    downloading: downloadAction.busy,
    openFolder,
    downloadWorkflow,
  };
}
