"use client";

// ── 工坊「测试模型能力」：逻辑层（规范 17 §17.2 第②层）──────────────────────
// 候选模型来自设置页配置（configGet），适配器来自「模型适配」注册表；
// 生成动作走**工坊同款通道**（generation-client 的 apiGenerateImage /
// apiSubmitVideo / apiPollVideo —— 远端模型按 remoteModel 表 + 适配器直连）。
// 视图（ModelTestView）只渲染 + 上抛，不出现 fetch / api.*。

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

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
  contractTestRows,
  defaultModeForKind,
  defaultSizeValues,
  modeTabsForKind,
  randomPromptFor,
  testCandidatesForKind,
  type AdaptersByModel,
  type ModelTestInputRow,
  type ModelTestKind,
  type ModelTestValues,
  type ModeTab,
  type TestCandidate,
} from "../model-test-config";

/** 视频任务轮询：与 VideoStudio 同一节奏（3s 一轮 / 10 分钟上限）。 */
const POLL_INTERVAL_MS = 3000;
const POLL_DEADLINE_MS = 600_000;

/** 空适配器索引的稳定引用：查询数据未到时兜底，让 useMemo 依赖不逐渲染变化。 */
const EMPTY_ADAPTERS_BY_MODEL: AdaptersByModel = {};

/** 一次测试的结果（工坊同款输出：图片 URL / 视频 URL）。 */
export type ModelTestResult =
  | { kind: "image"; url: string }
  | { kind: "video"; url: string }
  | null;

