"use client";

// ── 队列页「执行日志」弹窗的数据源（第②层，视图零 IO）──────────────────
//
// 包一层 `watchTask`（`~/lib/workshop/generation-client` 的 SSE 订阅）：打开即
// 订阅 `/api/tasks/:id/stream`，服务端先回放全量历史（内存 → DB `task.logs`），
// 再按 3s 增量推送 —— 所以对**任何** taskId 都成立：在跑的实时跟，排队的看着
// 它开跑，已结束的历史任务打开就能回放完整日志。
//
// 为什么不让视图自己订阅：§17 UI/逻辑分离 —— 网络与生命周期收在 hook，
// 视图只收 { logs, settled, started } 渲染。
//
// 与 workflow-run-store 的关系：那套 store 按 workflowId 登记「画布节点 / 工坊
// 封装」两条链路的运行，队列页的任务不在登记表里（也拿不到 workflowId）；
// 这里走 taskId 直连，日志只在本弹窗生命周期内累积，不写穿 localStorage。

import { useEffect, useRef, useState } from "react";

import { watchTask, type TaskLogEntry } from "~/lib/workshop/generation-client";
import { createThrottleGate } from "~/components/ui/use-throttled-progress";
import { tailWindow } from "~/lib/page-window";

/** 弹窗内存里最多留多少条：与 `LOG_MODAL_MAX_ROWS` 的展示上限同源，
 * 累积侧先截，长任务（几千条 progress 行）也不会把 state 撑大。 */
const STREAM_MAX_LOGS = 300;

export interface TaskLogStreamState {
  /** 已收到的日志（新在后，已按上限截尾）。 */
  logs: TaskLogEntry[];
  /** 终态落定信息；null = 还没落定（排队 / 在跑）。 */
  settled: { ok: boolean; message?: string } | null;
  /** 收到过进度帧吗：排队中的任务开跑后，徽标从「排队中」翻「运行中」用。 */
  started: boolean;
}

export function useTaskLogStream(taskId: string | null): TaskLogStreamState {
  const [logs, setLogs] = useState<TaskLogEntry[]>([]);
  const [settled, setSettled] = useState<{
    ok: boolean;
    message?: string;
  } | null>(null);
  const [started, setStarted] = useState(false);
  /* 换任务（含变 null）在**渲染期**重置（React 19 的渲染期 state 调整范式，
   * §17.6.4）：effect 里同步 setState 会触发级联渲染
   * （react-hooks/set-state-in-effect），而且重置本来就该发生在「看到新 id
   * 的那一帧」，轮不到 effect。 */
  const [prevId, setPrevId] = useState(taskId);
  if (prevId !== taskId) {
    setPrevId(taskId);
    setLogs([]);
    setSettled(null);
    setStarted(false);
  }
  /* 卸载守卫：watchTask 的回调在 closer() 之后仍可能到达（EventSource 关闭是
   * 异步的），setState 前先看这个标记（规范 16 §16.2.4.15 同款）。 */
  const stoppedRef = useRef(false);

  useEffect(() => {
    stoppedRef.current = false;
    if (taskId === null) return;

    /* onProgress 是高频回调（SSE 每帧一次），经节流闸门再落 state ——
     * 出口与窗口收在 `ui/use-throttled-progress`（规范 16 §16.2.4.68）。
     * 这里只用它翻一次「已开跑」的标记，闸门按窗口放行足够。 */
    const progressGate = createThrottleGate();
    const closer = watchTask(taskId, {
      onLog: (entry) => {
        if (stoppedRef.current) return;
        setLogs((prev) => tailWindow([...prev, entry], STREAM_MAX_LOGS));
      },
      onProgress: () => {
        if (stoppedRef.current) return;
        if (!progressGate.allow()) return;
        setStarted(true);
      },
      onSettled: (result) => {
        if (stoppedRef.current) return;
        setSettled(result);
      },
    });
    return () => {
      stoppedRef.current = true;
      /* 主动关闭会打一条「订阅被主动关闭（组件卸载 / 取消），未落定」——
       * 那是 watchTask 的诊断口径，本 hook 不再重复。 */
      closer();
    };
  }, [taskId]);

  return { logs, settled, started };
}
