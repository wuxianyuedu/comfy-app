"use client";

// 统一项目 AI 自主执行 run 的共享控制 hook（Phase 6 · P6-3）。
//
// 读当前活跃项目、拉一次 run 状态、run 在跑/待确认时轮询；对外暴露 start / pause / resume /
// approve / cancel 与 goal、审批粒度。放中性的 `components/agent-run/`，画布与工坊两处共用同一
// 个控制条。IO 全走 `~/lib/production/run-client`（视图/hook 不直接碰 vanillaApi，§17）；
// 初始取数用 beginStaleRun 作废守卫（规范 16 §16.2.4.34），卸载即不落地。错误不外抛、以
// `error` 字符串回给控制条就地展示（反馈通道是调用处的选择）。
import { useCallback, useEffect, useState } from "react";

import { useBusyAction } from "~/components/ui/use-busy-action";
import { useInterval } from "~/components/ui/use-interval";
import { runAsyncAction, type ActionReport } from "~/lib/async-action";
import { getActiveId } from "~/lib/project-canvas/canvas-store";
import {
  approveRun,
  cancelRun,
  fetchRunStatus,
  pauseRun,
  type RunSnapshot,
  resumeRun,
  startRun,
} from "~/lib/production/run-client";
import {
  normalizeProductionRun,
  type ApprovalMode,
  type ProductionRun,
  type RunAction,
} from "~/lib/production/run-types";
import { beginStaleRun } from "~/lib/stale-run";

const RUN_POLL_MS = 2500;

export interface AgentRunController {
  projectId: string;
  run: ProductionRun;
  action: RunAction;
  busy: boolean;
  error: string;
  goal: string;
  setGoal: (value: string) => void;
  approvalMode: ApprovalMode;
  setApprovalMode: (value: ApprovalMode) => void;
  start: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  approve: () => Promise<void>;
  cancel: () => Promise<void>;
}

export function useAgentRun(): AgentRunController {
  const [projectId] = useState<string>(() => getActiveId() ?? "");
  const [run, setRun] = useState<ProductionRun>(() =>
    normalizeProductionRun(null),
  );
  const [action, setAction] = useState<RunAction>({ kind: "idle" });
  const busyAction = useBusyAction();
  const [error, setError] = useState("");
  const [goal, setGoal] = useState("");
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("stage");

  const apply = useCallback((snap: RunSnapshot) => {
    setRun(snap.run);
    setAction(snap.action);
  }, []);

  // 挂载拉一次；轮询在 useInterval 里独立驱动。
  useEffect(() => {
    if (!projectId) return;
    const guard = beginStaleRun();
    void (async () => {
      try {
        const snap = await fetchRunStatus(projectId);
        guard.commit(() => apply(snap));
      } catch {
        /* 拉取失败静默：轮询会再补 */
      }
    })();
    return () => guard.dispose();
  }, [projectId, apply]);

  const active = run.status === "running" || run.status === "awaiting_approval";
  useInterval(
    () => {
      if (!projectId) return;
      void fetchRunStatus(projectId)
        .then(apply)
        .catch(() => undefined);
    },
    { ms: active ? RUN_POLL_MS : null, immediate: false },
  );

  const report: ActionReport = useCallback((kind, detail) => {
    if (kind === "err") setError(detail);
  }, []);

  const act = useCallback(
    async (op: (id: string) => Promise<RunSnapshot>) => {
      if (!projectId) {
        setError("当前没有活跃项目");
        return;
      }
      setError("");
      await busyAction.run(() =>
        runAsyncAction(
          async () => {
            apply(await op(projectId));
          },
          { report, failureText: "操作失败", readResultEnvelope: false },
        ),
      );
    },
    [projectId, apply, report, busyAction],
  );

  return {
    projectId,
    run,
    action,
    busy: busyAction.busy,
    error,
    goal,
    setGoal,
    approvalMode,
    setApprovalMode,
    start: () => act((id) => startRun(id, { goal, approvalMode })),
    pause: () => act(pauseRun),
    resume: () => act(resumeRun),
    approve: () => act(approveRun),
    cancel: () => act(cancelRun),
  };
}
