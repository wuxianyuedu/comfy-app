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

  return <WorkflowLibraryDetailView controller={controller} />;
}
