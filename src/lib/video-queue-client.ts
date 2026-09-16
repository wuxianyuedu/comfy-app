/* ── 视频队列的网络客户端（第②层的网络部分）─────────────────────────────
 * VideoQueueModal 需要「只列出 VIDEO 类型的任务」与「批量提交新生成」。
 * 此前两处 vanillaApi 调用（task.list / generate.generate）直接写在视图里，
 * 且 VIDEO 过滤 + images 映射逻辑散在 loadTasks 内联函数中。
 *
 * 收口到这里后：
 *   - 视图（.tsx）不再出现 `vanillaApi.task.list` / `vanillaApi.generate.generate`；
 *   - 「任务 → 视频行」的形状收窄集中一处，别处要复用时直接 import。
 */

import { isVideo } from "~/lib/media";
import { vanillaApi } from "~/trpc/vanilla";
import type { RouterInputs, RouterOutputs } from "~/trpc/react";

/** Wire type of the generate mutation input。 */
export type GenerateInput = RouterInputs["generate"]["generate"];

/** task.list 的一行。路由 mapper 已不携带旧 `images` 数组（今天恒读 undefined）——
 *  这里保持 optional，让现有查找行为逐字不变。 */
type TaskListItem = RouterOutputs["task"]["list"]["tasks"][number] & {
  images?: { localPath: string }[];
};

export interface VideoTask {
  id: string;
  status: string;
  prompt: string;
  workflowName: string;
  video?: string | null; // 产出视频的本地路径
  error?: string | null;
}

/** 拉取当前用户的 VIDEO 类任务并按时间倒序展示所需的窄形状。 */
export async function fetchVideoTasks(): Promise<VideoTask[]> {
  const data = await vanillaApi.task.list.query({ take: 200 });
  const all: TaskListItem[] = data.tasks ?? [];
  return all
    .filter((task) => task.type === "VIDEO")
    .map((task) => ({
      id: task.id,
      status: task.status,
      prompt: task.prompt,
      workflowName: task.workflowName,
      video:
        (task.images ?? []).find((im) => isVideo(im.localPath))?.localPath ??
        null,
      error: task.error ?? null,
    }));
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
