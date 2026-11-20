// ── 「测试模型能力」本地工作流通道（#4080 评论 4）──────────────────────────
// 工作流提供的图片/视频模型（工作流库条目）也进测试页：选中后不走 API 中继，
// 而是走**工坊同款本地通道**（buildLibraryWorkflowInput 封装 → generate.generate
// 入队 → SSE 观察任务流）。本模块只放这一次测试的执行编排（无 React 状态）；
// 表单状态与候选派生仍在 use-model-test（第②层）。
// 与工坊生成（use-workshop-generation / VideoStudio）的分工：那边把结果回写
// 镜头/草稿，这里把结果交给测试页的产物区 —— 封装、上传、观察、取消的口径
// 全部复用同一批既有出口，不另写第二套。

import {
  buildLibraryWorkflowInput,
  cancelLocalTask,
  LOCAL_TASK_TIMEOUT_MS,
  prepareLocalInputImage,
  startLocalGenerate,
  watchTask,
  type RelayDebugSink,
  type TaskLogEntry,
  type WorkshopWorkflowOption,
} from "~/lib/workshop/generation-client";
import { debugBodyOf, type ApiCallDebugRow } from "~/lib/workshop/api-channel-core";
import { isWantedOutput } from "~/lib/workshop/output-filter";
import { sceneFromMode } from "~/lib/media/size-presets";
import {
  pruneEmptyExposedValues,
  describeUnmatchedInputs,
  type WorkshopExposedValues,
} from "~/lib/workshop/workflow-encapsulation";
import { withTimeoutResult } from "~/lib/with-timeout";

import {
  numericValue,
  seedValue,
  sizeValuesToSpec,
  workflowSupportsMode,
  type ModelTestValues,
} from "../model-test-config";

/** 一次本地工作流测试的产物（与测试页既有产物形状对齐：图片 / 视频 URL）。 */
export type WorkflowTestResult = { kind: "image" | "video"; url: string };

/** 参考图 / 首帧都是 data URL，本地通道的图片口吃**已上传文件名** —— 逐张经
 *  prepareLocalInputImage 传进 ComfyUI 输入目录（与定妆照参考图同一通道）。
 *  单张失败不拖垮整次生成：跳过并计数，由调用方决定是否提示（规范 10 §10.3.1）。 */
async function uploadToLocalInputs(
  targets: ReadonlyArray<string>,
  signal: AbortSignal,
): Promise<{ failedCount: number; files: Array<string> }> {
  const files: Array<string> = [];
  let failedCount = 0;
  for (const url of targets) {
    if (signal.aborted) {
      throw new Error("已取消生成");
    }
    try {
      // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：逐张上传，失败不拖垮整批
      const filename = await prepareLocalInputImage(url);
      files.push(filename);
    } catch {
      failedCount += 1;
    }
  }
  return { failedCount, files };
}

/** 跑一次「工作流提供能力的图片/视频模型」测试（工坊本地 ComfyUI 通道）。
 *
 *  失败一律抛错（由调用方 runAsyncAction 落到错误条）；取消经 `signal`
 *  传播到 SSE 订阅与任务本身（cancelLocalTask），与点生成那侧的
 *  cancelGenerate（#3949 需求 5）同一句柄。 */
