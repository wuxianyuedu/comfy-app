"use client";

// 各生成入口的模型选择状态（#4834，从 useWorkshopPipeline 拆出的子 hook，
// 规范 §12.13 函数长度）：统一为测试模型级联的取值空间，随工坊草稿持久化。
// 旧草稿只有 workflowId / videoWorkflowId ⇒ 经 draftModelSelections 映射成
// `wf::<id>` 的本地模型选择，恢复不丢；workflowId / videoWorkflowId 作为
// 派生读数返回，供 Agent 一键成片等仍认工作流 id 的消费方无感使用。

import React from "react";

import type { WorkshopModelSelection, WorkshopModelSelections } from "~/lib/workshop/draft-store";
import { workflowIdFromCandidateValue } from "../model-test-config";

export function useWorkshopModelSelections(initial: WorkshopModelSelections): {
  modelSelections: WorkshopModelSelections;
  /** 整表替换（草稿恢复 / 服务端镜像采纳时用）。 */
  replaceAll: (next: WorkshopModelSelections) => void;
  setModelSelection: (key: keyof WorkshopModelSelections, next: WorkshopModelSelection) => void;
  /** 视频入口选定的本地工作流 id（派生口径同下）。 */
  videoWorkflowId: string;
  /** 镜头生图入口选定的本地工作流 id（`wf::<id>` 派生；空串 = 未选本地工作流）。 */
  workflowId: string;
} {
  const [modelSelections, setModelSelections] = React.useState<WorkshopModelSelections>(initial);

  const replaceAll = React.useCallback((next: WorkshopModelSelections) => {
    setModelSelections(next);
  }, []);

  /** 某个生成入口的模型选择：统一走测试模型级联的取值空间。 */
  const setModelSelection = React.useCallback(
    (key: keyof WorkshopModelSelections, next: WorkshopModelSelection) => {
      setModelSelections((prev) => ({ ...prev, [key]: next }));
    },
    [],
  );

  const videoWorkflowId = React.useMemo(
    () => workflowIdFromCandidateValue(modelSelections.video?.model ?? ""),
    [modelSelections],
  );
  const workflowId = React.useMemo(
    () => workflowIdFromCandidateValue(modelSelections.shot?.model ?? ""),
    [modelSelections],
  );

  return {
    modelSelections,
    replaceAll,
    setModelSelection,
    videoWorkflowId,
    workflowId,
  };
}
