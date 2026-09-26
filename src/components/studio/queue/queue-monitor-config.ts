// ── 队列与运行 · 第①层（纯派生，无 React / 无 IO）─────────────────────────
//
// 这一屏的存在理由：`/api/comfy/queue` 把排队回答成**两个计数**，而用户问的两句是
// 「还要多久」和「下一条是不是我的」—— 后者要逐条的名称与顺序，计数回答不了。
//
// 判据按规范 17 §17.1：删掉 JSX 还能不能跑测试。这里全部能，所以屏面上每个数字
// 都必须能落到下面某个函数的入参上，并可在 node 环境直接断言。

import { formatElapsed } from "~/components/studio/hooks/use-comfy-queue";
import { isTerminalTaskStatus } from "~/lib/task-state";
import type { RouterOutputs } from "~/trpc/react";

/**
 * 队列条目 = `task.list` 返回的一行。
 *
 * 刻意不自己重写字段：那份投影由服务端 router 定义，重写一份就是「两处表达同一件
 * 事」，router 加字段时这里只会静默落后。
 */
export type QueueRow = RouterOutputs["task"]["list"]["tasks"][number];

/** 排队项一屏最多列几条（规范 2.1：列表必须有上限）。 */
export const QUEUED_WINDOW = 50;
/** 最近结果列几条。再多没人翻，而且会挤掉正在跑那条的可视区。 */
export const RECENT_WINDOW = 8;

/** 三个桶：跑动中 / 排队中 / 最近结果。 */
export interface QueueBuckets {
  running: QueueRow[];
  queued: QueueRow[];
  recent: QueueRow[];
}

/**
 * 按状态分桶。
 *
 * 判据只走 `~/lib/task-state` 那三条（终态 / 进行中），不在这里重抄状态字面量 ——
 * 终态判据曾经散在四处，每一处写漏的表现都是「已经结束的任务还被当成在跑」。
 *
 * 「跑动中」保留成数组而不是取第一条：今天执行器是单并发，写死一条的代价是将来
 * 放开并行时界面**静默少显示**，而分桶本身不需要这个假设。
 */
export function bucketQueueRows(rows: readonly QueueRow[]): QueueBuckets {
  const running: QueueRow[] = [];
  const queued: QueueRow[] = [];
  const recent: QueueRow[] = [];
  for (const row of rows) {
    if (row.status === "RUNNING") {
      running.push(row);
      continue;
    }
    if (isTerminalTaskStatus(row.status)) {
      recent.push(row);
      continue;
    }
    /**
     * 剩下的都算「还没轮到」：`QUEUED` 是最常见的一种，但**不认识的脏状态 /
     * 将来新增的状态也走这里**。
     *
     * 为什么不让它继续往下掉进「最近结果」，也不许它三个桶都不命中：
     * 后者会让一行任务从屏面上静默消失 —— 用户看到「没有在排的任务」，而它其实
     * 卡在某个后端认识的中间态里。归进等待堆、状态标签原样回显（`taskStatusLabel`
     * 对未知值就是回显原文），最差也只是「归类保守」，不会是「看不见」。
     */
    queued.push(row);
  }
  return { running, queued, recent };
}

/**
 * 排队位次（第 1 位 = 下一个开跑）。
 *
 * 为什么要显式反一次：`task.list` 一律按 `createdAt` **倒序**返回（仓储层四条分支
 * 都是同一句倒序，且不暴露排序参数），而执行器排队是先入先出 —— 提交最早的那条
 * 先跑。直接拿倒序数组的下标当位次，会把最后一个排队的显示成「第 1 位」。
 */
export function queuedWithPosition(
  queued: readonly QueueRow[],
): Array<{ row: QueueRow; position: number }> {
  const total = queued.length;
  return queued
    .map((row, index) => ({ row, position: total - index }))
    .sort((a, b) => a.position - b.position)
    .slice(0, QUEUED_WINDOW);
}

/** 最近结果：按窗口上限截断（进来的顺序已是新的在前）。 */
export function recentWithin(rows: readonly QueueRow[]): QueueRow[] {
  return rows.slice(0, RECENT_WINDOW);
}

/**
 * 剩余时间估算（毫秒）。返回 null = 现在算不出来，屏面写「估算中」。
 *
 * 两种情况**必须**给 null 而不是给个数：
 *   · 进度还是 0 —— 分母为 0，任何数都是编的；
 *   · 进度已经 100 —— 它在收尾，报「剩余 0 秒」只是噪声。
 * 宁缺毋滥：这一屏的数字是用户决定「要不要再提交一条」的依据。
 */
export function estimateRemainingMs(
  elapsedMs: number,
  progressPct: number,
): number | null {
  if (progressPct <= 0 || progressPct >= 100) return null;
  const total = elapsedMs / (progressPct / 100);
  return Math.max(0, Math.round(total - elapsedMs));
}

/** 「剩余」那一格：算不出就明说在估算，不留空也不给假数。 */
export function remainingText(remainingMs: number | null): string {
  if (remainingMs === null) return "估算中";
  return `约 ${formatElapsed(remainingMs)}`;
}

/**
 * 「已跑」那一格。
 *
 * `elapsedMs` 为 null 的含义是**没有在跑的任务**，不是「0 秒」—— 把 null 渲染成
 * `00:00` 会让人以为刚开跑，那是两种完全不同的状态。
 */
export function runningElapsedText(elapsedMs: number | null): string {
  if (elapsedMs === null) return "尚未开跑";
  return formatElapsed(elapsedMs);
}

/**
 * 空态文案。
 *
 * 「没在跑」有两种原因（队列真的空 / 后端没连上），合成一句会让用户以为任务丢了。
 * 与状态栏那一格的口径一致：离线时不报排队数，只说没连上。
 */
export function emptyStateText(
  online: boolean,
  waitingCount: number,
): { title: string; description: string } {
  if (!online) {
    return {
      title: "ComfyUI 未运行",
      description:
        "队列里的任务不会开始。启动后端后这一屏会自动接上，不用手动刷新。",
    };
  }
  if (waitingCount > 0) {
    return {
      title: "上一条刚跑完",
      description: `还有 ${String(waitingCount)} 个在排队，后端空出来就开工。`,
    };
  }
  return {
    title: "没有在跑的任务，也没有排队中的条目",
    description: "从画布或工坊提交一次生成，它会立刻出现在这里。",
  };
}

/**
 * 「复制去重投」的载荷。
 *
 * 为什么这个动作不叫「重试」：后端**没有** retry 端点（那个 REST 路径从未实现过），
 * 真实语义就是「把这次提交的输入交回画布再投一遍」。所以这里不摆一个点了必然失败
 * 的按钮，只把内容送到剪贴板。
 *
 * 载荷刻意只放 `task.list` 真有的字段（提示词 / 工作流 / 类型）—— 参数表要详情接口
 * 才给，为凑一句「已复制全部参数」多发一次查询，且文案仍然对不上，不值得。
 */
export function reprintText(row: QueueRow): string {
  return [
    `提示词：${row.prompt}`,
    `工作流：${row.workflowName}`,
    `类型：${row.type}`,
  ].join("\n");
}
