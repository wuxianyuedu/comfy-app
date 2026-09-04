"use client";

// ── 「我的作品」页数据层（规范 17 §17.2 第②层）────────────────────────────
// 页面用 tRPC task.list 拉取本机生成结果。page.tsx 只消费本 hook 的 controller，
// 不再直接出现 `api.task.*.useQuery`。

import { useCallback } from "react";

import { api } from "~/trpc/react";

export interface MyWorkTask {
  id: string;
  status: string;
  workflowName: string;
  prompt: string;
  cover: string | null;
}

export interface MyWorksController {
  tasks: MyWorkTask[];
  isLoading: boolean;
  isError: boolean;
  /** 手动刷新。 */
  refetch: () => void;
}

export function useMyWorks(): MyWorksController {
  const listQ = api.task.list.useQuery();

  const refetch = useCallback(() => {
    void listQ.refetch();
  }, [listQ]);

  return {
    tasks: listQ.data?.tasks ?? [],
    isLoading: listQ.isLoading,
    isError: listQ.isError,
    refetch,
  };
}
