"use client";

// ── 「测试模型能力」生成动作（#3590 / #4080）──────────────────────────────
// 从 use-model-test 拆出（§12.13：useModelTest 越过函数长度硬闸）——只搬不改：
// 必备口校验、三条通道（对话 #4080 / 本地工作流 #4080 评论 4 / 图片视频中继）、
// 取消语义与拆分前一致。状态更新器仍归主 hook 持有，这里只编排。

import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";

import { runAsyncAction } from "~/lib/async-action";
import { debugBodyOf, type ApiCallDebugRow } from "~/lib/workshop/api-channel-core";
import { useReentrancyLock } from "~/components/ui/use-reentrancy-lock";
import { createThrottleGate } from "~/components/ui/use-throttled-progress";
import {
  apiGenerateImage,
  apiSubmitVideo,
  pollVideoUntilDone,
  type RelayDebugSink,
} from "~/lib/workshop/generation-client";

import { runWorkflowModelTest } from "./workflow-model-test";
import type { useReferenceImageGroup } from "./use-reference-image-group";

import {
  relayDebugRow,
  type buildRequestBodies,
  type contractTestRows,
  type ModelTestInputRow,
  type ModelTestKind,
  type ModelTestValues,
  type TestCandidate,
} from "../model-test-config";

/** 一次测试的结果（工坊同款输出：图片 URL / 视频 URL / 对话回复文本）。 */
export type ModelTestResult =
  | { kind: "image"; url: string }
  | { kind: "video"; url: string }
  | { kind: "chat"; text: string }
  | null;

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
  appendDebug: RelayDebugSink;
  buildBodies: () => ReturnType<typeof buildRequestBodies>;
  busy: { busy: boolean; run: (fn: () => Promise<unknown>) => Promise<unknown> };
  cancelRef: { current: AbortController | null };
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
  referenceGroup: ReturnType<typeof useReferenceImageGroup>;
  selectedCandidate: TestCandidate | null;
  selectedModel: string;
  setDebugRows: Dispatch<SetStateAction<Array<ApiCallDebugRow>>>;
  setError: (text: string | null) => void;
  setGeneratingSince: (value: number | null) => void;
  setNotice: (value: { kind: "ok" | "err"; text: string } | null) => void;
  setResult: (value: ModelTestResult) => void;
  setWorkflowProgress: Dispatch<SetStateAction<{ label?: string; pct: number } | null>>;
  values: ModelTestValues;
};

