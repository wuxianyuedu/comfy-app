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
