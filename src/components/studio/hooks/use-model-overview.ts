"use client";

// ── 首页「模型概览」的逻辑层（规范 17 §17.2 第②层）
// 只做一件读操作：取 `model.configList` 的按目录计数交给纯函数 `deriveModelOverview` 去排。
// 不复用 `useModelFolderConfig`：那个 hook 还挂着四个写动作与忙碌位 / 错误位 / 搜索筛选状态，
// 拖进来会让首页跟着写动作重渲染、弹层交互状态被复制（规范 §12.18 要的是等价实现）。
// 两者读同一条 tRPC 查询，TanStack Query 按 key 去重，不会多一路请求。

import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

import { deriveModelOverview } from "../model-overview-derive";

export function useModelOverview() {
  const trpc = useTRPC();
  const query = useQuery(trpc.model.configList.queryOptions());

  return deriveModelOverview({
    folders: query.data?.folders,
    loading: query.isLoading,
    isError: query.isError,
  });
}
