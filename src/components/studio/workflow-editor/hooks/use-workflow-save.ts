/* ── 工作流编辑器的保存 mutation（第②层逻辑）─────────────────────────
 * WorkflowEditorInner 原先直接 \`api.workflow.update.useMutation()\` 再把
 * mutation 对象透传给 useWorkflowPersistence。这意味着「哪个组件持有
 * mutation」和「谁用它」是绑死的，而视图层持有 tRPC hook 正是规范 17
 * 的 S3 条目。
 *
 * 抽出来后：视图拿到的只有一个窄接口（mutate / mutateAsync），
 * 既满足 S3，也让 useWorkflowPersistence 不再依赖 \`api\` 的具体类型
 * ——测试里塞个假的 saver 就能跑。
 */

"use client";

import { useMemo } from "react";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";

export type WorkflowSaveInput = RouterInputs["workflow"]["update"];

/** 触发即忘写的可选回调（目前只需 onError 把「拖拽落盘失败」这类静默写暴露给
 *  用户，见规则 #4：失败路径必须有日志 + 用户可见出口）。 */
export interface WorkflowSaverMutateOptions {
  onError?: (error: unknown) => void;
}

/** useWorkflowPersistence 需要的保存能力（比 tRPC mutation 对象窄得多）。 */
export interface WorkflowSaver {
  /** 触发即忘：布局重置 / 拖拽落盘这类不需要等结果的写。
   *  `options.onError` 可选，用于把失败暴露给用户（见规则 #4）。 */
  mutate: (
    input: WorkflowSaveInput,
    options?: WorkflowSaverMutateOptions,
  ) => void;
  /** 需要知道成败的写（点「保存」后要关弹窗或报错），调用方用 try/catch 接成败，
   *  所以这条路径不重复提供 onError 通道。返回 tRPC 的真实输出类型，不丢类型安全。 */
  mutateAsync: (
    input: WorkflowSaveInput,
  ) => Promise<RouterOutputs["workflow"]["update"]>;
}

export function useWorkflowSaveMutation(): WorkflowSaver {
  const mutation = api.workflow.update.useMutation();
  return useMemo(
    () => ({
      mutate: (
        input: WorkflowSaveInput,
        options?: WorkflowSaverMutateOptions,
      ) => mutation.mutate(input, options),
      mutateAsync: (input: WorkflowSaveInput) => mutation.mutateAsync(input),
    }),
    [mutation],
  );
}
