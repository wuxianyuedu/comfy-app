"use client";

// ── 历史详情弹窗：动作逻辑（规范 17 §17.2 第②层）────────────────────────────
// 原先「打开目录 / 复制路径 / 下载工作流」三条流程内联在 HistoryDetailModal 的 JSX 里
// （含 comfyapp:// 协议探测、剪贴板降级、blob 下载）。抽到 hook 后：
//   • 弹窗变成纯展示，可由工具重生成；
//   • tRPC 调用集中在 ~/lib/history-detail-actions，改协议只需动一处；
//   • 失败路径统一走 toast（硬规则：失败必须有日志 + 用户可见出口）。

import { useCallback, useState } from "react";

import { copyText, downloadJson } from "~/lib/browser-io";

import { useToast } from "../../ToastProvider";

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
  copyPath: () => Promise<void>;
  dismissFolderPopover: () => void;
}

/** 协议导航后判定超时：2s 内页面失焦视为 OS 已接管。 */
const PROTOCOL_DETECT_MS = 2000;

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
  const [openFolderBusy, setOpenFolderBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const openFolder = useCallback(
    async (taskId: string) => {
      setOpenFolderBusy(true);
      try {
        const result = await deps.openFolder(taskId);
        if (result.comfyappUrl) {
          // 本机自定义协议方案：服务端已校验目录存在且在白名单内，
          // 返回 comfyapp://open?path=... URL。这里直接导航（user-initiated 点击），
          // 浏览器弹「是否打开外部应用」确认 → OS 调起 handler 用 explorer 打开目录。
          //
          // 检测协议是否真的被 OS 接管：导航后若超时内页面失去焦点（外部 app 抢走
          // 焦点），视为已打开；否则认为未注册助手，展示安装引导（防静默失败）。
          let openedByOs = false;
          const onBlur = () => {
            openedByOs = true;
            window.removeEventListener("blur", onBlur);
            setFolderPopover((prev) =>
              prev ? { ...prev, helperMissing: false } : prev,
            );
          };
          window.addEventListener("blur", onBlur);
          window.location.href = result.comfyappUrl;
          window.setTimeout(() => {
            window.removeEventListener("blur", onBlur);
            if (!openedByOs) {
              setFolderPopover({
                path: result.absolutePath ?? "",
                helperMissing: true,
              });
            }
          }, PROTOCOL_DETECT_MS);
          setFolderPopover({
            path: result.absolutePath ?? "",
            helperMissing: false,
          });
        } else if (result.error === "directory missing") {
          toast.error(
            "该任务尚未生成文件目录",
            result.absolutePath ?? undefined,
          );
        } else {
          toast.error("打开目录失败");
        }
      } catch {
        toast.error("无法连接服务器");
      } finally {
        setOpenFolderBusy(false);
      }
    },
    [deps, toast],
  );

  const copyPath = useCallback(async () => {
    if (!folderPopover) return;
    const ok = await copyText(folderPopover.path);
    if (!ok) {
      toast.error("复制失败", "请手动选择路径复制");
      return;
    }
    toast.success("路径已复制", "粘贴到资源管理器地址栏（Alt+D）即可跳转");
  }, [folderPopover, toast]);

  const downloadWorkflow = useCallback(
    async (taskId: string) => {
      setDownloading(true);
      try {
        const result = await deps.fetchWorkflow(taskId);
        if (!result?.workflow) {
          toast.error("未找到工作流快照");
          return;
        }
        downloadJson(result.workflow, "workflow.json");
      } catch {
        toast.error("下载失败");
      } finally {
        setDownloading(false);
      }
    },
    [deps, toast],
  );

  const dismissFolderPopover = useCallback(() => setFolderPopover(null), []);

  return {
    folderPopover,
    openFolderBusy,
    downloading,
    openFolder,
    downloadWorkflow,
    copyPath,
    dismissFolderPopover,
  };
}