export async function runWorkflowModelTest(args: {
  /** 当前模式**生效的契约口清单**（ModeContract.inputs）：作者自定义口要真的
   *  落下去必须传（见 buildLibraryWorkflowInput 的 contractIds）。 */
  contractIds?: ReadonlyArray<string>;
  /** 视频首帧（data URL；图片用途不需要）。 */
  firstFrameDataUrl?: string;
  kind: "image" | "video";
  mode: string;
  onDebug: RelayDebugSink;
  /** 本地任务的执行日志（SSE log 帧）：测试页的「执行日志」区块消费。 */
  onLog?: (entry: TaskLogEntry) => void;
  /** 「给了值却没落进端口」这类提示（unmatched 翻译）与上传失败计数的出口。 */
  onNotice?: (text: string) => void;
  /** 任务进度（SSE state 帧；整百分比变化才上报，避免逐帧重渲）。 */
  onProgress?: (progress: { label?: string; pct: number }) => void;
  /** 本地提交行（封装算出的 workflowInputs 落点清单）：发起前先上抛给
   *  请求详情的「本地提交」行（#4080 评论 8 / 评论 13）。 */
  onSubmissionRow?: (row: ApiCallDebugRow) => void;
  /** 参考图组（data URL，已按「多张参考图，否则单图行」归并）。 */
  referenceImages: ReadonlyArray<string>;
  signal: AbortSignal;
  values: ModelTestValues;
  workflow: WorkshopWorkflowOption;
}): Promise<WorkflowTestResult> {
  const { kind, mode, signal, values, workflow } = args;
  /* 未封装的工作流驱动不起来（提示词口没有落点）：入口就拦，别等任务失败。 */
  if (!workflow.encapsulationReady) {
    throw new Error(
      "该工作流还没有完成工坊封装（对外参数未连线）—— 先到工作流库的「工坊封装」把提示词口连上，再回来测试",
    );
  }
  if (!workflowSupportsMode(workflow, mode)) {
    throw new Error(
      `该工作流不支持 ${mode} 模式（可跑：${
        [...workflow.modes, workflow.taskType ?? ""]
          .filter((m, i, arr) => m !== "" && arr.indexOf(m) === i)
          .join("、") || "未声明"
      }）`,
    );
  }

  /* 统一输入 → 本地通道对外值。图片口吃文件名：参考图组与首帧先上传。
   * 尺寸只在图片场景下发（视频工作流的尺寸口由工作流图内默认值承担，与
   * VideoStudio 同口径）；时长按秒给（落在作者连的时长口上）。 */
  const refs = args.referenceImages.map((s) => s.trim()).filter((s) => s !== "");
  const firstFrame = args.firstFrameDataUrl?.trim() ?? "";
  const uploadedRefs = await uploadToLocalInputs(refs, signal);
  const uploadedFirstFrame =
    firstFrame === ""
      ? { failedCount: 0, files: [] as Array<string> }
      : await uploadToLocalInputs([firstFrame], signal);
  const uploadFailed = uploadedRefs.failedCount + uploadedFirstFrame.failedCount;
  if (uploadFailed > 0) {
    args.onNotice?.(`${String(uploadFailed)} 张参考图上传失败，本次生成未使用它们`);
  }
  const exposed: WorkshopExposedValues = pruneEmptyExposedValues({
    prompt: values.prompt?.trim(),
    negativePrompt: values.negative?.trim(),
    ...(sceneFromMode(mode) === "image" ? { size: sizeValuesToSpec(values) } : {}),
    ...(uploadedRefs.files.length > 0 ? { referenceImages: uploadedRefs.files } : {}),
    ...(uploadedFirstFrame.files[0] === undefined
      ? {}
      : { firstFrame: uploadedFirstFrame.files[0] }),
    ...(kind === "video" && numericValue(values.duration) !== undefined
      ? { duration: numericValue(values.duration) }
      : {}),
    ...(seedValue(values.seed) === undefined ? {} : { seed: seedValue(values.seed) }),
  });

  const built = await buildLibraryWorkflowInput(workflow.id, exposed, mode, args.contractIds);
  const unmatchedWarning = describeUnmatchedInputs(built.unmatched);
  if (unmatchedWarning !== null && unmatchedWarning !== "") {
    args.onNotice?.(unmatchedWarning);
  }

  const startedAt = Date.now();
  /* 本地提交行（与 relay 行同形）：发起前先上抛，请求详情的「本地提交」行
   * 用它显示完整的落点清单（#4080 评论 8 / 评论 13）。 */
  args.onSubmissionRow?.({
    body: debugBodyOf({
      kind,
      debug: true,
      workflow: workflow.name,
      mode,
      prompt: exposed.prompt ?? "",
      /* 完整的落点清单（口 → 节点 → 值）：尺寸等输入有没有真的进提交参数，
       * 在这里逐条可见；没落进端口的口在 unmatched 里如实列出。 */
      workflowInputs: built.input.workflowInputs ?? [],
      ...(built.unmatched.length > 0 ? { unmatched: built.unmatched } : {}),
      ...(uploadedRefs.files.length > 0 ? { referenceImages: uploadedRefs.files } : {}),
      ...(uploadedFirstFrame.files[0] === undefined
        ? {}
        : { firstFrame: uploadedFirstFrame.files[0] }),
    }),
    durationMs: null,
    endpoint: "generate.generate（本地 ComfyUI）",
    excerpt: null,
    ok: true,
    phase: "relay",
    status: null,
  });

  const taskId = await startLocalGenerate(built.input);
  let closer: () => void = () => undefined;
  let lastPct = -1;
  const result = await withTimeoutResult<WorkflowTestResult | null>(
    new Promise<WorkflowTestResult>((resolve, reject) => {
      let settled = false;
      /* 取消（abort）本身也要走 settle：此前的 `!signal.aborted` 守卫把取消
       * 路径自己拦死了 —— 点击取消生成毫无效果、要等 30 分钟超时（#4080
       * 评论 12）。终态只判 `settled`；「取消后不再接受产物/失败收尾」由
       * 调用处用 settleUnlessAborted 表达。 */
      const settle = (fn: () => void) => {
        if (!settled) {
          settled = true;
          fn();
        }
      };
      const settleUnlessAborted = (fn: () => void) => {
        if (!signal.aborted) {
          settle(fn);
        }
      };
      closer = watchTask(taskId, {
        /* 执行日志逐条上抛（SSE log 帧）：测试页的「执行日志」区块展示，
         * 卡住时能直接看到任务停在哪个节点。 */
        onLog: (entry) => {
          args.onLog?.(entry);
        },
        onProgress: (pct, node) => {
          const whole = Math.floor(pct);
          if (whole === lastPct) {
            return;
          }
          lastPct = whole;
          args.onProgress?.({ pct, ...(node?.label === undefined ? {} : { label: node.label }) });
        },
        onOutput: (out) => {
          /* 图片测试只要图片产物、视频测试只要视频产物（#4596，全库唯一判据）。 */
          if (isWantedOutput(kind, out)) {
            settleUnlessAborted(() => {
              resolve({ kind, url: out.url });
            });
          }
        },
        onSettled: (r) => {
          settleUnlessAborted(() => {
            reject(new Error(r.ok ? "任务完成但没有可用产物" : (r.message ?? "本地任务失败")));
          });
        },
      });
      /* 取消（#3949 需求 5 同一句柄）：断开 SSE 并取消服务端任务（CANCELLED
       * 终态会让 ComfyUI 侧停止），错误条落「已取消生成」。 */
      const onAbort = () => {
        settle(() => {
          closer();
          void cancelLocalTask(taskId).catch(() => undefined);
          reject(new Error("已取消生成"));
        });
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }),
    LOCAL_TASK_TIMEOUT_MS,
    null,
    {
      onTimeout: () => {
        /* 安全阀：超时退订（放弃等待后流还挂着才是真问题）。 */
        closer();
      },
    },
  );
  if (result === null) {
    throw new Error("本地生成任务超时（30 分钟无响应），已停止等待");
  }
  args.onDebug([
    {
      body: { kind, mode, taskId, workflow: workflow.name },
      durationMs: Date.now() - startedAt,
      endpoint: `本地任务 ${taskId.slice(0, 8)}`,
      excerpt: result.url,
      ok: true,
      phase: "local-task",
      status: 200,
    },
  ]);
  return result;
}
