"use client";

/* 漫剧推荐包面板的业务逻辑层（规范 17 §17.2 第②层）：只读候选列表 + 一键走既有导入口。
 * 视图只消费状态与回调；命中缺件时在这里拦下并给可行动提示，不向视图塞请求。 */
import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";
import { useToast } from "~/components/studio/ToastProvider";

export type AnimePackCandidateView = {
  analysis: {
    dependencies: Array<string>;
    missingNodes: Array<string>;
    mode: string | null;
    ok: boolean;
    purpose: string;
    requiredNodes: Array<string>;
  };
  name: string;
  path: string;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}

export function useAnimeWorkflowPack() {
  const trpc = useTRPC();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [busyPath, setBusyPath] = useState("");

  const candidatesQuery = useQuery({
    ...trpc.workflow.animePackCandidates.queryOptions(),
    refetchOnWindowFocus: false,
  });
  const importMutation = useMutation(trpc.workflow.create.mutationOptions());

  const importPack = useCallback(
    async (candidate: AnimePackCandidateView) => {
      const mode = candidate.analysis.mode;
      if (mode === null) {
        toast.error("无法判定工作流模式", candidate.name);
        return;
      }
      if (candidate.analysis.missingNodes.length > 0) {
        toast.error("缺必需节点，未导入", candidate.analysis.missingNodes.join("、"));
        return;
      }
      setBusyPath(candidate.path);
      try {
        await importMutation.mutateAsync({
          modes: [mode],
          name: candidate.name,
          sourcePath: candidate.path,
        });
        toast.success("已导入工作流库", candidate.name);
        await queryClient.invalidateQueries(trpc.workflow.list.queryFilter());
        await candidatesQuery.refetch();
      } catch (error) {
        toast.error("导入失败", errorText(error));
      } finally {
        setBusyPath("");
      }
    },
    [candidatesQuery, importMutation, queryClient, toast, trpc],
  );

  return {
    busyPath,
    candidates: candidatesQuery.data ?? [],
    importPack,
    isLoading: candidatesQuery.isLoading,
  };
}
