"use client";

/**
 * 全局执行日志面板关注的「当前任务」状态。节点卡片自身负责运行按钮与状态渲染；本模块只
 * 解决「全局日志面板该看哪个 task」：用模块级变量 + useSyncExternalStore，避免把 taskId
 * 通过 React Flow 边界层层传递。同时维护 taskId → nodeId 映射，让选择器按节点短序号展示。
 */

import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let activeTaskId: string | null = null;
const taskNodeMap = new Map<string, string>();

/** 映射条目上限：桌面应用常驻数天，历史任务 id 只进不出会慢性吃内存（#4007）。
 *  超限按「最久没写过」淘汰——Map 保插入序，重写先删再插即得 LRU 语义
 * （与 `runner-state` 的 `touchAndEvict` 同一形态）。 */
const TASK_NODE_MAP_MAX = 256;

function rememberTaskNode(id: string, nodeId: string): void {
  taskNodeMap.delete(id);
  taskNodeMap.set(id, nodeId);
  if (taskNodeMap.size > TASK_NODE_MAP_MAX) {
    const oldest = taskNodeMap.keys().next().value;
    if (oldest !== undefined) {
      taskNodeMap.delete(oldest);
    }
  }
}

export function setActiveTaskId(id: string | null, nodeId?: string): void {
  if (
    activeTaskId === id &&
    (id === null ||
      id === "" ||
      nodeId === undefined ||
      nodeId === "" ||
      taskNodeMap.get(id) === nodeId)
  ) {
    return;
  }
  activeTaskId = id;
  if (id !== null && id !== "" && nodeId !== undefined && nodeId !== "") {
    rememberTaskNode(id, nodeId);
  }
  for (const l of listeners) {
    l();
  }
}

export function getActiveTaskId(): string | null {
  return activeTaskId;
}

/** 查询某个 taskId 是由哪个画布节点触发的。 */
export function getNodeIdByTaskId(taskId: string | null | undefined): string | null {
  if (taskId === null || taskId === undefined || taskId === "") {
    return null;
  }
  return taskNodeMap.get(taskId) ?? null;
}

/** 手动删除 taskId → nodeId 的映射（例如任务被清理时）。 */
export function clearTaskNodeMapping(taskId: string | null | undefined): void {
  if (taskId === null || taskId === undefined || taskId === "") {
    return;
  }
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
