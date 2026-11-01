"use client";

// 角色 LoRA 绑定的候选清单（#2622 FR-QA-02③）：模型库 loras 目录的文件名。
// tRPC 取数收在这里（规范 17：视图不经手取数），视图只拿 string[]。
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

export function useCharacterLoraOptions(): {
  loading: boolean;
  options: Array<string>;
} {
  const trpc = useTRPC();
  const lorasQ = useQuery(trpc.model.list.queryOptions({ type: "loras" }));
  const options = (lorasQ.data?.models ?? [])
    .map((m) => m.fileName)
    .filter((n): n is string => Boolean(n));
  return { options, loading: lorasQ.isLoading };
}
