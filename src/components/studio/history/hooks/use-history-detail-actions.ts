"use client";

// ── 历史详情弹窗：动作逻辑（规范 17 §17.2 第②层）────────────────────────────
// 原先「打开目录 / 复制路径 / 下载工作流」三条流程内联在 HistoryDetailModal 的 JSX 里
// （含 comfyapp:// 协议探测、剪贴板降级、blob 下载）。抽到 hook 后：
//   • 弹窗变成纯展示，可由工具重生成；
//   • tRPC 调用集中在 ~/lib/history-detail-actions，改协议只需动一处；
//   • 失败路径统一走 toast（硬规则：失败必须有日志 + 用户可见出口）。

import { useCallback, useMemo, useState } from "react";

import { downloadJson } from "~/lib/browser-io";
import { useCopyFeedback } from "~/components/ui/use-copy-feedback";
import { useBusyAction } from "~/components/ui/use-busy-action";
import { detectFolderHelper } from "~/lib/external-open";
import { runAsyncAction, type ActionReport } from "~/lib/async-action";

import { useToast } from "../../ToastProvider";

/** 把 toast 适配成本模块的动作反馈通道（规范 16 §16.2.4.30）。
 *
 *  「成功 / 失败接哪个方法、带不带第二行说明」是**调用处的表现层选择**，
 *  所以适配器住在这里而不是出口里 —— 设置页接的是整页提示条，
 *  工作流库接的也是 toast，但带第二行说明的写法不同。 */
function toastReport(toast: {
  success: (t: string, d?: string) => unknown;
  error: (t: string, d?: string) => unknown;
}): ActionReport {
  return (kind, detail) =>
    kind === "ok" ? toast.success(detail) : toast.error(detail);
}

/** comfyapp:// 协议未接管的引导状态：为 null 表示尚未发起过导航。 */
export interface FolderPopover {
  path: string;
  /** true = 2s 内页面未失焦，视为助手未注册，展示安装引导。 */
  helperMissing: boolean;
}

export interface HistoryDetailActions {
  folderPopover: FolderPopover | null;
  /** 「打开目录」进行中（防双击）。 */
  openFolderBusy: boolean;
  /** 「下载工作流」进行中。 */
  downloading: boolean;
  openFolder: (taskId: string) => Promise<void>;
  downloadWorkflow: (taskId: string) => Promise<void>;
  copyPath: () => void;
  dismissFolderPopover: () => void;
}

/**
 * 动作层：接收两个 tRPC 调用（由调用方注入，便于测试替换）。
 * 注入而非直接 import vanillaApi，是为了让逻辑层可脱离网络单测。
 */
export interface HistoryDetailActionsDeps {
  openFolder: (id: string) => Promise<{
    comfyappUrl?: string | null;
    absolutePath?: string | null;
    error?: string | null;
  }>;
  fetchWorkflow: (id: string) => Promise<{ workflow?: unknown } | null>;
}

export function useHistoryDetailActions(
  deps: HistoryDetailActionsDeps,
): HistoryDetailActions {
  const toast = useToast();
  const [folderPopover, setFolderPopover] = useState<FolderPopover | null>(
    null,
  );
  /* 两个忙碌位走唯一出口（规范 16 §16.2.4.71）：`downloading` 的复位此前
   * 写在动作之后，`runAsyncAction` 之外的任意一行抛错就永远停在「下载中」。 */
  const openFolderAction = useBusyAction();
  const downloadAction = useBusyAction();

  /* 反馈通道的适配只做一次（`toast` 的身份在 Provider 里是稳定的）。 */
  const report = useMemo(() => toastReport(toast), [toast]);

  const openFolder = useCallback(
    async (taskId: string) => {
      /* 忙碌位走唯一出口（规范 16 §16.2.4.71）；这里手写 `try/finally` 是因为
       * 动作体里要在多处提前落 UI（不是单个 `run` 能表达的形状）。 */
      openFolderAction.set(true);
      try {
        const result = await deps.openFolder(taskId);
        if (result.comfyappUrl) {
          /* 本机自定义协议方案：服务端已校验目录存在且在白名单内，返回
           * comfyapp://open?path=... URL。这里直接导航（user-initiated 点击），
           * 浏览器弹「是否打开外部应用」确认 → OS 调起 handler 用 explorer
           * 打开目录。
           *
           * 「协议助手有没有真的接管」的探测收在 `~/lib/external-open` 的
           * `detectFolderHelper`（规范 16 §16.2.4.25）—— 收口前它内联在这里，
           * 是**全库唯一一处**判这个的文件，于是「点了什么都没发生」在别处
           * 根本不是一个可表达的状态（防静默失败，硬规则 4）。 */
          setFolderPopover({
            path: result.absolutePath ?? "",
            helperMissing: false,
          });
          const helper = detectFolderHelper(() =>
            setFolderPopover((prev) =>
              prev ? { ...prev, helperMissing: false } : prev,
            ),
          );
          window.location.href = result.comfyappUrl;
          const state = await helper.settle();
          if (state === "missing") {
            setFolderPopover({
              path: result.absolutePath ?? "",
              helperMissing: true,
            });
          }
        } else if (result.error === "directory missing") {
          toast.error(
            "该任务尚未生成文件目录",
            result.absolutePath ?? undefined,
          );
        } else {
          /* 服务端没给具体原因（`result.error` 是别的值 / 缺席）——
           * 出口的失败文案就是这一句。 */
          report("err", "打开目录失败");
        }
      } catch (error) {
        /* 失败路径的文案由 `~/lib/async-action` 统一走 `errorMessage`：
         * 收口前这里是一句写死的「无法连接服务器」—— 网络层原文
         *（服务重启窗口的 `Failed to fetch`）被整个丢掉了。 */
        await runAsyncAction(
          async () => {
            throw error;
          },
          { report, failureText: "打开目录失败" },
        );
      } finally {
        openFolderAction.set(false);
      }
    },
    [deps, toast, report, openFolderAction],
  );

  /* 路径复制走 toast 通道（这一族动作的既有表现层选择）。反馈形态是调用处
   * 的事，但**成败两条都要有出口**归出口管（规范 16 §16.2.4.43）。 */
  const copyPathFeedback = useCopyFeedback({
    onSuccess: () =>
      toast.success("路径已复制", "粘贴到资源管理器地址栏（Alt+D）即可跳转"),
    onFailure: () => toast.error("复制失败", "请手动选择路径复制"),
  });
  const copyPath = useCallback(() => {
    if (!folderPopover) return;
    copyPathFeedback(folderPopover.path);
  }, [folderPopover, copyPathFeedback]);

  const downloadWorkflow = useCallback(
    async (taskId: string) => {
      /* 「拿到快照 → 落盘」这一整段走同一个出口：成功静默（文件已经在
       * 浏览器的下载目录里，再弹一句是噪声），失败走 `errorMessage`。 */
      await downloadAction.run(() =>
        runAsyncAction(
          async () => {
            const result = await deps.fetchWorkflow(taskId);
            if (!result?.workflow) return false;
            downloadJson(result.workflow, "workflow.json");
            return true;
          },
          { report, failureText: "下载失败" },
        ),
      );
    },
    [deps, report, downloadAction],
  );

  const dismissFolderPopover = useCallback(() => setFolderPopover(null), []);

  return {
    folderPopover,
    openFolderBusy: openFolderAction.busy,
    downloading: downloadAction.busy,
    openFolder,
    downloadWorkflow,
    copyPath,
    dismissFolderPopover,
  };
}
