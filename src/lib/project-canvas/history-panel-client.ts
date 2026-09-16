/* ── 画布历史面板的列表查询（第②层的网络部分）─────────────────────────
 * HistoryPanel.tsx 此前直接 `vanillaApi.task.list.query(...)`（两处：
 * 主列表 + 「本项目为空时探一次全局」的探测）。集中到这里后视图零 IO，
 * 响应收窄也只有一份。
 */

import { z } from "zod";

import { vanillaApi } from "~/trpc/vanilla";
import type { HistoryTaskRow } from "./history-panel-types";

/* task.list 的行经 tRPC 传输 + Prisma 投影，客户端拿到的是 unknown 级形状。
 * 逐行 Zod 校验（§05「API 响应一律 Zod 校验」）：不合法行**丢弃而不是硬塞**，
 * 否则下游对 progress/mediaType 的数值/枚举假设会在渲染或排序里炸。
 * 过去这里是一句 `as unknown as HistoryTaskRow[]`——那是假保险：类型说
 * 「一定有 prompt」，实际可能是 undefined。 */
const historyTaskRowSchema = z.object({
  id: z.string(),
  type: z.string().default("image"),
  workflowName: z.string().default(""),
  status: z.string().default("QUEUED"),
  prompt: z.string().default(""),
  createdAt: z.string(),
  cover: z.string().nullable().default(null),
  mediaType: z.enum(["image", "video", "audio"]).default("image"),
  projectId: z.string().nullable().default(null),
  progress: z.number().default(0),
  error: z.string().nullable().default(null),
});

/** 把 tRPC 响应里的行数组收窄成 HistoryTaskRow[]；非法行丢弃。 */
function parseHistoryRows(raw: unknown): HistoryTaskRow[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryTaskRow[] = [];
  for (const item of raw) {
    const parsed = historyTaskRowSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export type HistoryListParams = {
  take?: number;
  projectId?: string;
  media?: "image" | "video" | "audio";
};

/** 拉取任务列表。响应行的 mediaType 由服务端 inferMediaType 给出，
 *  但 Prisma Json 列不可信，这里逐条收窄：缺 mediaType 的行按 image 兜底。 */
export async function fetchHistoryTasks(
  params: HistoryListParams,
): Promise<HistoryTaskRow[]> {
  const data = await vanillaApi.task.list.query(params);
  return parseHistoryRows(data.tasks);
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
