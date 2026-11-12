"use client";

// ── 工坊「测试模型能力」：逻辑层（规范 17 §17.2 第②层）──────────────────────
// 候选模型来自设置页配置（configGet），适配器来自「模型适配」注册表；
// 生成动作走**工坊同款通道**（generation-client 的 apiGenerateImage /
// apiSubmitVideo / apiPollVideo —— 远端模型按 remoteModel 表 + 适配器直连）。
// 视图（ModelTestView）只渲染 + 上抛，不出现 fetch / api.*。

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { readFileAsDataUrl } from "~/lib/file-io";
import { runAsyncAction } from "~/lib/async-action";
import { sleep } from "~/lib/with-timeout";
import { isRecord } from "~/lib/is-record";
import { useBusyAction } from "~/components/ui/use-busy-action";
import { apiGenerateImage, apiPollVideo, apiSubmitVideo } from "~/lib/workshop/generation-client";
import { parseRemoteModeAdapters } from "~/lib/workshop/remote-model-adapter";
import type { RemoteModeAdapter } from "~/lib/workshop/remote-model-adapter";

import { useTRPC } from "~/trpc/react";

import {
  assembleImageRequest,
  assembleVideoRequest,
  testCandidatesForKind,
  type ModelTestKind,
  type ModelTestValues,
  type TestCandidate,
} from "../model-test-config";

/** 视频任务轮询：与 VideoStudio 同一节奏（3s 一轮 / 10 分钟上限）。 */
const POLL_INTERVAL_MS = 3000;
const POLL_DEADLINE_MS = 600_000;

/** 一次测试的结果（工坊同款输出：图片 URL / 视频 URL）。 */
export type ModelTestResult =
  | { kind: "image"; url: string }
  | { kind: "video"; url: string }
  | null;

export type ModelTestController = {
  /** 选中模型的适配器草稿（workshopAdaptersGet 的解析结果）。 */
  adapters: Array<RemoteModeAdapter>;
  /** 候选模型（当前 kind 下启用的远端条目）。 */
  candidates: Array<TestCandidate>;
  /** 一次测试的失败文案（空 = 没失败）。 */
  error: string | null;
  /** 生成动作：按适配器映射收集统一输入并发起一次真实调用（消耗额度）。 */
  generate: () => Promise<void>;
  /** 忙碌位：提交 / 轮询进行中。 */
  generating: boolean;
  /** 当前用途（图片 / 视频页签）。 */
  kind: ModelTestKind;
  /** 适配器查询 / 候选读取的加载态。 */
  loading: boolean;
  /** 选中模型当前生效的模式码（"" = 未配适配器，走通道默认端点）。 */
  mode: string;
  /** 局部更新表单值（文本 / 档位）。 */
  patchValue: (type: keyof ModelTestValues, value: string) => void;
  /** 最近一次成功产物。 */
  result: ModelTestResult;
  selectedModel: string;
  selectModel: (name: string) => void;
  /** 图片输入行选完文件后由视图调用：读成 data URL 存进表单值。 */
  setInputFromFile: (type: "first-frame" | "image", file: File) => Promise<void>;
  /** 切换用途页签（候选 / 选中 / 表单随之重置）。 */
  setKind: (kind: ModelTestKind) => void;
  setMode: (mode: string) => void;
  values: ModelTestValues;
};

