"use client";

/* ── 「切走再切回来，这次运行还在」的恢复逻辑（两个页签共用一份）──────────
 *
 * 「画布节点」页签的就地运行与「工坊封装」页签的流程测试是同一条链路
 * （`generate.generate` → SSE）、同一个运行登记表（`workflow-run-store`），
 * 差别只有 source 标记。而两个页签是 `ui/tabs` 的两个 Panel —— **切走即卸载**，
 * 组件 useState 里的运行视角（进度 / 产物 / 终态）当场清零。
 *
 * 于是实测现场是：「在画布节点点了生成 → 切到工坊封装 → 再切回来」看到一片
 * 空白；两个同时跑时更明显 —— 一边还在跑、另一边看起来从未运行过，生成的
 * 产物也不知去向。根因不是并发（登记表按 taskId 分开，不会串），而是**只有
 * 「还在跑」那一支被恢复**（且只写在画布节点页签里），done / failed 一律丢。
 *
 * 本模块给两条规则：
 *   · {@link watchWorkflowRun} —— 订阅一次运行的**唯一**入口：进度与终态顺便
 *     写进登记表（这样下一次切页签才有的可恢复），再转交调用方；
 *   · {@link useWorkflowRunResume} —— 挂载时按 (workflowId, source) 把三态都
 *     恢复出来：还在跑就重订阅（服务端回放补齐历史），已完成直接给产物，
 *     已失败直接给原因。
 *
 * 为什么恢复逻辑必须是**一份**：两个页签各写一份的结果就是现在这样 —— 一边
 * 有半套恢复（且只认 running）、一边一套都没有，同一件事在两处的行为不同。 */

import { useEffect, useRef } from "react";

import {
  watchTask,
  type TaskLogEntry,
  type TaskProgressNode,
} from "~/lib/workshop/generation-client";
import type { SavedOutput } from "~/lib/workshop/api-channel-shared";
import {
  failWorkflowRun,
  latestRunForWorkflow,
  patchWorkflowRun,
  type WorkflowRunSource,
} from "~/lib/workflow/workflow-run-store";

/**
 * 一次运行的订阅回调。**第一个参数永远是 taskId**：恢复路径下调用方手里
 * 没有它（那是上一次挂载的事），而日志累积与状态 patch 都要按它落。
 */
export interface WorkflowRunHandlers {
  onProgress: (taskId: string, pct: number, node?: TaskProgressNode) => void;
  onLog: (taskId: string, entry: TaskLogEntry) => void;
  onOutput: (taskId: string, output: SavedOutput) => void;
  onSettled: (
    taskId: string,
    result: { ok: boolean; message?: string },
  ) => void;
}

/**
 * 订阅一次运行的 SSE，并把**进度 / 产物 / 终态**同步进运行登记表。
 *
 * 登记表这一侧此前只在「发起运行」的那几行里零散维护，恢复路径完全没有 ——
 * 于是切页签回来后进度条从 0 开始、产物为空。收在这里之后，发起与恢复两条
 * 路径写的是同一份状态。
 *
 * 返回值是取消订阅的函数（丢给 effect 的 cleanup，切页签即断连接；下次切回
 * 来会重新订阅，历史帧由服务端回放补齐，日志按 `(t, msg)` 去重）。
 */
export function watchWorkflowRun(
  taskId: string,
  handlers: WorkflowRunHandlers,
): () => void {
  return watchTask(taskId, {
    onProgress: (pct, node) => {
      patchWorkflowRun(taskId, { progress: pct });
      handlers.onProgress(taskId, pct, node);
    },
    onLog: (entry) => handlers.onLog(taskId, entry),
    onOutput: (output) => {
      if (output.kind === "image" && output.url) {
        patchWorkflowRun(taskId, { resultUrl: output.url });
      }
      handlers.onOutput(taskId, output);
    },
    onSettled: (result) => {
      /* 失败一律走 `failWorkflowRun`（状态 + 原因 + 一条 error 日志行）：
       * 两条订阅路径若各写一份，就会出现「发起那次有错误日志行、恢复那次没有」。 */
      if (result.ok) patchWorkflowRun(taskId, { status: "done" });
      else failWorkflowRun(taskId, result.message ?? "生成失败");
      handlers.onSettled(taskId, result);
    },
  });
}

export interface UseWorkflowRunResumeArgs {
  workflowId: string;
  /** 恢复哪个入口发起的运行（画布节点 / 工坊封装各自独立）。 */
  source: WorkflowRunSource;
  handlers: WorkflowRunHandlers;
}

/**
 * 挂载时从运行登记表恢复本入口最近一次运行的视角（见文件头）。
 *
 * `handlers` 每次渲染都是新对象，因此经 ref 取最新值 —— 恢复只在
 * (workflowId) 变化时跑一次，不能闭包住首帧的回调。
 */
export function useWorkflowRunResume({
  workflowId,
  source,
  handlers,
}: UseWorkflowRunResumeArgs): void {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const resumedRef = useRef<string | null>(null);
  useEffect(() => {
    if (resumedRef.current === workflowId) return;
    resumedRef.current = workflowId;

    const run = latestRunForWorkflow(workflowId, source);
    if (!run) return;

    /* 恢复路径也要**同步登记表**：done / failed 的恢复不该反过来改写状态，
     * 只有「还在跑」那一支要继续写（进度与终态由 watchWorkflowRun 负责）。 */
    if (run.status === "done") {
      if (run.resultUrl) {
        handlersRef.current.onOutput(run.taskId, {
          url: run.resultUrl,
          kind: "image",
        });
      }
      handlersRef.current.onSettled(run.taskId, { ok: true });
      return;
    }
    if (run.status === "failed") {
      handlersRef.current.onSettled(run.taskId, {
        ok: false,
        message: run.errorMessage,
      });
      return;
    }

    /* 还在跑（或没有终态）：先把最后已知的进度交出去 —— 调用方据此进入
     * 「生成中」视角，而不是等下一个进度帧才知道有这么一次运行。 */
    handlersRef.current.onProgress(run.taskId, run.progress ?? 0);
    return watchWorkflowRun(run.taskId, {
      onProgress: (taskId, pct, node) =>
        handlersRef.current.onProgress(taskId, pct, node),
      onLog: (taskId, entry) => handlersRef.current.onLog(taskId, entry),
      onOutput: (taskId, output) =>
        handlersRef.current.onOutput(taskId, output),
      onSettled: (taskId, result) =>
        handlersRef.current.onSettled(taskId, result),
    });
  }, [workflowId, source]);
}
