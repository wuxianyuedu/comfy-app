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
  prepareLocalInputImage,
  startLocalGenerate,
  watchTask,
} from "~/lib/workshop/generation-client";
import {
  appendWorkflowRunLog,
  failWorkflowRun,
  patchWorkflowRun,
  registerWorkflowRun,
} from "~/lib/workflow/workflow-run-store";
import type { WorkshopExposedValues } from "~/lib/workshop/workflow-encapsulation";

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
  /** 跑一次流程测试（已跑/未就绪时为空操作）。
   *
   *  收的是**工坊对外值**本身：表单摆出来的口就是契约口清单，值直接交给
   *  `buildLibraryWorkflowInput` 落点，中间不再有「只认提示词 / 负向 / 尺寸」
   *  的第二份字段白名单（那份白名单会让表单多出的口静默丢掉）。 */
  run: (values: WorkshopExposedValues) => void;
  /** 把用户选的本地图片送进 ComfyUI 输入目录，返回可直接落进工作流的文件名。
   *  读文件与上传都在这一层（§17.2 第②层），视图只拿结果字符串。 */
  uploadImage: (file: File) => Promise<string>;
}

/** 本地文件 → data URL（ComfyUI 输入目录的准备接口认这一种来源）。 */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      resolve(typeof result === "string" ? result : "");
    };
    reader.onerror = () => reject(new Error("读取本地图片失败"));
    reader.readAsDataURL(file);
  });
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
          /* 按**当前选中的模式**组载荷：封装页签可以逐个模式跑一次流程测试
           *  （多模式工作流的两个模式契约口往往不同，只测默认模式验不全）。 */
          const { input } = await buildLibraryWorkflowInput(
            workflowId,
            values,
            mode ?? null,
          );
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

  const uploadImage = useCallback(async (file: File) => {
    const dataUrl = await readAsDataUrl(file);
    if (!dataUrl) throw new Error("读取本地图片失败");
    return prepareLocalInputImage(dataUrl);
  }, []);

  return useMemo(
    () => ({
      running,
      progress,
      error,
      resultUrl,
      taskId,
      run,
      uploadImage,
    }),
    [running, progress, error, resultUrl, taskId, run, uploadImage],
  );
}