export type ModelTestController = {
  /** 选中模型的适配器草稿（workshopAdaptersGet 的解析结果）。 */
  adapters: Array<RemoteModeAdapter>;
  /** 候选模型（当前 kind 下启用的远端条目，再按当前模式收窄：
   *  只列配了该模式适配器的模型 —— 不支持这个模式的不出现在下拉里）。 */
  candidates: Array<TestCandidate>;
  /** 一次测试的失败文案（空 = 没失败）。 */
  error: string | null;
  /** 生成动作：按适配器映射收集统一输入并发起一次真实调用（消耗额度）。 */
  generate: () => Promise<void>;
  /** 忙碌位：提交 / 轮询进行中。 */
  generating: boolean;
  /** 统一输入行清单（ISSUE #3778：来自当前模式契约，带必备标记与承接状态）。 */
  inputRows: Array<ModelTestInputRow>;
  /** 当前用途（图片 / 视频页签）。 */
  kind: ModelTestKind;
  /** 按用途过滤（未按模式收窄）的候选数：区分「这个用途没模型」与
   *  「这个模式没模型」两种空态用。 */
  kindCandidateCount: number;
  /** 适配器查询 / 候选读取的加载态。 */
  loading: boolean;
  /** 当前生效的模式码（左栏页签选中项；"" = 尚未落到任何模式）。 */
  mode: string;
  /** 左栏「所有模式」页签：当前用途的全部生成类模式 + 各自配了适配器的候选数。 */
  modeTabs: Array<ModeTab>;
  /** 局部更新表单值（文本 / 档位）。 */
  patchValue: (type: keyof ModelTestValues, value: string) => void;
  /** 批量更新表单值（尺寸下拉一次写回四个键）。 */
  patchValues: (patch: Partial<ModelTestValues>) => void;
  /** 提示词随机按钮（ISSUE #3742）：从常用样本里随机填一条。 */
  randomizePrompt: () => void;
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
  const queryClient = useQueryClient();
  const configQ = useQuery(trpc.llm.configGet.queryOptions());
  const [kind, setKindState] = useState<ModelTestKind>("image");
  const [selectedModel, setSelectedModel] = useState("");
  /* 模式由左栏页签直接选定（#3635）：初值与切用途时的重置都取该用途的
   * 第一个生成类模式，不再从「选中模型的适配器」里播种 —— 模式是用户
   * 先选的入口，模型是其后在下拉里挑的具体执行者。 */
  const [mode, setModeState] = useState(() => defaultModeForKind("image"));
  /* 尺寸带默认档（ISSUE #3742）：表单一打开就是最常用的 1:1 + 1K，触发器
   * 常显摘要而不是「可选」占位。 */
  const [values, setValues] = useState<ModelTestValues>(() =>
    defaultSizeValues(defaultModeForKind("image")),
  );
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

  /* 模式契约（ISSUE #3778：统一输入行来自这里，不再来自适配器映射）。
   * 注册表是服务端合好的生效值（成品配置 + 本机覆盖），按模式取当前那份。 */
  const contractsQ = useQuery(trpc.llm.modeContractsGet.queryOptions());
  const contract = useMemo(() => {
    const rows = contractsQ.data?.contracts;
    if (!Array.isArray(rows)) {
      return null;
    }
    return rows.find((c) => c.mode === mode) ?? null;
  }, [contractsQ.data, mode]);

  /* 统一输入行：顺序 = 契约口的顺序；必备标记来自契约；承接状态来自通道
   * 集合。契约读数未到时退兜底行（通道默认集合），表单不至于闪空。 */
  const inputRows = useMemo<Array<ModelTestInputRow>>(
    () => contractTestRows(contract, kind),
    [contract, kind],
  );

  const kindCandidateCount = candidates.length;

  const candidateNames = useMemo(() => candidates.map((c) => c.name), [candidates]);

  /* 全部候选的适配器（#3635：左栏每个模式页签要显示「配了几个可用模型」）。
   * 候选是设置页配置的少量条目，并行逐个取已配适配器即可，不为此新增批量端点。 */
  const adaptersByModelQ = useQuery({
    queryKey: ["llm", "workshopAdaptersAll", candidateNames],
    queryFn: async (): Promise<AdaptersByModel> => {
      const entries = await Promise.all(
        candidateNames.map(async (name) => {
          const res = await queryClient.fetchQuery(
            trpc.llm.workshopAdaptersGet.queryOptions({ name }),
          );
          return [name, parseRemoteModeAdapters(res.adapters ?? [])] as const;
        }),
      );
      return Object.fromEntries(entries);
    },
    enabled: candidateNames.length > 0,
  });
  const modeTabs = useMemo<Array<ModeTab>>(
    () => modeTabsForKind(kind, adaptersByModelQ.data ?? EMPTY_ADAPTERS_BY_MODEL),
    [kind, adaptersByModelQ.data],
  );

  /* 模式收窄（ISSUE #3778 问题 3）：只保留配了当前模式适配器的候选 —— 左栏
   * 页签徽标的「N 模型」与下拉是同一份读数，页签说 0 模型时下拉不再出现
   * 不支持该模式的模型。适配器索引未到时不收窄（避免下拉先空后跳）。 */
  const modeCandidates = useMemo<Array<TestCandidate>>(() => {
    const byModel = adaptersByModelQ.data;
    if (byModel === undefined) {
      return candidates;
    }
    return candidates.filter((c) => (byModel[c.name] ?? []).some((a) => a.mode === mode));
  }, [candidates, adaptersByModelQ.data, mode]);

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

  const setKind = useCallback((next: ModelTestKind) => {
    setKindState(next);
    setSelectedModel("");
    const nextMode = defaultModeForKind(next);
    setModeState(nextMode);
    setValues(defaultSizeValues(nextMode));
    setResult(null);
    setError(null);
  }, []);

  const setMode = useCallback(
    (next: string) => {
      setModeState(next);
      /* 模式收窄后，当前选中的模型可能没配新模式的适配器（不支持该模式）
       * → 清掉选择，让下拉回到占位态，而不是留着「测的不是这个模式」的选中。 */
      if (selectedModel !== "") {
        const supports =
          adaptersByModelQ.data?.[selectedModel]?.some((a) => a.mode === next) ?? false;
        if (!supports) {
          setSelectedModel("");
        }
      }
      setResult(null);
      setError(null);
    },
    [adaptersByModelQ.data, selectedModel],
  );

  const selectModel = useCallback(
    (name: string) => {
      setSelectedModel(name);
      /* 换模型重填输入，但尺寸保留默认档（ISSUE #3742）：表单一次成立。 */
      setValues(defaultSizeValues(mode));
      setResult(null);
      setError(null);
    },
    [mode],
  );

  const patchValue = useCallback((type: keyof ModelTestValues, value: string) => {
    setValues((prev) => ({ ...prev, [type]: value }));
  }, []);

  /* 批量更新（尺寸下拉一次写回比例 / 百万像素 / 分辨率 / 倍数四个键）。 */
  const patchValues = useCallback((patch: Partial<ModelTestValues>) => {
    setValues((prev) => ({ ...prev, ...patch }));
  }, []);

  /* 提示词随机按钮（ISSUE #3742）：从常用样本里随机填一条。 */
  const randomizePrompt = useCallback(() => {
    setValues((prev) => ({ ...prev, prompt: randomPromptFor() }));
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
    /* 必备口校验（ISSUE #3778）：契约标了必备、通道又承接得住的行，空着就
     * 拦下 —— 与「必备 / 可选」标识同一份读数，别让用户点生成才被上游打回。 */
    const missing = inputRows
      .filter(
        (row) =>
          row.required &&
          !row.disabled &&
          row.valueKey !== null &&
          (values[row.valueKey]?.trim() ?? "") === "",
      )
      .map((row) => row.label);
    if (missing.length > 0) {
      setError(`请填写必备输入：${missing.join("、")}`);
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
  }, [busy, inputRows, kind, mode, selectedModel, values]);

  return {
    candidates: modeCandidates,
    kindCandidateCount,
    inputRows,
    kind,
    error,
    generating: busy.busy,
    adapters,
    mode,
    modeTabs,
    generate,
    loading: configQ.isLoading,
    selectedModel,
    setInputFromFile,
    setKind,
    setMode,
    selectModel,
    patchValue,
    patchValues,
    randomizePrompt,
    result,
    values,
  };
}
