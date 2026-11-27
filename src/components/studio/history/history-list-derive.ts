// ── 历史记录列表：派生计算（规范 17 §17.2 第①层：纯函数，无 React）──────────
// 筛选 / 排序 / 状态计数 / 日期分组 / 分页裁剪——纯函数、可直接单测，
// 这五条规则是「历史记录怎么看」的全部业务。

import { formatDurationMs } from "~/lib/time-format";
import { getWorkflowType } from "~/lib/workflow/workflow-types";

import { taskDurationMs } from "../queue/queue-monitor-config";
import type { FilterKey, SortKey, TaskItem } from "./history-types";
import { dateBucket } from "./history-utils";
import { getOrCreate } from "~/lib/collections";

/**
 * 模式名称（ISSUE #4619）：任务类型码 → 工作流类型表的中文标签
 * （T2I → 文生图、I2V → 单图生视频…）。表里没有的码（历史遗留 / 新增未登记）
 * 如实回落原码，不编一个假名字。
 */
export function modeLabelOf(type: string): string {
  return getWorkflowType(type)?.label ?? type;
}

/**
 * 展示用模型名（ISSUE #4619）：优先任务行上解析到的模型标签
 * （工作流库给工作流挂的模型名）；没挂标签时回落工作流名 —— 行上仍要能
 * 认出这是哪次提交，不为了「不显示工作流名」而留空白。
 */
export function modelLabelOf(task: Pick<TaskItem, "modelName" | "workflowName">): string {
  const model = task.modelName?.trim();
  return model !== undefined && model !== "" ? model : task.workflowName;
}

/** 还有进行中（QUEUED / RUNNING）的任务吗——轮询与进行中 UI 的判据。 */
export function hasActiveTasks(tasks: ReadonlyArray<Pick<TaskItem, "status">>): boolean {
  return tasks.some((task) => task.status === "QUEUED" || task.status === "RUNNING");
}

export type TaskGroup = {
  items: Array<TaskItem>;
  /** 日期桶标题（今天 / 昨天 / yyyy-mm-dd）。 */
  key: string;
};

/** 筛选：ALL 表示不过滤。 */
export function filterTasks(tasks: Array<TaskItem>, filter: FilterKey): Array<TaskItem> {
  return filter === "ALL" ? tasks : tasks.filter((task) => task.status === filter);
}

/**
 * 最近活动时刻（#5076）：终态任务以完成时刻为准 —— 用户持续生图时，卡片
 * 不该停在「提交 6 小时前」。老行没有 finishedAt 时回落 claimedAt，再回落
 * createdAt。返回 ISO 字符串，与 TaskItem 的其它时间字段同形。
 */
export function activityAtOf(task: TaskItem): string {
  return task.finishedAt ?? task.claimedAt ?? task.createdAt;
}

/**
 * 生成耗时读数（ISSUE #5115）：card 与详情共用同一个派生 + 同一个格式化出口，
 * 保证同一条任务两处读到的时长逐字一致。null = 没有终态时刻（未完 / 中断），
 * 界面据此不渲染空盒子。formatDurationMs 的 `s/m/h` 口径与队列页一致。
 */
export function taskDurationTextOf(task: {
  claimedAt?: Date | string | null;
  createdAt: Date | string;
  finishedAt?: Date | string | null;
}): string | null {
  return formatDurationMs(taskDurationMs(task));
}

/** 排序：newest 时间倒序，oldest 时间正序。返回新数组，不改入参。 */
export function sortTasks(tasks: Array<TaskItem>, sort: SortKey): Array<TaskItem> {
  return [...tasks].sort((taskA, taskB) => {
    const da = new Date(activityAtOf(taskA)).getTime();
    const db = new Date(activityAtOf(taskB)).getTime();
    return sort === "newest" ? db - da : da - db;
  });
}

/** 各状态计数：ALL 为总数，其余按 status 累加。 */
export function countByStatus(tasks: Array<TaskItem>): Record<string, number> {
  const countsMap: Record<string, number> = { ALL: tasks.length };
  for (const task of tasks) {
    countsMap[task.status] = (countsMap[task.status] ?? 0) + 1;
  }
  return countsMap;
}

/** 按日期分组（已排序的输入，保持组内顺序）。 */
export function groupByDate(tasks: Array<TaskItem>): Array<TaskGroup> {
  const bucketMap = new Map<string, Array<TaskItem>>();
  for (const task of tasks) {
    getOrCreate(bucketMap, dateBucket(activityAtOf(task)), () => []).push(task);
  }
  return [...bucketMap.entries()].map(([key, items]) => ({
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
  groups: Array<TaskGroup>,
  displayCount: number,
): { canLoadMore: boolean; visibleGroups: Array<TaskGroup>; visibleTotal: number } {
  let remaining = displayCount;
  const visibleGroups: Array<TaskGroup> = [];
  for (const group of groups) {
    if (remaining <= 0) {
      break;
    }
    const sliced = group.items.slice(0, remaining);
    if (sliced.length > 0) {
      visibleGroups.push({ key: group.key, items: sliced });
    }
    remaining -= group.items.length;
  }
  const visibleTotal = visibleGroups.reduce((sum, group) => sum + group.items.length, 0);
  return {
    visibleGroups,
    visibleTotal,
    canLoadMore: visibleTotal < total(groups),
  };
}

function total(groups: Array<TaskGroup>): number {
  return groups.reduce((sum, group) => sum + group.items.length, 0);
}

/** 空状态文案：区分「一条都没有」与「当前筛选下没有」。 */
export function emptyStateText(
  filter: FilterKey,
  filterLabel: string,
): { hint: string; title: string } {
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
