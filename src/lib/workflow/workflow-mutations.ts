/* ── 工作流编辑器的写操作客户端（第②层的网络部分）─────────────────────
 * workflow.update 的 PATCH 调用此前散在 4 个组件里（WorkflowStores 两处、
 * CanvasNode 一处、WorkflowEditorInner 的 useMutation 一处），每处自己
 * `.catch(() => undefined)` 或自己拼错误文案——改一处错误提示要改 4 个文件。
 *
 * 集中到这里后：
 *   - 视图（.tsx）不再出现 `vanillaApi.workflow.update`；
 *   - 「乐观更新 + 失败回滚」的语义由调用方（hook / store）持有，
 *     这里只负责「发出去 + 要不要把失败吞掉」这两种策略。
 *
 * 失败策略为何有两种：
 *   - `patchWorkflow`：调用方需要知道成败（例如模式保存失败要回滚本地状态）；
 *   - `patchWorkflowSilently`：IO 排序 / 分组 bypass 属于「写失败也不该打断
 *     用户继续拖画布」的次要写，服务端会在下次整体保存时重新落库。
 */

import { vanillaApi } from "~/trpc/vanilla";
import type { RouterInputs } from "~/trpc/react";

export type WorkflowUpdateInput = RouterInputs["workflow"]["update"];

/** 乐观更新用：成功返回 true，失败抛错（调用方负责回滚与提示）。 */
export async function patchWorkflow(input: WorkflowUpdateInput): Promise<void> {
  await vanillaApi.workflow.update.mutate(input);
}

/** 次要写：失败静默吞掉，不打断交互（见文件头注释）。 */
export function patchWorkflowSilently(input: WorkflowUpdateInput): void {
  vanillaApi.workflow.update.mutate(input).catch(() => undefined);
}
