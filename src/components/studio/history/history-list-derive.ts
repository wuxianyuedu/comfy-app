// ── 历史记录列表：派生计算（规范 17 §17.2 第①层：纯函数，无 React）──────────
// 筛选 / 排序 / 状态计数 / 日期分组 / 分页裁剪——纯函数、可直接单测，
// 这五条规则是「历史记录怎么看」的全部业务。

import type { FilterKey, SortKey, TaskItem } from "./history-types";
import { dateBucket } from "./history-utils";
import { getOrCreate } from "~/lib/collections";

export interface TaskGroup {
  /** 日期桶标题（今天 / 昨天 / yyyy-mm-dd）。 */
  key: string;
  items: TaskItem[];
}

/** 筛选：ALL 表示不过滤。 */
export function filterTasks(tasks: TaskItem[], filter: FilterKey): TaskItem[] {
  return filter === "ALL"
    ? tasks
    : tasks.filter((task) => task.status === filter);
}

/** 排序：newest 时间倒序，oldest 时间正序。返回新数组，不改入参。 */
export function sortTasks(tasks: TaskItem[], sort: SortKey): TaskItem[] {
  return [...tasks].sort((taskA, taskB) => {
    const da = new Date(taskA.createdAt).getTime();
    const db = new Date(taskB.createdAt).getTime();
    return sort === "newest" ? db - da : da - db;
  });
}

/** 各状态计数：ALL 为总数，其余按 status 累加。 */
export function countByStatus(tasks: TaskItem[]): Record<string, number> {
  const countsMap: Record<string, number> = { ALL: tasks.length };
  for (const task of tasks)
    countsMap[task.status] = (countsMap[task.status] ?? 0) + 1;
  return countsMap;
}

/** 按日期分组（已排序的输入，保持组内顺序）。 */
export function groupByDate(tasks: TaskItem[]): TaskGroup[] {
  const bucketMap = new Map<string, TaskItem[]>();
  for (const task of tasks) {
    getOrCreate(bucketMap, dateBucket(task.createdAt), () => []).push(task);
  }
  return Array.from(bucketMap.entries()).map(([key, items]) => ({
    key,
    items,
  }));
}

/**
 * 分页裁剪：按分组顺序累计，超过 displayCount 的整组截断。
 * 注意 remaining 减的是**整组长度**而不是已切片长度——保证「日期分组」
 * 语义完整：一个分组要么整组可见，要么整组不展开。
 */
export function paginateGroups(
  groups: TaskGroup[],
  displayCount: number,
): { visibleGroups: TaskGroup[]; visibleTotal: number; canLoadMore: boolean } {
  let remaining = displayCount;
  const visibleGroups: TaskGroup[] = [];
  for (const group of groups) {
    if (remaining <= 0) break;
    const sliced = group.items.slice(0, remaining);
    if (sliced.length > 0)
      visibleGroups.push({ key: group.key, items: sliced });
    remaining -= group.items.length;
  }
  const visibleTotal = visibleGroups.reduce(
    (sum, group) => sum + group.items.length,
    0,
  );
  return {
    visibleGroups,
    visibleTotal,
    canLoadMore: visibleTotal < total(groups),
  };
}

function total(groups: TaskGroup[]): number {
  return groups.reduce((sum, group) => sum + group.items.length, 0);
}

/** 空状态文案：区分「一条都没有」与「当前筛选下没有」。 */
export function emptyStateText(
  filter: FilterKey,
  filterLabel: string,
): { title: string; hint: string } {
  if (filter === "ALL") {
    return {
      title: "暂无任务记录",
      hint: "在创作台生成内容后，历史记录会显示在这里。",
    };
  }
  return {
    title: `暂无${filterLabel}任务`,
    hint: "切换到「全部」可查看所有任务。",
  };
}
