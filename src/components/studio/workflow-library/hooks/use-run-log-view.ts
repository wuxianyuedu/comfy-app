"use client";

// ── 执行日志弹窗的开关与「看哪一次运行」────────────────────────────────
// 「工坊封装」与「画布节点」两页签各自一处日志入口（ISSUE #611），状态形状
// 相同：弹窗开关 + 指定查看的 taskId（点开时锁定；未点开时跟随最近一次）。
// 最近一次经 useLatestRunTaskId 订阅运行登记表取（#4466：useMemo 读模块级
// 登记表不重算，按钮摘要会指向旧一次运行）。

import { useCallback, useState } from "react";

import type { WorkflowRunSource } from "~/lib/workflow/workflow-run-store";

import { useLatestRunTaskId } from "./use-latest-run-task-id";

export function useRunLogView(workflowId: string, source: WorkflowRunSource) {
  const [open, setOpen] = useState(false);
  const [viewTaskId, setViewTaskId] = useState<string | null>(null);
  const latestTaskId = useLatestRunTaskId(workflowId, source);
  const openLog = useCallback(() => {
    setOpen(true);
  }, []);
  const closeLog = useCallback(() => {
    setOpen(false);
  }, []);
  return {
    closeLog,
    /** 弹窗开关。 */
    open,
    openLog,
    /** 弹窗实际渲染哪一次运行：点开时锁定，未点开跟随最近一次。 */
    viewTaskId: viewTaskId ?? latestTaskId,
    /** 弹窗内切换查看的运行（SSE 回放等场景）。 */
    setViewTaskId,
  };
}
