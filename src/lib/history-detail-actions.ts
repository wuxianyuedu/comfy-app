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
  opened: boolean;
  comfyappUrl?: string | null;
  absolutePath?: string | null;
  error?: string | null;
}

/** 打开任务输出目录：失败路径分「目录未生成」与其它错误两种，由 hook 决定提示文案。 */
export async function openTaskFolder(
  taskId: string,
): Promise<OpenFolderResult> {
  return vanillaApi.task.openFolder.mutate({ id: taskId });
}

/** 拉取任务执行时捕获的工作流快照（下载 workflow.json 用）。 */
export async function fetchTaskWorkflow(taskId: string): Promise<{
  workflow?: unknown;
} | null> {
  const result = await vanillaApi.task.workflow.query({ id: taskId });
  return { workflow: result?.workflow ?? undefined };
}
