/* ── 画布历史面板的列表查询（第②层的网络部分）─────────────────────────
 * HistoryPanel.tsx 此前直接 `vanillaApi.task.list.query(...)`（两处：
 * 主列表 + 「本项目为空时探一次全局」的探测）。集中到这里后视图零 IO，
 * 响应收窄也只有一份。
 */

import { vanillaApi } from "~/trpc/vanilla";
import type { HistoryTaskRow } from "./history-panel-types";

export type HistoryListParams = {
  take?: number;
  projectId?: string;
  media?: "image" | "video" | "audio";
};

/** 拉取任务列表。响应行的 mediaType 由服务端 inferMediaType 给出，
 *  但 Prisma Json 列不可信，这里逐条收窄：缺 mediaType 的行按 image 兜底。 */
export async function fetchHistoryTasks(
  params: HistoryListParams
): Promise<HistoryTaskRow[]> {
  const data = await vanillaApi.task.list.query(params);
  return (data.tasks ?? []) as unknown as HistoryTaskRow[];
}

/** 「本项目为空」时探一次全局，用于决定要不要给「查看全部记录」引导。
 *  探测失败返回 null（视图据此不显示引导），不影响主流程。 */
export async function probeGlobalTaskCount(): Promise<number | null> {
  try {
    const data = await vanillaApi.task.list.query({ take: 1 });
    return Array.isArray(data.tasks) ? data.tasks.length : 0;
  } catch {
    return null;
  }
}
