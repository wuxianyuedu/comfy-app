// ── 队列与运行 · 第①层（纯派生，无 React / 无 IO）──
// 这一屏存在理由：/api/comfy/queue 把排队回答成两个计数，而用户问「还要多久」「下一条是不是我的」——
// 后者要逐条名称与顺序，计数答不了。判据按规范 17 §17.1：删掉 JSX 仍能跑测试，
// 故屏面每个数字都必须落到下面某个函数入参，可在 node 环境直接断言。

import { formatElapsed } from "~/components/studio/hooks/use-comfy-queue";
import { estimateRemainingMsFrom } from "~/lib/progress";
import { matchesNeedle, normalizeNeedle } from "~/lib/list-filter";
import { isTerminalTaskStatus } from "~/lib/task-state";
import type { RouterOutputs } from "~/trpc/react";

/**
 * 队列条目 = task.list 返回的一行。刻意不重写字段：投影由服务端 router 定义，
 * 重写一份就是两处表达同一件事，router 加字段时这里只会静默落后。
 */
export type QueueRow = RouterOutputs["task"]["list"]["tasks"][number];

/** 排队项一屏最多列几条（规范 2.1：列表必须有上限）。 */
export const QUEUED_WINDOW = 50;
/** 最近结果列几条。再多没人翻，而且会挤掉正在跑那条的可视区。 */
export const RECENT_WINDOW = 8;

/** 三个桶：跑动中 / 排队中 / 最近结果。 */
export type QueueBuckets = {
  queued: Array<QueueRow>;
  recent: Array<QueueRow>;
  running: Array<QueueRow>;
};

/**
 * 按状态分桶。判据只走 ~/lib/task-state 的三条（终态/进行中），不重抄状态字面量 ——
 * 终态判据曾散在四处，写漏即「已结束仍当成在跑」。
 * 「跑动中」保留成数组而非取第一条：今天单并发，写死一条会在将来并行时静默少显示。
 */
export function bucketQueueRows(rows: ReadonlyArray<QueueRow>): QueueBuckets {
  const running: Array<QueueRow> = [];
  const queued: Array<QueueRow> = [];
  const recent: Array<QueueRow> = [];
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
     * 剩下的都算「还没轮到」：QUEUED 最常见，但不认识的脏状态 / 未来新增状态也走这里。
     * 不能掉进「最近结果」，也不许三桶都不命中 —— 后者会让任务从屏面静默消失；
     * 归进等待堆、状态标签原样回显（taskStatusLabel 对未知值即回显原文），最差只是归类保守。
     */
    queued.push(row);
  }
  return { running, queued, recent };
}

/** 顶部指标带的四格读数（纯派生，视图只渲染）。今日终态按真实结束时刻统计，
 * 历史任务在今天重跑完成也能计入；缺少结束时刻的旧数据才退回创建时刻。
 * 窗口版只作首帧兜底：正式口径走 {@link queueStatsFromCounts} 的服务端全量计数。 */
export type QueueStats = {
  failedToday: number;
  queued: number;
  running: number;
  succeededToday: number;
};

export function queueStats(buckets: QueueBuckets, now: Date): QueueStats {
  const today = now.toDateString();
  let succeededToday = 0;
  let failedToday = 0;
  for (const row of buckets.recent) {
    if ((row.finishedAt ?? row.createdAt).toDateString() !== today) {
      continue;
    }
    if (row.status === "SUCCEEDED") {
      succeededToday += 1;
    } else if (row.status === "FAILED") {
      failedToday += 1;
    }
  }
  return {
    failedToday,
    queued: buckets.queued.length,
    running: buckets.running.length,
    succeededToday,
  };
}

/**
 * 指标带的**全量口径**（#5073）：优先读服务端 `task.list` 已带的按状态分组计数
 * （SQL GROUP BY，与 take 无关），今日完成 / 失败读同一口径的时间过滤版。
 * 首帧拿不到计数时才退回窗口版 —— 宁可短暂偏小，也不拿 200 行切片冒充全量。
 */
