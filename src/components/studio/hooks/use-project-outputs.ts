"use client";

// ── 项目画布输出：逻辑层（规范 17 §17.2 第②层）──────────────────────────────
// 承载「某项目的全部生成产出」的 tRPC useQuery 与返回形状收窄。ProjectOutputs
// 视图只消费本 hook 的 controller，不再直接出现 `api.project.outputs.useQuery`。

import { useCallback } from "react";

import { api } from "~/trpc/react";

export interface ProjectOutputImage {
  id: string;
  localPath: string;
  mediaType: string;
  seed: string | null;
  width: number | null;
  height: number | null;
  isCover: boolean;
}

export interface ProjectOutputItem {
  id: string;
  type: string;
  status: string;
  workflowName: string | null;
  prompt: string | null;
  negativePrompt: string | null;
  seed: string | null;
  size: string | null;
  sampler: string | null;
  steps: number | null;
  cfg: number | null;
  checkpoint: string | null;
  referenceImages: string[];
  createdAt: string;
  images: ProjectOutputImage[];
}

export interface ProjectOutputsController {
  outputs: ProjectOutputItem[];
  loading: boolean;
  refetching: boolean;
  refetch: () => void;
}

export function useProjectOutputs(
  projectId: string | null,
): ProjectOutputsController {
  const outputsQ = api.project.outputs.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );

  // 服务端 createdAt 是 Date，视图层要字符串做时间轴展示，这里统一收窄。
  const outputs = (outputsQ.data?.outputs ?? []).map((output) => ({
    ...output,
    createdAt: String(output.createdAt),
  })) as ProjectOutputItem[];

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
