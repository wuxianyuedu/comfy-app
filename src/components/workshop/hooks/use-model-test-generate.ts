"use client";

// ── 「测试模型能力」生成动作（#3590 / #4080）──────────────────────────────
// 从 use-model-test 拆出（§12.13：useModelTest 越过函数长度硬闸）。
// 运行态按「用途 + 模式 + 模型」一格一份（ModelTestSession，#4080 评论 12）：
// 状态 / 请求读数 / 执行日志 / 产物互相隔离，切走再切回各看各的，不同模型
// 可以同时测试（锁与取消句柄都按格各一把）。三条通道：对话（#4080）、
// 本地工作流（#4080 评论 4）、图片视频中继。状态更新器仍归主 hook 持有，
// 这里只编排。

import { useCallback, useRef } from "react";

import { runAsyncAction } from "~/lib/async-action";
import { debugBodyOf, type ApiCallDebugRow } from "~/lib/workshop/api-channel-shared";
import type { RouterInputs, RouterOutputs } from "~/trpc/react";
import type { ModelTestRunInput } from "../model-test-runs";
import type { ModelTestResult } from "../model-test-result";
import { createReentrancyLock, type ReentrancyLock } from "~/components/ui/use-reentrancy-lock";
import { createThrottleGate, type ThrottleGate } from "~/components/ui/use-throttled-progress";
import {
  apiGenerateImage,
  apiSubmitVideo,
  pollVideoUntilDone,
  type TaskLogEntry,
} from "~/lib/workshop/generation-client";

import { runWorkflowModelTest } from "./workflow-model-test";
import type { useReferenceImageGroup } from "./use-reference-image-group";

import type {
  buildRequestBodies,
  contractTestRows,
  ModelTestInputRow,
  ModelTestKind,
  ModelTestValues,
  TestCandidate,
} from "../model-test-config";

export type { ModelTestResult };

/** 一格（用途 + 模式 + 模型）的运行态（#4080 评论 12）：切走再切回各看各的，
 *  不同格可同时测试。 */
export type ModelTestSession = {
  error: string | null;
  generating: boolean;
  generatingSince: number | null;
  notice: { kind: "ok" | "err"; text: string } | null;
  /** 该格的「实际请求」预览行（dry-run 产物；#4080 评论 20：生成中保持可见）。 */
  previewRows: Array<ApiCallDebugRow>;
  /** 响应读数（真实调用回来了什么）：与「请求」分区显示（#4080 评论 13）。 */
  responseRows: Array<ApiCallDebugRow>;
  result: ModelTestResult;
  /** 本地提交行（工作流候选在封装后升级为带 workflowInputs 落点清单的实况）。 */
  submissionRow: ApiCallDebugRow | null;
  /** 本地工作流任务 id（入队后登记）：「大屏查看日志」弹窗按它连 SSE。 */
  taskId: string | null;
  taskLogs: Array<TaskLogEntry>;
  /** 该格的统一输入表单值（#4080 评论 19：切模型不丢已填参数）。 */
  values: ModelTestValues;
  /** 本地工作流任务进度（SSE state 帧）：pct 之外尽量带采样步数（value/max），
   *  进度面板的「553/8196 · it/s」由它算。 */
  workflowProgress: { label?: string; max?: number; pct: number; value?: number } | null;
};

/** 空会话（没有运行过的格的缺省态）。 */
export function emptyModelTestSession(): ModelTestSession {
  return {
    error: null,
    generating: false,
    generatingSince: null,
    notice: null,
    values: {},
    previewRows: [],
    responseRows: [],
    result: null,
    submissionRow: null,
    taskId: null,
    taskLogs: [],
    workflowProgress: null,
  };
}

/** 必备口缺漏清单（#3949 需求 6/7 起：参考图行按数组判空，其余按单值判空）。 */
function missingRequiredLabels(
  rows: ReadonlyArray<ModelTestInputRow>,
  values: ModelTestValues,
  referenceCount: number,
): Array<string> {
  return rows
    .filter((row) => row.required && !row.disabled && row.valueKey !== null)
    .filter((row) => {
      if (row.id === "reference-image") {
        /* 参考图行（#3949 需求 6/7）的值在数组里，不看 values.image。 */
        return referenceCount === 0;
      }
      const key = row.valueKey;
      return key !== null && (values[key]?.trim() ?? "") === "";
    })
    .map((row) => row.label);
}

