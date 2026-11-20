"use client";

/* 右侧工作流详情面板：画布节点拓扑、参数表单、源文件、操作入口。
 *
 * 容器层：取 controller → 交给纯展示视图，自身不持有业务规则。
 * 对外 props 保持不变 —— `WorkflowLibrary.tsx` 是当前唯一消费方。 */

import type { WorkflowLibraryDetailProps } from "./workflow-library-detail-config";
import { WorkflowLibraryDetailView } from "./WorkflowLibraryDetailView";
import { useWorkflowLibraryDetail } from "./hooks/use-workflow-library-detail";

export type { WorkflowLibraryDetailProps };

export function WorkflowLibraryDetail(props: WorkflowLibraryDetailProps) {
  const controller = useWorkflowLibraryDetail(props);

  /* 打开耗时的记账口不经 controller（它是父级的一次性时刻，不是详情的状态），
   * 直接递给视图 —— 视图在详情数据落定那一刻消费它（ISSUE #4580）。 */
  return <WorkflowLibraryDetailView controller={controller} openedAtRef={props.openedAtRef} />;
}
