"use client";

/**
 * 全局执行日志面板关注的 "当前任务" 状态。
 *
 * 节点卡片自身仍负责运行按钮与状态渲染；本模块只解决「全局日志面板该看哪个
 * task」的问题。用模块级变量 + useSyncExternalStore，避免把 taskId 通过 React Flow
 * 边界层层传递。
 *
 * 同时维护 taskId → nodeId 的映射，让日志面板的任务选择器能按画布节点短序号
 * (#1, #2…) 展示，而不是让用户辨认工作流名或 taskId。
 */

import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let activeTaskId: string | null = null;
const taskNodeMap = new Map<string, string>();

export function setActiveTaskId(id: string | null, nodeId?: string): void {
  if (activeTaskId === id && (!id || !nodeId || taskNodeMap.get(id) === nodeId))
    return;
  activeTaskId = id;
  if (id && nodeId) {
    taskNodeMap.set(id, nodeId);
  }
  for (const l of listeners) l();
}

export function getActiveTaskId(): string | null {
  return activeTaskId;
}

/** 查询某个 taskId 是由哪个画布节点触发的。 */
export function getNodeIdByTaskId(
  taskId: string | null | undefined,
): string | null {
  if (!taskId) return null;
  return taskNodeMap.get(taskId) ?? null;
}

/** 手动删除 taskId → nodeId 的映射（例如任务被清理时）。 */
export function clearTaskNodeMapping(taskId: string | null | undefined): void {
  if (!taskId) return;
  taskNodeMap.delete(taskId);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): string | null {
  return activeTaskId;
}

export function useActiveTaskId(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