/** 生成 / 取消动作的入参：主 hook 的状态与读数按引用传入。 */
export type ModelTestGenerateArgs = {
  appendResponseRows: (key: string, rows: ReadonlyArray<ApiCallDebugRow>) => void;
  appendTaskLog: (key: string, entry: TaskLogEntry) => void;
  /** 请求体组装（唯一入口）：值由调用处显式给（生成可带表单值覆盖，ISSUE #4769）。 */
  buildBodies: (
    values: ModelTestValues,
    referenceImages?: Array<string>,
  ) => ReturnType<typeof buildRequestBodies>;
  /** 对话测试：显式接收取消信号，取消会穿透 tRPC 到达上游请求。 */
  chatTest: (
    input: RouterInputs["llm"]["chatTest"],
    signal: AbortSignal,
  ) => Promise<RouterOutputs["llm"]["chatTest"]>;
  contract: Parameters<typeof contractTestRows>[0];
  inputRows: ReadonlyArray<ModelTestInputRow>;
  kind: ModelTestKind;
  mode: string;
  onRunRecord: (run: ModelTestRunInput) => void;
  patchSession: (key: string, patch: Partial<ModelTestSession>) => void;
  referenceGroup: ReturnType<typeof useReferenceImageGroup>;
  selectedCandidate: TestCandidate | null;
  selectedModel: string;
  /** 每格自己的取消句柄登记（null = 注销）。 */
  setCancelController: (key: string, controller: AbortController | null) => void;
  values: ModelTestValues;
};

