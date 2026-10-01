"use client";

// ── 首页「模型概览」的逻辑层（规范 17 §17.2 第②层）─────────────────────────
// 只做一件读操作：把 `model.configList` 的按目录计数取回来，交给纯函数
// `deriveModelOverview` 去排。判断力在那一侧（可单测、不碰网络），这一侧只接线。
//
// 为什么不复用 `useModelFolderConfig`：那个 hook 是「目录配置弹层」的 controller，
// 除了读列表还挂着 enable / disable / 重新扫描 / 删除四个写动作与它们的忙碌位、
// 错误位、搜索与筛选状态。首页只要一份只读计数，把它整个拖进来会带来两个后果：
// 一是首页跟着写动作一起重渲染，二是那个弹层的交互状态被复制到第二个消费点
// （规范 §12.18 说的是「有等价实现就 import」，这里是**更宽**的实现，不是等价的）。
// 两者读的是同一条 tRPC 查询，TanStack Query 按 key 去重 —— 不会多一路请求。

import { api } from "~/trpc/react";

import { deriveModelOverview } from "../model-overview-derive";

export function useModelOverview() {
  const query = api.model.configList.useQuery();

  return deriveModelOverview({
    folders: query.data?.folders,
    loading: query.isLoading,
    isError: query.isError,
  });
}