export function queueStatsFromCounts(
  statusCounts: Record<string, number> | null | undefined,
  todayCounts: Record<string, number> | null | undefined,
  fallback: QueueStats,
): QueueStats {
  return {
    failedToday: todayCounts?.FAILED ?? fallback.failedToday,
    queued: statusCounts?.QUEUED ?? fallback.queued,
    running: statusCounts?.RUNNING ?? fallback.running,
    succeededToday: todayCounts?.SUCCEEDED ?? fallback.succeededToday,
  };
}

/**
 * 排队位次（第 1 位 = 下一个开跑）。位次由服务端按完整 QUEUED 队列给出
 *（task.list 的 `queuePosition`），不按当前页子集重编号 —— 分页只加载到第 61 位时
 * 仍显示真实的 61/62，队列快照里已没有这一行时给 null，绝不编造。
 */
export function queuedWithPosition(
  queued: ReadonlyArray<QueueRow>,
  limit = QUEUED_WINDOW,
): Array<{ position: number | null; row: QueueRow }> {
  return queued
    .map((row) => ({ row, position: row.queuePosition }))
    .sort(
      (a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER),
    )
    .slice(0, limit);
}

/** 最近结果：默认按窗口上限截断；分页视图可显式展示已加载的全部终态行。 */
export function recentWithin(
  rows: ReadonlyArray<QueueRow>,
  limit = RECENT_WINDOW,
): Array<QueueRow> {
  return rows.slice(0, limit);
}

export type QueueStatusFilter = "active" | "all" | "terminal";

/** 搜索只匹配已加载行；状态筛选交给服务端分页，避免「筛到了但没加载」的假空态。 */
export function searchQueueRows(rows: ReadonlyArray<QueueRow>, query: string): Array<QueueRow> {
  const needle = normalizeNeedle(query);
  if (needle === "") {
    return [...rows];
  }
  return rows.filter((row) =>
    [row.workflowName, row.prompt, row.modelName ?? "", row.id, row.error ?? ""].some((value) =>
      matchesNeedle(needle, value),
    ),
  );
}

/** 任务耗时：开始时刻优先取 claimedAt，缺失的旧任务退回创建时刻。 */
export function queueTaskDurationMs(row: QueueRow): number | null {
  if (row.finishedAt === null) {
    return null;
  }
  return Math.max(0, row.finishedAt.getTime() - (row.claimedAt ?? row.createdAt).getTime());
}

/**
 * 剩余时间估算（毫秒）；null = 现在算不出来，屏面写「估算中」。
 * 进度为 0（分母 0）或已 100（收尾）必须给 null 而非数字 —— 这一屏数字是用户决定
 * 「要不要再提交一条」的依据，宁缺毋滥。
 * 实现收在 `~/lib/progress`（画布进度覆盖层的剩余时间是同一份算法）。
 */
export function estimateRemainingMs(elapsedMs: number, progressPct: number): number | null {
  return estimateRemainingMsFrom(elapsedMs, progressPct);
}

/** 「剩余」那一格：算不出就明说在估算，不留空也不给假数。 */
export function remainingText(remainingMs: number | null): string {
  if (remainingMs === null) {
    return "估算中";
  }
  return `约 ${formatElapsed(remainingMs)}`;
}

/**
 * 「已跑」那一格。`elapsedMs` 为 null 表示没有在跑的任务，不是「0 秒」——
 * 渲染成 00:00 会让人以为刚开跑，那是两种完全不同的状态。
 */
export function runningElapsedText(elapsedMs: number | null): string {
  if (elapsedMs === null) {
    return "尚未开跑";
  }
  return formatElapsed(elapsedMs);
}

/**
 * 「ComfyUI 未连接且一条任务都没有」的整页空态。「没在跑」有两种原因（队列真空 / 后端没连上），
 * 合成一句会让人以为任务丢了。离线但列表还有任务时不说这句 —— 列表照常铺开，只在顶部放横幅
 *（见 offlineBannerText），整页空态正是「状态闪一下」的放大器。
 */
