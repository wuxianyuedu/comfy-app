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
import { debugBodyOf, type ApiCallDebugRow } from "~/lib/workshop/api-channel-core";
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

/** 一次测试的结果（工坊同款输出：图片 URL / 视频 URL / 对话回复文本）。 */
export type ModelTestResult =
  | { kind: "image"; url: string }
  | { kind: "video"; url: string }
  | { kind: "chat"; text: string }
  | null;

/** 一格（用途 + 模式 + 模型）的运行态（#4080 评论 12）：切走再切回各看各的，
 *  不同格可同时测试。 */
export type ModelTestSession = {
  error: string | null;
  generating: boolean;
  generatingSince: number | null;
  notice: { kind: "ok" | "err"; text: string } | null;
  /** 响应读数（真实调用回来了什么）：与「请求」分区显示（#4080 评论 13）。 */
  responseRows: Array<ApiCallDebugRow>;
  result: ModelTestResult;
  /** 本地提交行（工作流候选在封装后升级为带 workflowInputs 落点清单的实况）。 */
  submissionRow: ApiCallDebugRow | null;
  taskLogs: Array<TaskLogEntry>;
  workflowProgress: { label?: string; pct: number } | null;
};

/** 空会话（没有运行过的格的缺省态）。 */
export function emptyModelTestSession(): ModelTestSession {
  return {
    error: null,
    generating: false,
    generatingSince: null,
    notice: null,
    responseRows: [],
    result: null,
    submissionRow: null,
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
  buildBodies: () => ReturnType<typeof buildRequestBodies>;
  /** 对话测试（#4080）：llm.chatTest 的 mutation（结构化最小面）。 */
  chatTestM: {
    mutateAsync: (input: { local: boolean; name: string; prompt: string }) => Promise<{
      durationMs: number;
      endpoint: string;
      model: string;
      reply: string;
    }>;
  };
  contract: Parameters<typeof contractTestRows>[0];
  inputRows: ReadonlyArray<ModelTestInputRow>;
  kind: ModelTestKind;
  mode: string;
  patchSession: (key: string, patch: Partial<ModelTestSession>) => void;
  referenceGroup: ReturnType<typeof useReferenceImageGroup>;
  selectedCandidate: TestCandidate | null;
  selectedModel: string;
  /** 每格自己的取消句柄登记（null = 注销）。 */
  setCancelController: (key: string, controller: AbortController | null) => void;
  values: ModelTestValues;
};

export function useModelTestGenerate(args: ModelTestGenerateArgs): {
  generate: (sessionKey: string) => Promise<void>;
} {
  const {
    buildBodies,
    chatTestM,
    contract,
    inputRows,
    kind,
    mode,
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
    async (sessionKey: string) => {
      const prompt = values.prompt?.trim() ?? "";
      if (prompt === "") {
        patchSession(sessionKey, { error: "请填写提示词" });
        return;
      }
      /* 必备口校验（ISSUE #3778）：契约标了必备、通道又承接得住的行，空着就
       * 拦下 —— 与「必备 / 可选」标识同一份读数，别让用户点生成才被上游打回。
       * 参考图行（#3949 需求 6/7）按数组判空。 */
      const missing = missingRequiredLabels(inputRows, values, referenceGroup.images.length);
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
        workflowProgress: null,
        submissionRow: null,
      });
      const workflow = selectedCandidate?.workflow;
      /* 工作流候选（#4080 评论 4）：走工坊本地 ComfyUI 通道（封装 → 入队 →
       * SSE 观察），不走图片/视频的 API 中继。 */
      if (workflow !== undefined && kind !== "chat") {
        const firstFrameRaw = values["first-frame"]?.trim();
        const controller = new AbortController();
        setCancelController(sessionKey, controller);
        await runAsyncAction(
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
                referenceImages:
                  referenceGroup.images.length > 0
                    ? referenceGroup.images
                    : values.image?.trim()
                      ? [values.image.trim()]
                      : [],
                signal: controller.signal,
                values,
                workflow,
              });
              patchSession(sessionKey, { result: { kind: res.kind, url: res.url } });
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
        return;
      }
      /* 对话测试（#4080）：请求走 LLM 补全而不是图片/视频中继，端点在服务端
       * 按所选模型解析。 */
      if (kind === "chat") {
        const controller = new AbortController();
        setCancelController(sessionKey, controller);
        await runAsyncAction(
          async () => {
            try {
              const res = await chatTestM.mutateAsync({
                name: selectedModel,
                local: selectedLocal,
                prompt,
              });
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
              patchSession(sessionKey, { result: { kind: "chat", text: res.reply } });
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
        return;
      }
      const { imageBody, videoBody } = buildBodies();
      if (imageBody !== null) {
        const controller = new AbortController();
        setCancelController(sessionKey, controller);
        await runAsyncAction(
          async () => {
            try {
              const url = await apiGenerateImage(imageBody, {
                onDebug: (rows) => {
                  appendResponseRows(sessionKey, rows);
                },
                signal: controller.signal,
              });
              patchSession(sessionKey, { result: { kind: "image", url } });
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
        return;
      }
      if (videoBody !== null) {
        const controller = new AbortController();
        setCancelController(sessionKey, controller);
        await runAsyncAction(
          async () => {
            try {
              const submitted = await apiSubmitVideo(videoBody, {
                onDebug: (rows) => {
                  appendResponseRows(sessionKey, rows);
                },
                signal: controller.signal,
              });
              if (submitted.url !== undefined && submitted.url !== "") {
                patchSession(sessionKey, { result: { kind: "video", url: submitted.url } });
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
              patchSession(sessionKey, { result: finished });
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
        return;
      }
      patchSession(sessionKey, { error: "未知的生成用途" });
    },
    [
      appendResponseRows,
      appendTaskLog,
      buildBodies,
      chatTestM,
      contract,
      gateFor,
      inputRows,
      kind,
      mode,
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
    async (sessionKey: string) => {
      if (selectedModel === "") {
        return;
      }
      const lock = lockFor(sessionKey);
      if (!lock.tryEnter()) {
        return;
      }
      try {
        patchSession(sessionKey, { generating: true, generatingSince: Date.now() });
        await runGenerate(sessionKey);
      } finally {
        patchSession(sessionKey, { generating: false, generatingSince: null });
        lock.exit();
      }
    },
    [lockFor, patchSession, runGenerate, selectedModel],
  );

  return { generate };
}
