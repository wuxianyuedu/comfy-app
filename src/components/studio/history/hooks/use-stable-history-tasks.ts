"use client";

// ── 历史列表的「轮询值不变就沿用旧数组」出口 ──
// React Query 每次 refetch 都会给一份新的 data 对象，即使服务端返回的行一字未变。
// 原来的 tasks useMemo 只按 [tasksQ.data] 缓存，于是每 4s 把 100 行全部重造一遍，
// 让已 memo 的 HistoryTaskCard 全部失效。这里按行的内容指纹比较，值不变就返回
// 上一次的数组引用，只有真的变了才重建。

import { useMemo, useState } from "react";

import { jsonEquals } from "~/lib/production/json-equals";
import type { TaskItem } from "../history-types";

/** 服务端行的时间字段可能是 Date / 字符串 / 数字，展示层统一成字符串。 */
type TaskRow = Omit<TaskItem, "createdAt" | "finishedAt" | "claimedAt"> & {
  claimedAt?: unknown;
  createdAt: unknown;
  finishedAt?: unknown;
};
type TaskPage = { tasks: ReadonlyArray<TaskRow> };
export type HistoryTaskPages = ReadonlyArray<TaskPage> | undefined;

type Holder = { rows: ReadonlyArray<TaskRow>; tasks: Array<TaskItem> };

/** 用户能感知到的行字段逐项判等；短路，内容没变时一次字符串都不拼。 */
function sameTaskRow(a: TaskRow, b: TaskRow): boolean {
  return (
    a.id === b.id &&
    a.status === b.status &&
    a.createdAt === b.createdAt &&
    (a.finishedAt ?? null) === (b.finishedAt ?? null) &&
    (a.claimedAt ?? null) === (b.claimedAt ?? null) &&
    a.prompt === b.prompt &&
    (a.cover ?? null) === (b.cover ?? null) &&
    (a.coverIsCover === true) === (b.coverIsCover === true) &&
    (a.modelName ?? null) === (b.modelName ?? null) &&
    a.workflowName === b.workflowName &&
    a.type === b.type &&
    (a.error ?? null) === (b.error ?? null) &&
    (a.negativePrompt ?? null) === (b.negativePrompt ?? null) &&
    jsonEquals(a.params, b.params) &&
    jsonEquals(a.validationErrors, b.validationErrors)
  );
}

function sameRows(prev: ReadonlyArray<TaskRow>, next: ReadonlyArray<TaskRow>): boolean {
  if (prev === next) {
    return true;
  }
  if (prev.length !== next.length) {
    return false;
  }
  for (let i = 0; i < prev.length; i += 1) {
    const before = prev[i];
    const after = next[i];
    if (before === undefined || after === undefined || !sameTaskRow(before, after)) {
      return false;
    }
  }
  return true;
}

function isoText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return null;
}

/**
 * 由各页行派生展示用的 TaskItem，并缓存引用：轮询回来内容一致时沿用旧数组。
 * 比较发生在映射之前，避免为「没变的数据」白做 100 次对象展开。
 *
 * 缓存放在每个 hook 实例自带的可变对象里（不是 ref）：这里刻意要在 render 期
 * 读它做判等，ref 会让 react(refs) 规则报警；普通 holder 的语义等价而判据不误伤。
 */
export function useStableHistoryTasks(pages: HistoryTaskPages): Array<TaskItem> {
  const [holder] = useState<Holder>(() => ({ rows: [], tasks: [] }));
  return useMemo<Array<TaskItem>>(() => {
    const rows = (pages ?? []).flatMap((page) => page.tasks);
    if (sameRows(holder.rows, rows)) {
      return holder.tasks;
    }
    const byId = new Map<string, TaskItem>();
    for (const page of pages ?? []) {
      for (const task of page.tasks) {
        byId.set(task.id, {
          claimedAt: isoText(task.claimedAt),
          cover: task.cover ?? null,
          coverIsCover: task.coverIsCover,
          createdAt: isoText(task.createdAt) ?? "",
          error: task.error ?? null,
          finishedAt: isoText(task.finishedAt),
          id: task.id,
          modelName: task.modelName ?? null,
          negativePrompt: task.negativePrompt ?? null,
          params: task.params ?? null,
          prompt: task.prompt,
          status: task.status,
          type: task.type,
          validationErrors: task.validationErrors ?? null,
          workflowName: task.workflowName,
        });
      }
    }
    const tasks = [...byId.values()];
    holder.rows = rows;
    holder.tasks = tasks;
    return tasks;
  }, [holder, pages]);
}