export function useModelTestGenerate(args: ModelTestGenerateArgs): {
  cancelGenerate: () => void;
  generate: () => Promise<void>;
} {
  const {
    appendDebug,
    buildBodies,
    busy,
    chatTestM,
    contract,
    cancelRef,
    inputRows,
    kind,
    mode,
    referenceGroup,
    selectedCandidate,
    selectedModel,
    setDebugRows,
    setError,
    setGeneratingSince,
    setNotice,
    setResult,
    setWorkflowProgress,
    values,
  } = args;
  /* 被测候选的来源（#4080）：本地 Ollama 走设置里配置的本地服务；远端按名解析。 */
  const selectedLocal = selectedCandidate?.local ?? false;
  /* 同一时刻只跑一件的同步闸门（P64）。 */
  const lock = useReentrancyLock();
  /* 本地工作流任务的进度闸门（P64 / §16.2.4.68）：SSE 每帧一次的高频回调
   * 节流后再落 state，不逐帧重渲。 */
  const progressGate = useRef(createThrottleGate());

  const runGenerate = useCallback(async () => {
    const prompt = values.prompt?.trim() ?? "";
    if (prompt === "") {
      setError("请填写提示词");
      return;
    }
    /* 必备口校验（ISSUE #3778）：契约标了必备、通道又承接得住的行，空着就
     * 拦下 —— 与「必备 / 可选」标识同一份读数，别让用户点生成才被上游打回。
     * 参考图行（#3949 需求 6/7）按数组判空。 */
    const missing = missingRequiredLabels(inputRows, values, referenceGroup.images.length);
    if (missing.length > 0) {
      setError(`请填写必备输入：${missing.join("、")}`);
      return;
    }
    setError(null);
    setResult(null);
    setNotice(null);
    /* 工作流候选（#4080 评论 4）：走工坊本地 ComfyUI 通道（封装 → 入队 →
     * SSE 观察），不走图片/视频的 API 中继。请求读数由 runWorkflowModelTest
     * 经 appendDebug 逐行给出；进度经 onProgress 更新。 */
    const workflow = selectedCandidate?.workflow;
    if (workflow !== undefined && kind !== "chat") {
      const firstFrameRaw = values["first-frame"]?.trim();
      setDebugRows([]);
      setWorkflowProgress(null);
      const controller = new AbortController();
      cancelRef.current = controller;
      setGeneratingSince(Date.now());
      await busy.run(() =>
        runAsyncAction(
          async () => {
            try {
              const res = await runWorkflowModelTest({
                contractIds: contract?.inputs,
                firstFrameDataUrl: firstFrameRaw === "" ? undefined : firstFrameRaw,
                kind,
                mode,
                onDebug: appendDebug,
                onNotice: (text) => {
                  setNotice({ kind: "err", text });
                },
                onProgress: (progress) => {
                  /* 高频 SSE 进度按闸门节流后再落 state（P64 / §16.2.4.68）。 */
                  if (!progressGate.current.allow("model-test")) {
                    return;
                  }
                  setWorkflowProgress(progress);
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
              setResult({ kind: res.kind, url: res.url });
              return { ok: true as const };
            } finally {
              cancelRef.current = null;
            }
          },
          {
            report: (k, text) => {
              if (k === "err") {
                setError(text);
              }
            },
            failureText: "生成失败",
          },
        ),
      );
      setGeneratingSince(null);
      setWorkflowProgress(null);
      return;
    }
    /* 本地提交行（ISSUE #3799）：点生成立即显示本次要发的请求（relay 端点 +
     * 组装好的统一输入体，长值截断），不等生成结束；上游读数回来后追加在它
     * 后面。 */
    const { imageBody, videoBody } = buildBodies();
    const relayBody = imageBody ?? videoBody ?? {};
    /* 对话测试（#4080）：请求走 LLM 补全而不是图片/视频中继，端点在服务端
     * 按所选模型解析 —— 先给一行已知信息（模型 + 提示词），完成后换成全量读数。 */
    const localRow =
      kind === "chat"
        ? {
            body: debugBodyOf({ kind: "chat", model: selectedModel, prompt }),
            durationMs: null,
            endpoint: "chat/completions",
            excerpt: null,
            ok: true,
            phase: "relay" as const,
            status: null,
          }
        : relayDebugRow(kind, relayBody);
    setDebugRows([localRow]);
    /* 取消句柄（#3949 需求 5）：生成期间可随时 cancelGenerate() 中止等待与轮询。 */
    const controller = new AbortController();
    cancelRef.current = controller;
    setGeneratingSince(Date.now());
    /* 失败反馈走 runAsyncAction（P27）；成功不另报 —— 产物本身已经是反馈。 */
    await busy.run(() =>
      runAsyncAction(
        async () => {
          try {
            if (kind === "chat") {
              const res = await chatTestM.mutateAsync({
                name: selectedModel,
                local: selectedLocal,
                prompt,
              });
              setDebugRows([
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
              setResult({ kind: "chat", text: res.reply });
              return { ok: true as const };
            }
            if (imageBody !== null) {
              const url = await apiGenerateImage(imageBody, {
                onDebug: appendDebug,
                signal: controller.signal,
              });
              setResult({ kind: "image", url });
              return { ok: true as const };
            }
            if (videoBody !== null) {
              const submitted = await apiSubmitVideo(videoBody, {
                onDebug: appendDebug,
                signal: controller.signal,
              });
              if (submitted.url !== undefined && submitted.url !== "") {
                setResult({ kind: "video", url: submitted.url });
                return { ok: true as const };
              }
              const taskId = submitted.remoteTaskId;
              if (taskId === undefined || taskId === "") {
                throw new Error("API 视频响应中未找到视频 URL 或任务 ID");
              }
              const finished = await pollVideoUntilDone({
                mode,
                model: selectedModel,
                onDebug: appendDebug,
                signal: controller.signal,
                taskId,
              });
              setResult(finished);
              return { ok: true as const };
            }
            throw new Error("未知的生成用途");
          } finally {
            cancelRef.current = null;
          }
        },
        {
          report: (k, text) => {
            if (k === "err") {
              setError(text);
            }
          },
          failureText: "生成失败",
        },
      ),
    );
    setGeneratingSince(null);
  }, [
    appendDebug,
    buildBodies,
    busy,
    cancelRef,
    chatTestM,
    contract,
    inputRows,
    kind,
    mode,
    referenceGroup.images,
    selectedCandidate,
    selectedLocal,
    selectedModel,
    setDebugRows,
    setError,
    setGeneratingSince,
    setNotice,
    setResult,
    setWorkflowProgress,
    values,
  ]);

  /* 生成入口（P64「同一时刻只跑一件」）：同步闸门 —— 忙碌位是 useState，同一
   * 事件循环里读不到刚写入的值，双击会跑两遍；界面忙碌态仍归 busy 管。 */
  const generate = useCallback(async () => {
    if (selectedModel === "") {
      return;
    }
    if (!lock.tryEnter()) {
      return;
    }
    try {
      await runGenerate();
    } finally {
      lock.exit();
    }
  }, [lock, runGenerate, selectedModel]);

  /** 取消本轮生成（#3949 需求 5）：中止等待与轮询，错误条落「已取消生成」。 */
  const cancelGenerate = useCallback(() => {
    cancelRef.current?.abort();
  }, [cancelRef]);

  return { cancelGenerate, generate };
}
