/* ── 任务取消的浏览器侧客户端（第②层的网络部分）───────────────────────
 * `task.cancel` 此前在两处视图里各调一次（ImageGenerationPanel 的「强制
 * 取消」按钮、GlobalStepLogPanel 的取消按钮），各自拼错误文案。集中到这里后
 * 视图零 IO，「取消失败怎么提示」只有一份说法。
 *
 * 取消是**幂等**的：服务端对不存在的 taskId 返回 404 且无副作用，因此调用方
 * 不必先确认 taskId 是否存在。
 */

import { vanillaApi } from "~/trpc/vanilla";

/** 取消任务。失败抛错，由调用方决定提示与本地回滚。 */
export async function cancelTask(taskId: string): Promise<void> {
  await vanillaApi.task.cancel.mutate({ id: taskId });
}

/** 任务的权威状态快照（只取终态判定要用的两个字段）。 */
export interface TaskStatusSnapshot {
  /** DB 里的权威状态；查不到（行已删 / 网络抖动）时为 null。 */
  status: string | null;
  /** 失败原因（仅失败态有意义）。 */
  error: string | null;
}

/**
 * 取任务的**权威**状态。
 *
 * 为什么要它：SSE 是「事件流」，到达顺序不保证与 DB 的落库顺序一致 ——
 * 一条终态帧（`done` / `error`）之后仍可能有迟到的帧，帧里也可能不带
 * `status`。若把帧当成结论，用户会看到「后端判失败、界面显示完成」这类
 * 自相矛盾的结果（ISSUE #733）。终态帧只应当作**触发器**，结论一律回
 * DB 取；本函数就是那个出口，读不到时返回 null，由调用方决定兜底文案。
 */
export async function fetchTaskStatus(
  taskId: string,
): Promise<TaskStatusSnapshot> {
  try {
    const t = await vanillaApi.task.detail.query({ id: taskId });
    return {
      status: t?.status ?? null,
      error: typeof t?.error === "string" ? t.error : null,
    };
  } catch {
    return { status: null, error: null };
  }
}
