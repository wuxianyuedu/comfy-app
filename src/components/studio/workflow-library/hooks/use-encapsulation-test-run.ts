"use client";

/* ── 工坊封装页签的「流程测试」运行编排（规范 §17.2 第②层）──
 * 与「画布节点」的「▶ 用此工作流生成」是同一条 ComfyUI 链路、同一份
 * `workflow-run-store`、同一个全屏日志弹窗。此前流程测试把状态放在组件 useState 里
 * （切页签即丢、也不进登记表），两个页签像各占一个执行视角（ISSUE #611）。本 hook
 * 接进共享运行态：登记 → 累积日志 → 终态；差别只有 `source` 标记与载荷组装。 */

import { useCallback, useMemo, useState } from "react";
import { runAsyncAction } from "~/lib/async-action";
import { useThrottledProgress } from "~/components/ui/use-throttled-progress";
import { useReentrancyLock } from "~/components/ui/use-reentrancy-lock";

import {
  buildLibraryWorkflowInput,
  prepareLocalInputImage,
  startLocalGenerate,
} from "~/lib/workshop/generation-client";
import { appendWorkflowRunLog, registerWorkflowRun } from "~/lib/workflow/workflow-run-store";
import { useWorkflowRunResume, watchWorkflowRun } from "./use-workflow-run-resume";
import { readFileAsDataUrl } from "~/lib/file-io";
import type { WorkshopExposedValues } from "~/lib/workshop/workflow-encapsulation";

export type EncapsulationTestRunArgs = {
  /** 该模式**生效的契约口清单**（含作者自定义的口）。
   *
   *  组载荷要按它认口：不传就等于只认内置契约，作者给自定义口填的值落不下去
   *  （会进 `unmatched`，不静默丢）。调用方请用 memo 稳住引用。 */
  contractIds?: ReadonlyArray<string>;
  /** 生效模式码（登记与日志标注用；缺省 null）。 */
  mode?: string | null;
  workflowId: string;
  /** 展示名（工坊下拉 / 徽标用的那个）。 */
  workflowName: string;
};

export type EncapsulationTestRunController = {
  /** 失败原因（每次都重置）。 */
  error: string;
  /** 0–100（无进度帧时为 0）。 */
  progress: number;
  /** 最近一次运行的产物 URL（成功时）。 */
  resultUrl: string | null;
  /** 跑一次流程测试（已跑/未就绪时为空操作）。
   *
   *  收的是**工坊对外值**本身：表单摆出来的口就是契约口清单，值直接交给
   *  `buildLibraryWorkflowInput` 落点，中间不再有「只认提示词 / 负向 / 尺寸」
   *  的第二份字段白名单（那份白名单会让表单多出的口静默丢掉）。 */
  run: (values: WorkshopExposedValues) => void;
  /** 本页签是否正在跑一次流程测试。 */
  running: boolean;
  /** 最近一次登记的 taskId（日志弹窗按它定位）。 */
  taskId: string | null;
  /** 把用户选的本地图片送进 ComfyUI 输入目录，返回可直接落进工作流的文件名。
   *  读文件与上传都在这一层（§17.2 第②层），视图只拿结果字符串。 */
  uploadImage: (file: File) => Promise<string>;
};