export function offlineEmptyText(): { description: string; title: string } {
  return {
    title: "ComfyUI 未运行",
    description: "队列里的任务不会开始。启动后端后这一屏会自动接上，不用手动刷新。",
  };
}

/**
 * 离线横幅（列表还在时顶部的提示条）：只说「现在不会开始 + 连上会自动接上」，
 * 不报排队数 —— 排队数在页头和列表里都看得见，横幅再报一遍是同一件事说两遍。
 */
export function offlineBannerText(): { description: string; title: string } {
  return {
    title: "ComfyUI 未连接",
    description: "队列里的任务暂时不会开始；连接恢复后这一屏自动接上，不用手动刷新。",
  };
}

/**
 * 「跑动中」段空位文案。在线两句话术（刚跑完有排队 / 完全没任务）；离线不说「上一条刚跑完」
 *（离线根本没跑完东西），也不重复横幅的「未连接」—— 上面说过，这里只答「这一段为什么空」。
 */
export function runningHintText(
  online: boolean,
  waitingCount: number,
): { description: string; title: string } {
  if (!online) {
    return {
      title: "没有在跑的任务",
      description: "连接恢复后，排队的任务会自动接上。",
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

/** 离线兜底跑动卡（数据来自库里的 RUNNING 行）的说明行：富数据（耗时 /
 * 节点 / 模型）来自 `/api/comfy/queue`，读不到时如实说缺什么，不留空格。 */
export function offlineRunningCardNote(): string {
  return "ComfyUI 未连接，连接后显示耗时与节点明细。";
}

/**
 * 「复制去重投」的载荷。动作不叫「重试」：后端没有 retry 端点（REST 路径从未实现），
 * 真实语义是把这次提交的输入交回画布再投一遍 —— 所以不摆点了必然失败的按钮，只送剪贴板。
 * 载荷只放 task.list 真有的字段（提示词/工作流/类型）；参数表要详情接口才有。
 * 参数收窄成这三列的结构化子集（ISSUE #4619）：历史页的行（TaskItem）与队列行
 * 同源不同形，动作是同一件事，不该逼调用方先凑齐整行。
 */
export function reprintText(row: Pick<QueueRow, "prompt" | "type" | "workflowName">): string {
  return [`提示词：${row.prompt}`, `工作流：${row.workflowName}`, `类型：${row.type}`].join("\n");
}

/** 队列页左树的选中态：选中的是一片「用途 + 模式 + 模型」叶子；null = 未筛选。 */
export type ModelTreeSelection = { kind: string; mode: string; value: string } | null;

/** 树叶子的最小形状（workshop 的 ModelTreeEntry 结构可赋值给它，纯模块不反向引视图）。 */
export type ModelTreeFilterEntry = {
  kind: string;
  label: string;
  mode: string;
  modelName: string;
  value: string;
};

/**
 * 按左树选中的模型叶子过滤队列行。匹配判据（取并集，宽容优先）：
 * `modelName` 对上叶子的模型标签 / 显示名，或 `workflowName` 对上叶子显示名
 * （本地工作流候选的叶子名 = 工作流名）。选中的叶子在树里找不到（理论不可达）
 * 时不筛选，宁可多显示也不静默吞行。
 */
export function filterRowsByModelSelection(
  rows: ReadonlyArray<QueueRow>,
  selection: ModelTreeSelection,
  entries: ReadonlyArray<ModelTreeFilterEntry>,
): Array<QueueRow> {
  if (selection === null) {
    return [...rows];
  }
  const entry = entries.find(
    (candidate) =>
      candidate.kind === selection.kind &&
      candidate.mode === selection.mode &&
      candidate.value === selection.value,
  );
  if (entry === undefined) {
    return [...rows];
  }
  return rows.filter(
    (row) =>
      (entry.modelName !== "" && row.modelName === entry.modelName) ||
      row.modelName === entry.label ||
      row.workflowName === entry.label,
  );
}
