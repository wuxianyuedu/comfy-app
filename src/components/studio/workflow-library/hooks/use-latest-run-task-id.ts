"use client";

// ── 某工作流最近一次运行的 taskId（store 订阅版，#4466）──────────────────
// 此前「工坊封装」与「画布节点」两处用 useMemo 读模块级运行登记表、依赖只有
// workflowId —— 登记表变化不触发重算，执行日志按钮的摘要指向旧一次运行
// （与旁边新运行的呼吸点自相矛盾，日志弹窗打开才纠正）。
// 这里经 useSyncExternalStore 订阅登记表（与 WorkflowRunLogButton 同口径），
// 登记表一变即重算；过滤逻辑仍走既有出口 latestRunForWorkflow，不另写第二套。

import { useSyncExternalStore } from "react";

import {
  getWorkflowRunStoreSnapshot,
  latestRunForWorkflow,
  subscribeWorkflowRunStore,
  type WorkflowRunSource,
} from "~/lib/workflow/workflow-run-store";

export function useLatestRunTaskId(workflowId: string, source?: WorkflowRunSource): string | null {
  /* 订阅登记表：返回值不直接使用，作用是登记表变化时触发本组件重算。 */
  useSyncExternalStore(
    subscribeWorkflowRunStore,
    getWorkflowRunStoreSnapshot,
    getWorkflowRunStoreSnapshot,
  );
  return latestRunForWorkflow(workflowId, source)?.taskId ?? null;
}