export function useModelTestGenerate(args: ModelTestGenerateArgs): {
  /** `valuesOverride`（ISSUE #4769）：JSON 输入模式解析出的表单值 —— 生成读
   *  的是本次渲染的表单闭包，粘贴后同一次点击里直接生成会拿到旧值，所以
   *  覆盖值显式随调用给。 */
  generate: (
    sessionKey: string,
    valuesOverride?: ModelTestValues,
    referenceImagesOverride?: Array<string>,
  ) => Promise<void>;
} {
  const {
    buildBodies,
    chatTest,
    contract,
    inputRows,
    kind,
    mode,
    onRunRecord,
    referenceGroup,
    selectedCandidate,
    selectedModel,
    patchSession,
    appendResponseRows,
    appendTaskLog,
    setCancelController,
    values,
  } = args;
  /* 被测候选的来源（#4080）：本地 Ollama 走设置里配置的本地服务；远端按名解析。 */
  const selectedLocal = selectedCandidate?.local ?? false;
  /* 每格一把同步重入闸门：同一格同一时刻只跑一件；不同格互不拦 —— 可同时
   * 测试多个模型（#4080 评论 12）。 */
  const locksRef = useRef<Map<string, ReentrancyLock>>(new Map());
  /* 每格一个进度闸门（P64 / §16.2.4.68）：SSE 每帧一次的高频回调节流后再
   * 落 state，不逐帧重渲。 */
  const progressGatesRef = useRef<Map<string, ThrottleGate>>(new Map());
  const lockFor = useCallback((key: string): ReentrancyLock => {
    const existing = locksRef.current.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const created = createReentrancyLock();
    locksRef.current.set(key, created);
    return created;
  }, []);
  const gateFor = useCallback((key: string): ThrottleGate => {
    const existing = progressGatesRef.current.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const created = createThrottleGate();
    progressGatesRef.current.set(key, created);
    return created;
  }, []);

  const runGenerate = useCallback(
    async (
      sessionKey: string,
      valuesOverride?: ModelTestValues,
      referenceImagesOverride?: Array<string>,
    ) => {
      /* 表单值可被调用方覆盖（ISSUE #4769：JSON 输入模式解析出的值在同一次
       * 点击里直接进生成，绕开「先 setState 再读旧闭包」的时序坑）。 */
      const effective = valuesOverride ?? values;
      const referenceImages =
        referenceImagesOverride ??
        (referenceGroup.images.length > 0
          ? referenceGroup.images
          : effective.image?.trim()
            ? [effective.image.trim()]
            : []);
      const prompt = effective.prompt?.trim() ?? "";
      if (prompt === "") {
        patchSession(sessionKey, { error: "请填写提示词" });
        return;
      }
      /* 必备口校验（ISSUE #3778）：契约标了必备、通道又承接得住的行，空着就
       * 拦下 —— 与「必备 / 可选」标识同一份读数，别让用户点生成才被上游打回。
       * 参考图行（#3949 需求 6/7）按数组判空。 */
      const missing = missingRequiredLabels(inputRows, effective, referenceImages.length);
      if (missing.length > 0) {
        patchSession(sessionKey, { error: `请填写必备输入：${missing.join("、")}` });
        return;
      }
      /* 新一轮测试：清掉这一格上一次的响应 / 日志 / 进度 / 产物。 */
      patchSession(sessionKey, {
        error: null,
        notice: null,
        result: null,
        responseRows: [],
        taskLogs: [],
        taskId: null,
        workflowProgress: null,
        submissionRow: null,
      });
      const startedAt = Date.now();
      let runResult: ModelTestResult = null;
      let endpoint: string | undefined;
      const record = (status: ModelTestRunInput["status"], error: string | null) => {
        onRunRecord({
          durationMs: Date.now() - startedAt,
          endpoint,
          error,
          kind,
          mode,
          model: selectedModel,
          result: runResult,
          referenceImages,
          sessionKey,
          startedAt,
          status,
          values: effective,
        });
      };
      const workflow = selectedCandidate?.workflow;
      /* 工作流候选（#4080 评论 4）：走工坊本地 ComfyUI 通道（封装 → 入队 →
       * SSE 观察），不走图片/视频的 API 中继。 */
      if (workflow !== undefined && kind !== "chat") {
        const firstFrameRaw = effective["first-frame"]?.trim();
        const controller = new AbortController();
        setCancelController(sessionKey, controller);
        const action = await runAsyncAction(
          async () => {
            try {
              const res = await runWorkflowModelTest({
                contractIds: contract?.inputs,
                firstFrameDataUrl: firstFrameRaw === "" ? undefined : firstFrameRaw,
                kind,
                mode,
                onDebug: (rows) => {
                  appendResponseRows(sessionKey, rows);
                },
                onLog: (entry) => {
                  /* 执行日志逐条进测试页的「执行日志」区块（#4080 评论 8）。 */
                  appendTaskLog(sessionKey, entry);
                },
                onTaskId: (taskId) => {
                  /* 任务 id 落进当前格会话：「大屏查看日志」按钮按它挂弹窗（#4743）。 */
                  patchSession(sessionKey, { taskId });
                },
                onNotice: (text) => {
                  patchSession(sessionKey, { notice: { kind: "err", text } });
                },
                onSubmissionRow: (row) => {
                  /* 本地提交行升级为封装实况（workflowInputs 落点清单）。 */
                  patchSession(sessionKey, { submissionRow: row });
                },
                onProgress: (progress) => {
                  /* 高频 SSE 进度按闸门节流后再落 state（P64 / §16.2.4.68）。 */
                  if (!gateFor(sessionKey).allow(sessionKey)) {
                    return;
                  }
                  patchSession(sessionKey, { workflowProgress: progress });
                },
                /* 参考图组优先；只填了单图行时并成一组的兜底（与 relay 组装
                 * 的 firstRef 优先级一致）。 */
                referenceImages,
                signal: controller.signal,
                values: effective,
                workflow,
              });
              runResult = { kind: res.kind, url: res.url };
              patchSession(sessionKey, { result: runResult });
              return { ok: true as const };
            } finally {
              setCancelController(sessionKey, null);
            }
          },
          {
            report: (k, text) => {
              if (k === "err") {
                patchSession(sessionKey, { error: text });
              }
            },
            failureText: "生成失败",
          },
        );
        record(
          action.ok ? "succeeded" : /取消|abort/i.test(action.detail) ? "cancelled" : "failed",
          action.ok ? null : action.detail,
        );
        return;
      }
      /* 对话测试（#4080）：请求走 LLM 补全而不是图片/视频中继，端点在服务端
       * 按所选模型解析。 */
      if (kind === "chat") {
        const controller = new AbortController();
        setCancelController(sessionKey, controller);
        const action = await runAsyncAction(
          async () => {
            try {
              const res = await chatTest(
                {
                  name: selectedModel,
                  local: selectedLocal,
                  prompt,
                },
                controller.signal,
              );
              if (controller.signal.aborted) {
                throw new Error("已取消生成");
              }
              appendResponseRows(sessionKey, [
                {
                  body: debugBodyOf({ kind: "chat", model: res.model, prompt }),
                  durationMs: res.durationMs,
                  endpoint: res.endpoint,
                  excerpt: res.reply,
                  ok: true,
                  phase: "relay" as const,
                  status: 200,
                },
              ]);
              endpoint = res.endpoint;
              runResult = { kind: "chat", text: res.reply };
              patchSession(sessionKey, { result: runResult });
              return { ok: true as const };
            } catch (error) {
              if (controller.signal.aborted) {
                throw new Error("已取消生成", { cause: error });
              }
              throw error;
            } finally {
              setCancelController(sessionKey, null);
            }
          },
          {
            report: (k, text) => {
              if (k === "err") {
                patchSession(sessionKey, { error: text });
              }
            },
            failureText: "生成失败",
          },
        );
        record(
          action.ok ? "succeeded" : /取消|abort/i.test(action.detail) ? "cancelled" : "failed",
          action.ok ? null : action.detail,
        );
        return;
      }
      const { imageBody, videoBody } = buildBodies(effective, referenceImages);
      if (imageBody !== null) {
        const controller = new AbortController();
        setCancelController(sessionKey, controller);
        const action = await runAsyncAction(
          async () => {
            try {
              const url = await apiGenerateImage(imageBody, {
                onDebug: (rows) => {
                  appendResponseRows(sessionKey, rows);
                },
                signal: controller.signal,
              });
              if (controller.signal.aborted) {
                throw new Error("已取消生成");
              }
              runResult = { kind: "image", url };
              patchSession(sessionKey, { result: runResult });
              return { ok: true as const };
            } finally {
              setCancelController(sessionKey, null);
            }
          },
          {
            report: (k, text) => {
              if (k === "err") {
                patchSession(sessionKey, { error: text });
              }
            },
            failureText: "生成失败",
          },
        );
        record(
          action.ok ? "succeeded" : /取消|abort/i.test(action.detail) ? "cancelled" : "failed",
          action.ok ? null : action.detail,
        );
        return;
      }
      if (videoBody !== null) {
        const controller = new AbortController();
        setCancelController(sessionKey, controller);
        const action = await runAsyncAction(
          async () => {
            try {
              const submitted = await apiSubmitVideo(videoBody, {
                onDebug: (rows) => {
                  appendResponseRows(sessionKey, rows);
                },
                signal: controller.signal,
              });
              if (controller.signal.aborted) {
                throw new Error("已取消生成");
              }
              if (submitted.url !== undefined && submitted.url !== "") {
                runResult = { kind: "video", url: submitted.url };
                patchSession(sessionKey, { result: runResult });
                return { ok: true as const };
              }
              const taskId = submitted.remoteTaskId;
              if (taskId === undefined || taskId === "") {
                throw new Error("API 视频响应中未找到视频 URL 或任务 ID");
              }
              const finished = await pollVideoUntilDone({
                mode,
                model: selectedModel,
                onDebug: (rows) => {
                  appendResponseRows(sessionKey, rows);
                },
                signal: controller.signal,
                taskId,
              });
              if (controller.signal.aborted) {
                throw new Error("已取消生成");
              }
              runResult = finished;
              patchSession(sessionKey, { result: runResult });
              return { ok: true as const };
            } finally {
              setCancelController(sessionKey, null);
            }
          },
          {
            report: (k, text) => {
              if (k === "err") {
                patchSession(sessionKey, { error: text });
              }
            },
            failureText: "生成失败",
          },
        );
        record(
          action.ok ? "succeeded" : /取消|abort/i.test(action.detail) ? "cancelled" : "failed",
          action.ok ? null : action.detail,
        );
        return;
      }
      patchSession(sessionKey, { error: "未知的生成用途" });
    },
    [
      appendResponseRows,
      appendTaskLog,
      buildBodies,
      chatTest,
      contract,
      gateFor,
      inputRows,
      kind,
      mode,
      onRunRecord,
      patchSession,
      referenceGroup.images,
      selectedCandidate,
      selectedLocal,
      selectedModel,
      setCancelController,
      values,
    ],
  );

  /* 生成入口（P64「同一时刻只跑一件」）：每格一把同步闸门 —— 忙碌位是
   * useState，同一事件循环里读不到刚写入的值，双击会跑两遍；不同格互不拦，
   * 可同时测试多个模型（#4080 评论 12）。忙碌位随格走（P65：复位在 finally）。 */
  const generate = useCallback(
    async (
      sessionKey: string,
      valuesOverride?: ModelTestValues,
      referenceImagesOverride?: Array<string>,
    ) => {
      if (selectedModel === "") {
        return;
      }
      const lock = lockFor(sessionKey);
      if (!lock.tryEnter()) {
        return;
      }
      try {
        patchSession(sessionKey, { generating: true, generatingSince: Date.now() });
        await runGenerate(sessionKey, valuesOverride, referenceImagesOverride);
      } finally {
        patchSession(sessionKey, { generating: false, generatingSince: null });
        lock.exit();
      }
    },
    [lockFor, patchSession, runGenerate, selectedModel],
  );

  return { generate };
}
