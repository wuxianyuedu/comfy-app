"use client";

// ── 项目画布输出：逻辑层（规范 17 §17.2 第②层）──────────────────────────────
// 承载「某项目的全部生成产出」的 tRPC useQuery 与返回形状收窄。ProjectOutputs
// 视图只消费本 hook 的 controller，不再直接出现 `trpc.project.outputs` 的 options 调用。

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

export type ProjectOutputImage = {
  height: number | null;
  id: string;
  isCover: boolean;
  localPath: string;
  mediaType: string;
  seed: string | null;
  width: number | null;
};

export type ProjectOutputItem = {
  cfg: number | null;
  checkpoint: string | null;
  createdAt: string;
  id: string;
  images: Array<ProjectOutputImage>;
  negativePrompt: string | null;
  /** 来源任务（#2483 FR-QA-09）：重绘 / 放大的产物指回原任务；NULL = 常规提交。 */
  parentId: string | null;
  prompt: string | null;
  referenceImages: Array<string>;
  sampler: string | null;
  seed: string | null;
  size: string | null;
  status: string;
  steps: number | null;
  type: string;
  workflowName: string | null;
};

export type ProjectOutputsController = {
  loading: boolean;
  outputs: Array<ProjectOutputItem>;
  refetch: () => void;
  refetching: boolean;
};

export function useProjectOutputs(projectId: string | null): ProjectOutputsController {
  const trpc = useTRPC();
  const outputsQ = useQuery(
    trpc.project.outputs.queryOptions(
      { projectId: projectId ?? "" },
      { enabled: projectId !== null && projectId !== "" },
    ),
  );

  // 服务端 createdAt 是 Date，视图层要字符串做时间轴展示，这里统一收窄。
  /* SAFETY: 类型断言已复核 */
  const outputs = (outputsQ.data?.outputs ?? []).map((output) => ({
    ...output,
    createdAt: String(output.createdAt),
  })) as Array<ProjectOutputItem>;

  const refetch = useCallback(() => {
    void outputsQ.refetch();
  }, [outputsQ]);

  return {
    outputs,
    loading: outputsQ.isLoading,
    refetching: outputsQ.isFetching,
    refetch,
  };
}
