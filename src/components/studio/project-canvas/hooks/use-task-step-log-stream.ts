"use client";

/**
 * useTaskStepLogStream —— 监听单个任务的执行步骤日志流（SSE）。
 *
 * 为什么是独立 hook（规范 17 / 硬规则 10）：`new EventSource(...)` 是浏览器原生
 * 网络请求，视图 `.tsx` 里不该 hand-manage 一条 SSE 长连接的建连 / 帧解析 / 关流。
 * 此前这段生命周期整块内联在 `GlobalStepLogPanel` 里，同文件别处又把网络下沉到
 * `~/lib/task-cancel-client`（视图零 IO），唯独这条流没遵循。收进本 hook 后，
 * 面板只消费 `{ logs, status, progress, error, validationErrors, connected }` 与
 * `setError` / `clear`，不再碰网络。
 *
 * 一并托管三件与「看这一条流」不可分的事：
 *   · 换任务时从跨卸载缓存播种（`loadStepLogPanelState`）；
 *   · SSE 帧解析（log / state / 终态），终态帧只作触发器、去向 DB 要权威结论（#733）；
 *   · 20s 无活动的「卡住」提示（读连接活动时间戳）——它依赖 SSE 更新的活动时刻，
 *     与连接同源，拆开放反而要跨边界传 ref。
 */
import { useEffect, useRef, useState } from "react";
import { useInterval } from "~/components/ui/use-interval";
import { tailWindow } from "~/lib/page-window";
import type { ValidationError } from "~/lib/comfyui/validation";
import { isTerminalFailureTaskStatus } from "~/lib/task-state";
import { fetchTaskStatus } from "~/lib/task-cancel-client";
import { getNodeIdByTaskId } from "../activeTask";
import type { StepLogEntry } from "../stepLogCache";
import {
  appendStepLog,
  clearStepLogPanelState,
  loadStepLogPanelState,
  MAX_LOGS_PER_TASK,
  patchStepLogMeta,
  setStepLogValidationErrors,
} from "../stepLogCache";

/** `/api/tasks/[id]/stream` 的 SSE 帧的运行时形状 —— 只含本面板消费的字段。
 *  `JSON.parse` 产出 `unknown`；下面逐个收窄字段后再用。 */
interface SseFrame {
  type?: unknown;
  entry?: unknown;
  validationErrors?: unknown;
  status?: unknown;
  progress?: unknown;
  error?: unknown;
  workflowName?: unknown;
}

/** 把失败原因补成一条 error 日志行（横幅之外，时间线里也看得见，#378）。
 *  纯函数 + 显式 next：去重在 updater 之外完成，避免在 setState updater 里做副作用
 *  （StrictMode 下 updater 可能被调用两次）。 */
function withFailureLogLine(
  prev: StepLogEntry[],
  reason: string,
  now: number,
): StepLogEntry[] {
  if (!reason) return prev;
  const text = `✗ 生成失败：${reason}`;
  const last = prev[prev.length - 1];
  /* 末行已是同因错误（服务端自己写过 ✗ 生成失败）→ 不重复追加。 */
  if (
    last?.level === "error" &&
    typeof last.msg === "string" &&
    last.msg.includes(reason)
  ) {
    return prev;
  }
  return [...prev, { t: now, level: "error", msg: text, client: true }];
}

/** 把上面那条日志行同时写进（跨卸载存活的）缓存与 state。 */
function appendFailureLogLine(
  taskId: string,
  reason: string,
  setLogs: React.Dispatch<React.SetStateAction<StepLogEntry[]>>,
): void {
  const t = Date.now();
  appendStepLog(taskId, {
    t,
    level: "error",
    msg: `✗ 生成失败：${reason}`,
    client: true,
  });
  setLogs((prev) => withFailureLogLine(prev, reason, t));
}

export interface TaskStepLogStream {
  logs: StepLogEntry[];
  validationErrors: ValidationError[] | null;
  status: string | null;
  progress: number;
  error: string | null;
  connected: boolean;
  /** 供外部（如取消任务失败回调）写入错误横幅文案。 */
  setError: (value: string | null) => void;
  /** 清空当前任务的日志（连带跨卸载缓存）。 */
  clear: () => void;
}

