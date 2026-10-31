/* ── 视频队列的网络客户端（第②层的网络部分）─────────────────────────────
 * VideoQueueModal 需要「只列出 VIDEO 类型的任务」与「批量提交新生成」。
 * 两处 tRPC 调用（task.list / generate.generate）集中到这里后视图（.tsx）零 IO，
 * 「任务 → 视频行」的形状收窄也只有一份，别处要复用时直接 import。
 */

import { z } from "zod";

import { vanillaApi } from "~/trpc/vanilla";

/**
 * `task.list` 一行在本模块的**镜像**（§05「API 响应一律 Zod 校验」）。
 *
 * ## 为什么必须逐行校验，而不是一句 `as`
 *
 * 此前这里是 `RouterOutputs["task"]["list"]["tasks"][number] & { images?: … }`
 * —— 交叉类型只会**加**列，发现不了「镜像声明的列线上从来不发」。它标成
 * optional 之后，「取视频产物路径」那句读到的永远是 `undefined`，`video` 于是
 * 恒为 `null`：表现不是报错，而是「封面永远是占位图标、下载按钮一次都没出现过」，
 * 而 tsc / eslint / 全量用例 / 覆盖率门槛**全绿**（ISSUE #1579）。
 *
 * ## 镜子照的是什么
 *
 * `videoPath` 是**服务端投影**算出来的列（封面是预览图时，`cover` / `mediaType`
 * 都答不出成片在哪）。这一行由 `tests/task-list-wire-contract.test.ts` 从真
 * router 出发经一次 JSON 传输反向核对：镜像声明的每一列，线上都在发。
 */
export const videoTaskRowSchema = z.object({
  id: z.string(),
  /* `type` / `status` 刻意**不给默认值**：这两个是「这一行是不是视频任务」
   * 的判据（下方 `parseVideoRows` 按 `type` 过滤），补一个兜底会把「线上
   * 没发这一列」伪装成一条正常行 —— 同 `videoPath` 的理由，见下。 */
  type: z.string(),
  status: z.string(),
  prompt: z.string().default(""),
  workflowName: z.string().default(""),
  /**
   * 成片的本地路径；没有视频产出的任务为 **null**（不是缺键、也不是空串）。
   *
   * **刻意不给 `.default(null)`**：缺这一列就等于契约分叉（线上少发一列），
   * 整行必须被判掉、让列表变空**看得见**；补一个兜底会把分叉抹成「每个任务
   * 都没有视频」—— 那正是这一族此前静默坏掉的方式（见文件头的契约说明，
   * 反向验证在 `tests/task-list-wire-contract.test.ts`）。
   */
  videoPath: z.string().nullable(),
  error: z.string().nullable().default(null),
});

export type VideoTaskRow = z.infer<typeof videoTaskRowSchema>;

/** 视图消费的行（只留它真会读的几样）。 */
export interface VideoTask {
  error: string | null;
  id: string;
  prompt: string;
  status: string;
  video: string | null;
  workflowName: string;
}

/**
 * 把 tRPC 响应里的行收窄成 `VideoTask[]`，**非法行整行丢弃**。
 *
 * 丢弃而不是兜底：`videoPath` 缺失时若退回「没有视频」，契约分叉就被抹成
 * 「每个任务都没有视频」—— 那是**静默**的那种坏。列表变空看得见。
 * `id` 非法（比如是数字）同样整行丢掉，而不是把 `undefined` 硬塞给视图。
 */
export function parseVideoRows(raw: unknown): Array<VideoTask> {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: Array<VideoTask> = [];
  for (const item of raw) {
    const parsed = videoTaskRowSchema.safeParse(item);
    if (!parsed.success) {
      continue;
    }
    /* 只要 VIDEO 类任务进这张表（图片任务由画布历史那一路管）。判据在 `type`：
     * 它也在镜像里，因此「过滤」这一步有契约兜着，不是拿视图的猜测。 */
    if (parsed.data.type !== "VIDEO") {
      continue;
    }
    out.push({
      id: parsed.data.id,
      status: parsed.data.status,
      prompt: parsed.data.prompt,
      workflowName: parsed.data.workflowName,
      video: parsed.data.videoPath,
      error: parsed.data.error,
    });
  }
  return out;
}

/** 拉取当前用户的 VIDEO 类任务（顺序由服务端按创建时间倒序给出）。 */
export async function fetchVideoTasks(): Promise<Array<VideoTask>> {
  const data = await vanillaApi.task.list.query({ take: 200 });
  return parseVideoRows(data.tasks);
}
