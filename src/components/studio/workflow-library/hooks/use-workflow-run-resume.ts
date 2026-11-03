"use client";

/* ── 「切走再切回来，这次运行还在」的恢复逻辑（两个页签共用一份）──
 * 两个页签都是 `ui/tabs` 的 Panel，切走即卸载，组件 useState 里的运行视角清零 ——
 * 现场是切回来一片空白，或一边在跑另一边像从未运行过。根因不是并发（登记表按 taskId
 * 分开），而是只有「还在跑」那一支被恢复。`watchWorkflowRun` 订阅并把进度/终态写入
 * 登记表；`useWorkflowRunResume` 挂载时按 (workflowId, source) 恢复三态，只此一份。 */

import { useEffect, useRef } from "react";
import { createThrottleGate } from "~/components/ui/use-throttled-progress";

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
export type WorkflowRunHandlers = {
  onLog: (taskId: string, entry: TaskLogEntry) => void;
  onOutput: (taskId: string, output: SavedOutput) => void;
  onProgress: (taskId: string, pct: number, node?: TaskProgressNode) => void;
  onSettled: (taskId: string, result: { message?: string; ok: boolean }) => void;
};

/**
 * 订阅一次运行的 SSE，并把**进度 / 产物 / 终态**同步进运行登记表。登记表此前只在
 * 发起路径零散维护，恢复路径完全没有 —— 切页签回来进度从 0 开始、产物为空。收在
 * 这里之后发起与恢复写同一份状态。返回值是取消订阅函数（丢给 effect cleanup；下次切回重新订阅，历史帧由服务端回放，日志按 `(t, msg)` 去重）。
 */
export function watchWorkflowRun(taskId: string, handlers: WorkflowRunHandlers): () => void {
  /* 进度是高频的（SSE 每帧一次），而这里要落 store 的 patch **并且**再转给
   * 调用处的 handlers —— 不节流的话上面两个订阅者都会被刷（规范 16
   * §16.2.4.68）。闸门按 taskId 分，重连后不会与上一轮的窗口混在一起。 */
  const gate = createThrottleGate();
  return watchTask(taskId, {
    onProgress: (pct, node) => {
      if (!gate.allow(taskId)) {
        return;
      }
      patchWorkflowRun(taskId, { progress: pct });
      handlers.onProgress(taskId, pct, node);
    },
    onLog: (entry) => {
      handlers.onLog(taskId, entry);
    },
    onOutput: (output) => {
      if (output.kind === "image" && output.url) {
        patchWorkflowRun(taskId, { resultUrl: output.url });
      }
      handlers.onOutput(taskId, output);
    },
    onSettled: (result) => {
      /* 终值必须落进去：节流窗口会在边界上吃掉最后一次读数。 */
      gate.reset(taskId);
      /* 失败一律走 `failWorkflowRun`（状态 + 原因 + 一条 error 日志行）：
       * 两条订阅路径若各写一份，就会出现「发起那次有错误日志行、恢复那次没有」。 */
      if (result.ok) {
        patchWorkflowRun(taskId, { status: "done" });
      } else {
        failWorkflowRun(taskId, result.message ?? "生成失败");
      }
      handlers.onSettled(taskId, result);
    },
  });
}

export type UseWorkflowRunResumeArgs = {
  handlers: WorkflowRunHandlers;
  /** 恢复哪个入口发起的运行（画布节点 / 工坊封装各自独立）。 */
  source: WorkflowRunSource;
  workflowId: string;
};

/**
 * 挂载时从运行登记表恢复本入口最近一次运行的视角（见文件头）。
 * `handlers` 每次渲染都是新对象，因此经 ref 取最新值 —— 恢复只在 (workflowId)
 * 变化时跑一次，不能闭包住首帧的回调。
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
    if (resumedRef.current === workflowId) {
      return;
    }
    resumedRef.current = workflowId;

    const run = latestRunForWorkflow(workflowId, source);
    if (!run) {
      return;
    }

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
      onProgress: (taskId, pct, node) => {
        handlersRef.current.onProgress(taskId, pct, node);
      },
      onLog: (taskId, entry) => {
        handlersRef.current.onLog(taskId, entry);
      },
      onOutput: (taskId, output) => {
        handlersRef.current.onOutput(taskId, output);
      },
      onSettled: (taskId, result) => {
        handlersRef.current.onSettled(taskId, result);
      },
    });
  }, [workflowId, source]);
}
