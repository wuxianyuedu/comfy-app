"use client";

/* ── 工坊封装页签的「流程测试」运行编排（规范 §17.2 第②层）─────────────
 *
 * 「画布节点」页签的「▶ 用此工作流生成」与「工坊封装」页签的「执行流程测试」
 * 是同一份封装口径下的两次运行：同一个 ComfyUI 链路（generate.generate →
 * SSE）、同一个运行登记表（`workflow-run-store`）、同一个全屏日志弹窗。
 *
 * 此前流程测试把运行态与日志放在组件 useState 里：切页签（组件卸载）即丢，
 * 且它**不进**运行登记表 —— 于是两个页签看上去各占一个「执行视角」，一边在跑，
 * 另一边点了像「执行不了」（ISSUE #611）。
 *
 * 本 hook 把流程测试接进共享运行态：登记（registerWorkflowRun）→ 累积日志
 * （appendWorkflowRunLog）→ 终态（patchWorkflowRun / failWorkflowRun）。
 * 视图只消费 controller，不碰网络。
 *
 * 与画布节点那次运行的**唯一差别**是 `source` 标记与「按封装口径组载荷」
 * （提示词 + 负向 + 尺寸，`buildLibraryWorkflowInput`）—— 两个入口本来就是
 * 同一个动作的两种触发方式，不该有两套运行态。 */

import { useCallback, useMemo, useRef, useState } from "react";

import {
  buildLibraryWorkflowInput,
  startLocalGenerate,
  watchTask,
} from "~/lib/workshop/generation-client";
import {
  appendWorkflowRunLog,
  failWorkflowRun,
  patchWorkflowRun,
  registerWorkflowRun,
} from "~/lib/workflow-run-store";
import type { SizeSpec } from "~/lib/size-presets";

export interface EncapsulationTestRunArgs {
  workflowId: string;
  /** 展示名（工坊下拉 / 徽标用的那个）。 */
  workflowName: string;
  /** 生效模式码（登记与日志标注用；缺省 null）。 */
  mode?: string | null;
}

export interface EncapsulationTestRunController {
  /** 本页签是否正在跑一次流程测试。 */
  running: boolean;
  /** 0–100（无进度帧时为 0）。 */
  progress: number;
  /** 失败原因（每次都重置）。 */
  error: string;
  /** 最近一次运行的产物 URL（成功时）。 */
  resultUrl: string | null;
  /** 最近一次登记的 taskId（日志弹窗按它定位）。 */
  taskId: string | null;
  /** 跑一次流程测试（已跑/未就绪时为空操作）。 */
  run: (values: {
    prompt?: string;
    negativePrompt?: string;
    size?: SizeSpec;
  }) => void;
}

/** 流程测试的运行编排：登记进共享运行态 + 订阅 SSE。 */
export function useEncapsulationTestRun({
  workflowId,
  workflowName,
  mode,
}: EncapsulationTestRunArgs): EncapsulationTestRunController {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  /* 重入闸门放 ref：`run` 在异步回调里判定时 state 还停在旧值。 */
  const runningRef = useRef(false);

  const run = useCallback<EncapsulationTestRunController["run"]>(
    (values) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setRunning(true);
      setProgress(0);
      setError("");
      setResultUrl(null);
      void (async () => {
        try {
          const { input } = await buildLibraryWorkflowInput(workflowId, values);
          const id = await startLocalGenerate(input);
          setTaskId(id);
          /* 登记进共享运行登记表：日志弹窗（两个页签共用同一扇门）按 taskId
           *  找到它，切页签 / 关弹窗都不丢。 */
          registerWorkflowRun({
            taskId: id,
            workflowId,
            workflowName,
            taskType: mode ?? "",
            startedAt: Date.now(),
            status: "running",
            source: "encapsulation-test",
          });
          await new Promise<void>((resolve) => {
            watchTask(id, {
              onProgress: (pct) => setProgress(pct),
              onLog: (entry) => {
                appendWorkflowRunLog(id, entry);
              },
              onOutput: (output) => {
                if (output.kind === "video") return;
                setResultUrl(output.url);
                patchWorkflowRun(id, { resultUrl: output.url });
              },
              onSettled: (result) => {
                if (result.ok) {
                  patchWorkflowRun(id, { status: "done" });
                } else {
                  const reason = result.message ?? "流程测试失败";
                  setError(reason);
                  failWorkflowRun(id, reason);
                }
                resolve();
              },
            });
          });
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          setError(reason);
          /* 提交阶段就失败（还没拿到 taskId）：没有可收口的运行记录，
           *  只落本页签的可见出口。 */
        } finally {
          runningRef.current = false;
          setRunning(false);
        }
      })();
    },
    [workflowId, workflowName, mode],
  );

  return useMemo(
    () => ({ running, progress, error, resultUrl, taskId, run }),
    [running, progress, error, resultUrl, taskId, run],
  );
}
