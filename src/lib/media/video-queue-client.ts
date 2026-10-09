/* ── 视频队列的网络客户端（第②层的网络部分）─────────────────────────────
 * VideoQueueModal 需要「只列出 VIDEO 类型的任务」与「批量提交新生成」。
 * 两处 tRPC 调用（task.list / generate.generate）集中到这里后视图（.tsx）零 IO，
 * 「任务 → 视频行」的形状收窄也只有一份，别处要复用时直接 import。
 */

import { z } from "zod";

import { vanillaApi } from "~/trpc/vanilla";
import type { RouterInputs } from "~/trpc/react";

/** Wire type of the generate mutation input。 */
export type GenerateInput = RouterInputs["generate"]["generate"];

/** `task.list` 响应行中本客户端要读的那几列（服务端 mapper 的镜像）。
 *
 * 逐行 Zod 校验（规范 §05「API 响应一律 Zod 校验」，同 `history-panel-client`）：
 * 视图对 `prompt` / `workflowName` 有字符串假设（`.trim()`、直接渲染），而这些
 * 值经的是网络，类型声明在这里不构成任何保证。
 *
 * **`videoPath` 刻意不给默认值**：这一列判的是「有没有可下载的视频产物」。
 * 服务端哪天不发它，整行会被丢弃 → 列表变空（用户看得见、且
 * `tests/task-list-wire-contract.test.ts` 当场红）；写成 `.default(null)` 则
 * 退化成「每一行都没有封面、也没有下载按钮」——那是用户读不出来的坏法。 */
export const videoTaskRowSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string(),
  prompt: z.string().default(""),
  workflowName: z.string().default(""),
  videoPath: z.string().nullable(),
  error: z.string().nullable().default(null),
});

export type VideoTaskRow = z.infer<typeof videoTaskRowSchema>;

export interface VideoTask {
  id: string;
  status: string;
  prompt: string;
  workflowName: string;
  video?: string | null; // 产出视频的本地路径（无产出 = null）
  error?: string | null;
}

/** 把 `task.list` 的响应收窄成 VIDEO 类任务行；非法行丢弃而不是硬塞。 */
export function parseVideoRows(raw: unknown): VideoTask[] {
  if (!Array.isArray(raw)) return [];
  const out: VideoTask[] = [];
  for (const item of raw) {
    const parsed = videoTaskRowSchema.safeParse(item);
    if (!parsed.success) continue;
    const row = parsed.data;
    if (row.type !== "VIDEO") continue;
    out.push({
      id: row.id,
      status: row.status,
      prompt: row.prompt,
      workflowName: row.workflowName,
      video: row.videoPath,
      error: row.error,
    });
  }
  return out;
}

/** 拉取当前用户的 VIDEO 类任务（顺序由服务端按创建时间倒序给出）。 */
export async function fetchVideoTasks(): Promise<VideoTask[]> {
  const data = await vanillaApi.task.list.query({ take: 200 });
  return parseVideoRows(data.tasks);
}

/** 提交一条生成；成功返回 taskId（由调用方决定怎么提示/刷新）。 */
export async function submitGeneration(
  params: Record<string, unknown> | undefined,
  prompt: string,
): Promise<{ taskId?: string }> {
  return vanillaApi.generate.generate.mutate({
    ...(params ?? {}),
    prompt,
  } as GenerateInput);
}