export function useModelTest(): ModelTestController {
  const trpc = useTRPC();
  const configQ = useQuery(trpc.llm.configGet.queryOptions());
  const [kind, setKindState] = useState<ModelTestKind>("image");
  const [selectedModel, setSelectedModel] = useState("");
  const [mode, setModeState] = useState("");
  const [values, setValues] = useState<ModelTestValues>({});
  const [result, setResult] = useState<ModelTestResult>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useBusyAction();

  const candidates = useMemo<Array<TestCandidate>>(() => {
    const raw: unknown = configQ.data?.config;
    if (!isRecord(raw) || !Array.isArray(raw.extraModels)) {
      return [];
    }
    const out: Array<TestCandidate> = [];
    for (const item of raw.extraModels) {
      if (!isRecord(item)) {
        continue;
      }
      out.push({
        name: typeof item.name === "string" ? item.name : "",
        kind: typeof item.kind === "string" ? item.kind : "",
        baseUrl: typeof item.baseUrl === "string" ? item.baseUrl : null,
      });
    }
    return testCandidatesForKind(kind, out);
  }, [configQ.data, kind]);

  const adaptersQ = useQuery(
    trpc.llm.workshopAdaptersGet.queryOptions(
      { name: selectedModel },
      { enabled: selectedModel !== "" },
    ),
  );
  const adapters = useMemo(
    () => parseRemoteModeAdapters(adaptersQ.data?.adapters ?? []),
    [adaptersQ.data],
  );

  /** 选中模型变化时把模式重置到它的第一个适配器（渲染期播种，React 19 模式：
   *  查询晚于选中到达时补种一次；用户手选的模式不被覆盖）。 */
  const [modeSeededFor, setModeSeededFor] = useState<{ mode: string; model: string } | null>(null);
  if (selectedModel !== "" && modeSeededFor?.model !== selectedModel) {
    setModeSeededFor({ model: selectedModel, mode: adapters[0]?.mode ?? "" });
    setModeState(adapters[0]?.mode ?? "");
  } else if (selectedModel !== "" && mode === "" && adapters.length > 0) {
    setModeState(adapters[0]?.mode ?? "");
  }

  const setKind = useCallback((next: ModelTestKind) => {
    setKindState(next);
    setSelectedModel("");
    setModeState("");
    setValues({});
    setResult(null);
    setError(null);
  }, []);

  const selectModel = useCallback((name: string) => {
    setSelectedModel(name);
    setModeState("");
    setValues({});
    setResult(null);
    setError(null);
  }, []);

  const patchValue = useCallback((type: keyof ModelTestValues, value: string) => {
    setValues((prev) => ({ ...prev, [type]: value }));
  }, []);

  const setInputFromFile = useCallback(async (type: "first-frame" | "image", file: File) => {
    /* 失败反馈走 runAsyncAction（P27：try/catch + setError 的样板不手写）。 */
    await runAsyncAction(
      async () => {
        const dataUrl = await readFileAsDataUrl(file);
        setValues((prev) => ({ ...prev, [type]: dataUrl }));
        return { ok: true as const };
      },
      {
        report: (k, text) => {
          if (k === "err") {
            setError(text);
          }
        },
        failureText: "读取图片失败",
      },
    );
  }, []);

  const generate = useCallback(async () => {
    if (busy.busy || selectedModel === "") {
      return;
    }
    const prompt = values.prompt?.trim() ?? "";
    if (prompt === "") {
      setError("请填写提示词");
      return;
    }
    setError(null);
    setResult(null);
    /* 失败反馈走 runAsyncAction（P27）；成功不另报 —— 产物本身已经是反馈。 */
    await busy.run(() =>
      runAsyncAction(
        async () => {
          if (kind === "image") {
            const url = await apiGenerateImage(
              assembleImageRequest({ model: selectedModel, mode, values }),
            );
            setResult({ kind: "image", url });
            return { ok: true as const };
          }
          const submitted = await apiSubmitVideo(
            assembleVideoRequest({ model: selectedModel, mode, values }),
          );
          if (submitted.url !== undefined && submitted.url !== "") {
            setResult({ kind: "video", url: submitted.url });
            return { ok: true as const };
          }
          const taskId = submitted.remoteTaskId;
          if (taskId === undefined || taskId === "") {
            throw new Error("API 视频响应中未找到视频 URL 或任务 ID");
          }
          const deadline = Date.now() + POLL_DEADLINE_MS;
          while (Date.now() < deadline) {
            // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一轮轮询用前一轮的结果
            await sleep(POLL_INTERVAL_MS);
            // oxlint-disable-next-line no-await-in-loop -- 同上
            const round = await apiPollVideo(taskId, { model: selectedModel, mode });
            if (round.url !== undefined && round.url !== "") {
              setResult({ kind: "video", url: round.url });
              return { ok: true as const };
            }
            if (!round.pending) {
              throw new Error("API 视频任务已结束但未返回视频");
            }
          }
          throw new Error("API 视频任务轮询超时（约 10 分钟）—— 可稍后重试");
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
  }, [busy, kind, mode, selectedModel, values]);

  return {
    candidates,
    kind,
    error,
    generating: busy.busy,
    adapters,
    mode,
    generate,
    loading: configQ.isLoading,
    selectedModel,
    setInputFromFile,
    setKind,
    setMode: setModeState,
    selectModel,
    patchValue,
    result,
    values,
  };
}
