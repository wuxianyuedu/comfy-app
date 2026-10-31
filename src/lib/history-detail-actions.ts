/* ── 历史详情弹窗的动作客户端（第②层的网络部分）──────────────────────
 * 「打开目录 / 下载工作流」这两个 tRPC 调用此前内联在 HistoryDetailModal.tsx 里，
 * 直接 import vanillaApi 传给 use-history-detail-actions 的 deps。
 *
 * 收口到这里后：
 *   - 视图（.tsx）不再出现 `vanillaApi.task.*`，只是把这两个函数名传给 hook；
 *   - 服务端返回的 JSON / nullable 形状在这里收窄成 hook 需要的窄类型。
 */

import { vanillaApi } from "~/trpc/vanilla";

export interface OpenFolderResult {
  absolutePath?: string | null;
  comfyappUrl?: string | null;
  error?: string | null;
  opened: boolean;
}

/** 打开任务输出目录：失败路径分「目录未生成」与其它错误两种，由 hook 决定提示文案。 */
export async function openTaskFolder(taskId: string): Promise<OpenFolderResult> {
  return vanillaApi.task.openFolder.mutate({ id: taskId });
}

/**
 * 在系统文件管理器里**定位**任务的产物目录（队列面板「输出目录」按钮的落点）。
 *
 * 两步复用既有出口：`task.openFolder` 负责「算目录 + 越界判定 + 目录在不在」，
 * `setting.revealPath` 负责「把控制权交给文件管理器」（本机 `explorer /select`，
 * 见 `~/lib/shell/reveal-path`，日志面板点路径走的是同一条）。
 *
 * **为什么不是 `comfyapp://`**：那条要求用户先装协议助手，未装时点了什么都不发生
 * —— 而队列面板此前连导航都没发（`openTaskFolder` 的 `comfyappUrl` 拿到就丢，
 * 只把 `opened` 读成成败），于是这个按钮在任何环境下都只报一句「已交给系统打开
 * 输出目录」而资源管理器一动不动。`revealPath` 的闸门（存在 + 在检出目录内）
 * 对产物目录天然成立：它由 `taskOutputDir()` 算自 `<cwd>/generated`。
 */
export async function revealTaskFolder(taskId: string): Promise<{ detail: string; ok: boolean }> {
  const folder = await openTaskFolder(taskId);
  if (!folder.opened || !folder.absolutePath) {
    return {
      ok: false,
      detail:
        folder.error === "directory missing"
          ? "该任务尚未生成文件目录"
          : (folder.error ?? "未能打开输出目录，可在任务详情里复制文件路径"),
    };
  }
  const revealed = await vanillaApi.setting.revealPath.mutate({
    path: folder.absolutePath,
  });
  return { ok: revealed.ok === true, detail: revealed.detail };
}

/** 拉取任务执行时捕获的工作流快照（下载 workflow.json 用）。 */
export async function fetchTaskWorkflow(taskId: string): Promise<{
  workflow?: unknown;
} | null> {
  const result = await vanillaApi.task.workflow.query({ id: taskId });
  return { workflow: result?.workflow ?? undefined };
}

/**
 * 人工评分 / 收藏一张产物图（FR-QA-07 人工侧 · #2480）：rating 0~5（null = 清除）、
 * favorite 布尔。rating 是校准读数（`run.reviewCalibration`）的人侧输入；
 * favorite 是「优秀样本进 few-shot」沉淀机制的输入。
 */
export async function setImageFeedback(
  imageId: string,
  data: { humanRating: number | null; isFavorite: boolean },
): Promise<void> {
  await vanillaApi.task.setImageFeedback.mutate({ imageId, ...data });
}