/** 流程测试的运行编排：登记进共享运行态 + 订阅 SSE。 */
export function useEncapsulationTestRun({
  workflowId,
  workflowName,
  mode,
  contractIds,
}: EncapsulationTestRunArgs): EncapsulationTestRunController {
  const [running, setRunning] = useState(false);
  /* 进度是**单值**（一次只跑一个流程测试）—— 节流、同值短路与卸载守卫
   * 都收在出口里（规范 16 §16.2.4.68）。 */
  const {
    value: progress,
    report: reportProgress,
    flush: flushProgress,
    reset: resetProgress,
  } = useThrottledProgress(0);
  const [error, setError] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  /* 重入闸门走唯一出口（规范 16 §16.2.4.69）——同步可见，`run` 在异步回调里
   * 判定时 state 还停在旧值，读它判不出重入。 */
  const lock = useReentrancyLock();

  /* 切页签回来（`ui/tabs` 的 Panel 卸载后重新挂载）时恢复这次运行的视角：
   * 还在跑就回到「测试中」并重订阅，已完成直接恢复产物，已失败恢复原因。
   * 取的是本工作流最近一次**流程测试**（不按模式细分 —— 逐模式测试是连续
   * 动作，最近一次就是用户刚才那次）。 */
  useWorkflowRunResume({
    workflowId,
    source: "encapsulation-test",
    handlers: {
      onProgress: (taskId, pct) => {
        /* 重入闸门也要跟着恢复：否则「恢复成生成中」之后点按钮会再发一次。 */
        lock.tryEnter();
        setTaskId(taskId);
        setRunning(true);
        reportProgress(pct);
      },
      onLog: (taskId, entry) => {
        appendWorkflowRunLog(taskId, entry);
      },
      onOutput: (taskId, output) => {
        setTaskId(taskId);
        if (output.kind === "video") {
          return;
        }
        setResultUrl(output.url);
      },
      onSettled: (taskId, result) => {
        lock.exit();
        setTaskId(taskId);
        setRunning(false);
        if (!result.ok) {
          setError(result.message ?? "流程测试失败");
        }
      },
    },
  });

  const run = useCallback<EncapsulationTestRunController["run"]>(
    (values) => {
      if (!lock.tryEnter()) {
        return;
      }
      setRunning(true);
      resetProgress();
      setError("");
      setResultUrl(null);
      void (async () => {
        /* 外层只兜「提交阶段抛错」（还没拿到 taskId）→ 走 runAsyncAction 的失败出口
         * setError；运行终态由 watchWorkflowRun 的 onSettled 落 setError，故
         * readResultEnvelope:false、成功静默。重入闸门与忙碌位归调用处，收尾在 await
         * 之后（两道都要用 catch 之后的 `lock`）；runAsyncAction 不向外抛错，收尾不会
         * 被异常跳过。 */
        await runAsyncAction(
          async () => {
            /* 按**当前选中的模式**组载荷：封装页签可以逐个模式跑一次流程测试
             *  （多模式工作流的两个模式契约口往往不同，只测默认模式验不全）。 */
            const { input } = await buildLibraryWorkflowInput(
              workflowId,
              values,
              mode ?? null,
              contractIds,
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
              /* 订阅走 `watchWorkflowRun`（与恢复路径同一份）：它顺手把进度 /
               * 产物 / 终态写进运行登记表 —— 切到「画布节点」页签再切回来时，
               * 这一页的运行视角才不会清零。 */
              watchWorkflowRun(id, {
                onProgress: (_taskId, pct) => {
                  reportProgress(pct);
                },
                onLog: (taskId, entry) => {
                  appendWorkflowRunLog(taskId, entry);
                },
                onOutput: (_taskId, output) => {
                  /* 视频产物不进「生成一张图」那个结果位。 */
                  if (output.kind === "video") {
                    return;
                  }
                  setResultUrl(output.url);
                },
                onSettled: (_taskId, result) => {
                  /* 落定写终值：节流窗口会在边界上吃掉最后一次读数。 */
                  flushProgress(result.ok ? 100 : 0);
                  if (!result.ok) {
                    setError(result.message ?? "流程测试失败");
                  }
                  resolve();
                },
              });
            });
          },
          {
            report: (kind, detail) => {
              if (kind === "err") {
                setError(detail);
              }
            },
            failureText: "流程测试失败",
            readResultEnvelope: false,
          },
        );
        lock.exit();
        setRunning(false);
      })();
    },
    [
      lock,
      workflowId,
      workflowName,
      mode,
      contractIds,
      reportProgress,
      flushProgress,
      resetProgress,
    ],
  );

  const uploadImage = useCallback(async (file: File) => {
    /* 「读到空值算失败」收在 `readFileAsDataUrl` 里（§16.2.4.27）——
     * 此前这里要在调用点再补一次 `if (!dataUrl) throw`，而同一件事的另一处
     * 落点没有补、把空串直接发给了上传接口。 */
    return prepareLocalInputImage(await readFileAsDataUrl(file));
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