export function useTaskStepLogStream(taskId: string | null): TaskStepLogStream {
  const [logs, setLogs] = useState<StepLogEntry[]>([]);
  const [validationErrors, setValidationErrors] = useState<
    ValidationError[] | null
  >(null);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const esRef = useRef<EventSource | null>(null);
  const lastStatusRef = useRef<string | null>(null);
  // 初值 0：真实活动时间戳由各 effect（播种 / onopen / onmessage）写入，
  // 渲染期不调 Date.now()（React Compiler：useRef 初值每次渲染都会求值）。
  const lastActivityRef = useRef<number>(0);
  const loadedForRef = useRef<string | null>(null);

  // 被查看任务一变化就重新从缓存播种。
  useEffect(() => {
    if (!taskId) return;
    if (loadedForRef.current !== taskId) {
      loadedForRef.current = taskId;
      const cached = loadStepLogPanelState(taskId);
      setLogs(cached?.logs ?? []);
      setValidationErrors(cached?.validationErrors ?? null);
      setStatus(null);
      setProgress(0);
      setError(null);
      lastStatusRef.current = null;
      lastActivityRef.current = Date.now();
    }
  }, [taskId]);

  // 订阅该任务的 SSE 流。
  useEffect(() => {
    if (!taskId) {
      esRef.current?.close();
      esRef.current = null;
      // 与「无任务 → 连接已关」这一外部系统事实同步（非渲染级联）：
      // 关掉上一条 EventSource 后把连接指示复位。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConnected(false);
      return;
    }
    const tid = taskId;
    lastActivityRef.current = Date.now();

    const es = new EventSource(`/api/tasks/${tid}/stream`);
    esRef.current = es;
    setConnected(false);
    es.onopen = () => {
      setConnected(true);
      lastActivityRef.current = Date.now();
    };
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as SseFrame;
        lastActivityRef.current = Date.now();
        if (msg.type === "log" && msg.entry) {
          const entry = msg.entry as StepLogEntry;
          appendStepLog(tid, entry);
          setLogs((prev) => {
            if (
              prev.some((prev) => prev.t === entry.t && prev.msg === entry.msg)
            )
              return prev;
            return tailWindow([...prev, entry], MAX_LOGS_PER_TASK);
          });
        } else if (msg.type === "state") {
          if (Array.isArray(msg.validationErrors)) {
            const ves = msg.validationErrors as ValidationError[];
            setStepLogValidationErrors(tid, ves);
            setValidationErrors(ves);
          }
          if (typeof msg.status === "string" && msg.status) {
            const st = String(msg.status);
            const pct = Number(msg.progress ?? 0);
            if (lastStatusRef.current !== st) lastStatusRef.current = st;
            setStatus(st);
            if (Number.isFinite(pct)) setProgress(pct);
            if (typeof msg.error === "string") {
              setError(msg.error);
              /* 失败原因同时补一条 error 日志行：横幅只在顶部显示，用户
               * 按「错误 / 警告」筛选或回放时间线时看不到它（ISSUE #378）。 */
              if (st === "FAILED" || st === "ERROR" || st === "CANCELLED") {
                appendFailureLogLine(tid, msg.error, setLogs);
              }
            }
          }
          if (msg.workflowName || msg.status) {
            patchStepLogMeta(tid, {
              workflowName:
                typeof msg.workflowName === "string"
                  ? msg.workflowName
                  : undefined,
              status: typeof msg.status === "string" ? msg.status : undefined,
              nodeId: getNodeIdByTaskId(tid) ?? undefined,
            });
          }
        } else if (msg.type === "done" || msg.type === "error") {
          /* 终态帧**不能直接下结论**。
           *
           * 现场（ISSUE #733）：任务被后端判终态（如 CANCELLED）后，迟到的
           * 「完成」帧仍可能到达；旧实现把它当权威，直接显示「完成」并关流，
           * 用户看到的是一个已经死掉的任务显示成功。反过来，帧里没有
           * `status` 字段时旧实现还会把它落成 FAILED —— 成功也被显示成失败。
           *
           * 因此这里改为：终态帧只作为**触发器**，去向 DB 要权威结论；DB
           * 读不到时才退回帧内信息。 */
          const fallback = msg.type === "error" ? "FAILED" : "SUCCEEDED";
          if (typeof msg.error === "string") setError(msg.error);
          es.close();
          esRef.current = null;
          void (async () => {
            /* 网络层收在 `~/lib/task-cancel-client`（视图零 IO，规范 17）。 */
            const snap = await fetchTaskStatus(tid);
            const finalStatus = snap.status;
            const finalError = snap.error;
            const st = finalStatus ?? fallback;
            if (lastStatusRef.current !== st) lastStatusRef.current = st;
            setStatus(st);
            const reason =
              finalError ?? (typeof msg.error === "string" ? msg.error : null);
            if (reason && isTerminalFailureTaskStatus(st)) {
              setError(reason);
              appendFailureLogLine(tid, reason, setLogs);
            } else if (reason) {
              setError(reason);
            }
          })();
        }
      } catch {
        /* SSE 帧格式错误 —— 忽略 */
      }
    };
    es.onerror = () => {
      setConnected(false);
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [taskId]);

  /* 20 秒无活动的「卡住」提示：每 10s 检查一次（规范 16 §16.2.4.15）。
   * `useInterval` 把回调放 ref，所以 `status` / `setLogs` 都是新鲜的；
   * `ms: taskId ? 10000 : null` 等价于原来「没有 taskId 就不起定时器」。 */
  useInterval(
    () => {
      const idle = Date.now() - lastActivityRef.current;
      if (idle > 20000 && status === "RUNNING") {
        const now = Date.now();
        setLogs((prev) => {
          const last = prev[prev.length - 1];
          if (
            last &&
            typeof last.msg === "string" &&
            last.msg.includes("无新日志") &&
            now - last.t < 5000
          )
            return prev;
          return tailWindow(
            [
              ...prev,
              {
                t: now,
                level: "warn",
                msg: "⏳ 已 20s 无新日志，任务可能卡住（详见后端 runner 日志）",
              },
            ],
            MAX_LOGS_PER_TASK,
          );
        });
        lastActivityRef.current = now;
      }
    },
    { ms: taskId ? 10000 : null, immediate: false },
  );

  const clear = () => {
    if (taskId) clearStepLogPanelState(taskId);
    setLogs([]);
    setValidationErrors(null);
    setStatus(null);
    setProgress(0);
    setError(null);
    loadedForRef.current = null;
  };

  return {
    logs,
    validationErrors,
    status,
    progress,
    error,
    connected,
    setError,
    clear,
  };
}
