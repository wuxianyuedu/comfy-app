"use client";

// ── 工坊「测试模型能力」：逻辑层（规范 17 §17.2 第②层）──────────────────────
// 候选模型来自设置页配置（configGet），适配器来自「模型适配」注册表；
// 生成动作走**工坊同款通道**（generation-client 的 apiGenerateImage /
// apiSubmitVideo / apiPollVideo —— 远端模型按 remoteModel 表 + 适配器直连）。
// 视图（ModelTestView）只渲染 + 上抛，不出现 fetch / api.*。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { readFileAsDataUrl } from "~/lib/file-io";
import { runAsyncAction } from "~/lib/async-action";
import { sleep } from "~/lib/with-timeout";
import { isRecord } from "~/lib/is-record";
import { useBusyAction } from "~/components/ui/use-busy-action";
import { useExternalAction } from "~/components/ui/use-external-action";
import {
  apiGenerateImage,
  apiPollVideo,
  apiPreviewRequest,
  apiSubmitVideo,
  type RelayDebugSink,
} from "~/lib/workshop/generation-client";
import { debugBodyOf } from "~/lib/workshop/api-channel-core";
import type { ApiCallDebugRow } from "~/lib/workshop/api-channel-core";
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
  /** 追加若干张参考图（读成 data URL 后落组；上限 8 张）。 */
  addReferenceImages: (files: Array<File>) => Promise<void>;
  /** 取消本轮生成（#3949 需求 5）：中断等待与轮询，界面落「已取消生成」。 */
  cancelGenerate: () => void;
  /** 候选模型（当前 kind 下启用的远端条目，再按当前模式收窄：
   *  只列配了该模式适配器的模型 —— 不支持这个模式的不出现在下拉里）。 */
  candidates: Array<TestCandidate>;
  /** 最近一次生成的请求读数（ISSUE #3791）：端点 / 请求体 / 状态 / 耗时 /
   *  响应摘要，成功与失败都收集；新一轮生成前清空。 */
  debugRows: Array<ApiCallDebugRow>;
  /** 一次测试的失败文案（空 = 没失败）。 */
  error: string | null;
  /** 生成动作：按适配器映射收集统一输入并发起一次真实调用（消耗额度）。 */
  generate: () => Promise<void>;
  /** 忙碌位：提交 / 轮询进行中。 */
  generating: boolean;
  /** 本轮生成发起的时刻（ms；null = 不在生成中）：请求详情面板的已过时间按它走秒。 */
  generatingSince: number | null;
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
  /** 外部动作的反馈位（如「已交给系统浏览器打开」）：下一次动作或重置时清除。 */
  notice: { kind: "ok" | "err"; text: string } | null;
  /** 外链动作忙碌位（打开中禁用按钮）。 */
  openBusy: boolean;
  /** 用系统默认浏览器打开产物原链（ISSUE #3791）—— 桌面壳内 target=_blank
   *  外链会被壳的 shell ACL 拦下，统一走服务端 openExternal（免重编壳）。 */
  openResultInBrowser: (url: string) => Promise<void>;
  /** 局部更新表单值（文本 / 档位）。 */
  patchValue: (type: keyof ModelTestValues, value: string) => void;
  /** 批量更新表单值（尺寸下拉一次写回四个键）。 */
  patchValues: (patch: Partial<ModelTestValues>) => void;
  /** 生成前的「准备请求」读数（#3949 需求 8）：按当前 模式 / 模型 / 输入 走
   *  服务端 dry-run 现算的**实际上游请求**（端点 + 适配器翻译后的请求体），
   *  点生成前就显示；生成开始后让位给真实读数（debugRows）。 */
  previewRows: Array<ApiCallDebugRow>;
  /** 提示词随机按钮（ISSUE #3742）：从常用样本里随机填一条。 */
  randomizePrompt: () => void;
  /** 参考图组（#3949 需求 6/7）：契约口 reference-image 的多张取值（data URL）。 */
  referenceImages: Array<string>;
  /** 移除第 `index` 张参考图。 */
  removeReferenceImage: (index: number) => void;
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

/** 参考图组（#3949 需求 6/7）的子 hook：多张取值（data URL）+ 追加 / 移除 /
 *  清空。从主 hook 拆出（规范 §12.13：useModelTest 越过函数长度硬闸前的第一刀）。 */
function useReferenceImageGroup(onError: (text: string) => void): {
  add: (files: Array<File>) => Promise<void>;
  images: Array<string>;
  remove: (index: number) => void;
  reset: () => void;
} {
  const [images, setImages] = useState<Array<string>>([]);
  const add = useCallback(
    async (files: Array<File>) => {
      await runAsyncAction(
        async () => {
          const urls: Array<string> = [];
          for (const file of files) {
            // oxlint-disable-next-line no-await-in-loop -- 顺序读文件，失败即停
            urls.push(await readFileAsDataUrl(file));
          }
          /* 上限 8 张：与 relay 侧的宽松界一致。 */
          setImages((prev) => [...prev, ...urls].slice(0, 8));
          return { ok: true as const };
        },
        {
          report: (k, text) => {
            if (k === "err") {
              onError(text);
            }
          },
          failureText: "读取参考图失败",
        },
      );
    },
    [onError],
  );
  const remove = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);
  const reset = useCallback(() => {
    setImages([]);
  }, []);
  return { add, images, remove, reset };
}

/** 视频任务的轮询循环（#3949 需求 5 起带取消信号）：3s 一轮 / 10 分钟上限，
 *  与 VideoStudio 同一节奏。用户 abort 后下一轮立即以「已取消生成」落定。 */
async function pollVideoUntilDone(args: {
  mode: string;
  model: string;
  onDebug: RelayDebugSink;
  signal: AbortSignal;
  taskId: string;
}): Promise<{ kind: "video"; url: string }> {
  const deadline = Date.now() + POLL_DEADLINE_MS;
  while (Date.now() < deadline) {
    if (args.signal.aborted) {
      throw new Error("已取消生成");
    }
    // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一轮轮询用前一轮的结果
    await sleep(POLL_INTERVAL_MS);
    if (args.signal.aborted) {
      throw new Error("已取消生成");
    }
    // oxlint-disable-next-line no-await-in-loop -- 同上
    const round = await apiPollVideo(args.taskId, {
      debug: true,
      mode: args.mode,
      model: args.model,
      onDebug: args.onDebug,
      signal: args.signal,
    });
    if (round.url !== undefined && round.url !== "") {
      return { kind: "video", url: round.url };
    }
    if (!round.pending) {
      throw new Error("API 视频任务已结束但未返回视频");
    }
  }
  throw new Error("API 视频任务轮询超时（约 10 分钟）—— 可稍后重试");
}

/** 请求体组装的唯一入口（#3949 需求 8）：本地提交行、生成前预览、真实调用
 *  三处共用同一份组装结果 —— 三处各拼一套必然漂移。 */
function buildRequestBodies(input: {
  kind: ModelTestKind;
  mode: string;
  model: string;
  referenceImages: Array<string>;
  values: ModelTestValues;
}): {
  imageBody: ReturnType<typeof assembleImageRequest> | null;
  videoBody: ReturnType<typeof assembleVideoRequest> | null;
} {
  return {
    imageBody:
      input.kind === "image"
        ? assembleImageRequest({
            mode: input.mode,
            model: input.model,
            referenceImages: input.referenceImages,
            values: input.values,
          })
        : null,
    videoBody:
      input.kind === "video"
        ? assembleVideoRequest({ mode: input.mode, model: input.model, values: input.values })
        : null,
  };
}

/** 本地提交 / 生成前预览共用的那一行请求读数（端点固定为 relay）。
 *  形状同 `ApiCallDebugRow`（ISSUE #3791 / #3949 需求 8）。 */
function relayDebugRow(kind: ModelTestKind, body: Record<string, unknown>): ApiCallDebugRow {
  return {
    body: debugBodyOf({ kind, debug: true, ...body }),
    durationMs: null,
    endpoint: "/api/workshop-api/generate",
    excerpt: null,
    ok: true,
    phase: "relay",
    status: null,
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

/** 生成前的「准备请求」读数子 hook（#3949 需求 8）：按当前 模式 / 模型 / 输入
 *  走服务端 dry-run 现算**实际上游请求**（端点 + 适配器翻译后的请求体），
 *  点生成前就显示；点生成后由真实读数（debugRows）接棒。600ms 去抖 + 序号
 *  守卫：慢响应不覆盖新一轮的读数。从主 hook 拆出（§12.13 函数长度硬闸）。 */
function useRequestPreview(args: {
  buildBodies: () => ReturnType<typeof buildRequestBodies>;
  busy: boolean;
  debugRowCount: number;
  /** 预览失败的出口（如「模型没有可用接口地址」）——与生成失败同一反馈位。 */
  onError: (text: string) => void;
  selectedModel: string;
}): Array<ApiCallDebugRow> {
  const { busy, buildBodies, debugRowCount, onError, selectedModel } = args;
  const [previewRows, setPreviewRows] = useState<Array<ApiCallDebugRow>>([]);
  const seqRef = useRef(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (busy || selectedModel === "" || debugRowCount > 0) {
        setPreviewRows([]);
        return;
      }
      const seq = ++seqRef.current;
      const { imageBody, videoBody } = buildBodies();
      const relayBody = imageBody ?? videoBody ?? {};
      void runAsyncAction(
        async () => {
          const rows = await apiPreviewRequest(relayBody);
          if (seqRef.current === seq) {
            setPreviewRows(rows);
          }
          return { ok: true as const };
        },
        {
          report: (kind, text) => {
            if (kind === "err") {
              onError(text);
            }
          },
          failureText: "请求预览失败",
        },
      );
    }, 600);
    return () => {
      clearTimeout(timer);
    };
  }, [busy, buildBodies, debugRowCount, onError, selectedModel]);
  return previewRows;
}

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
  /* 请求读数（ISSUE #3791）：由 onDebug 逐批追加，新一轮生成前清空。 */
  const [debugRows, setDebugRows] = useState<Array<ApiCallDebugRow>>([]);
  const [generatingSince, setGeneratingSince] = useState<number | null>(null);
  /* 参考图组（#3949 需求 6/7）与取消句柄（#3949 需求 5）：各自拆到子 hook /
   * 模块级函数（§12.13）。 */
  const referenceGroup = useReferenceImageGroup((text) => {
    setError(text);
  });
  const cancelRef = useRef<AbortController | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const busy = useBusyAction();

  /* 产物原链交给系统浏览器（服务端 openExternal；免重编壳，#3791）。 */
  const openExternalM = useMutation(trpc.setting.openExternal.mutationOptions());
  const openExternalAction = useExternalAction({
    target: "browser",
    report: (kind, text) => {
      setNotice({ kind, text });
    },
  });
  const openResultInBrowser = useCallback(
    async (url: string) => {
      await openExternalAction.runWithTarget(url, (target) =>
        openExternalM.mutateAsync({ url: target }),
      );
    },
    [openExternalAction, openExternalM],
  );

  /* 请求读数的稳定追加器： RelayDebugSink 直接当 onDebug 用。 */
  const appendDebug = useCallback<RelayDebugSink>((rows) => {
    if (rows.length > 0) {
      setDebugRows((prev) => [...prev, ...rows]);
    }
  }, []);

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

  const setKind = useCallback(
    (next: ModelTestKind) => {
      setKindState(next);
      setSelectedModel("");
      const nextMode = defaultModeForKind(next);
      setModeState(nextMode);
      setValues(defaultSizeValues(nextMode));
      setResult(null);
      setError(null);
      /* 请求详情按模式 / 模型隔离（#3949 需求 8）：切走后上一份读数是干扰信息。 */
      setDebugRows([]);
      referenceGroup.reset();
    },
    [referenceGroup],
  );

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
      /* 请求详情按模式隔离（#3949 需求 8）：不残留上一个模式的读数。 */
      setDebugRows([]);
      referenceGroup.reset();
    },
    [adaptersByModelQ.data, referenceGroup, selectedModel],
  );

  const selectModel = useCallback(
    (name: string) => {
      setSelectedModel(name);
      /* 换模型重填输入，但尺寸保留默认档（ISSUE #3742）：表单一次成立。 */
      setValues(defaultSizeValues(mode));
      setResult(null);
      setError(null);
      /* 请求详情按模型隔离（#3949 需求 8）：不残留上一个模型的读数。 */
      setDebugRows([]);
      referenceGroup.reset();
    },
    [mode, referenceGroup],
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

  const addReferenceImages = useCallback(
    (files: Array<File>) => referenceGroup.add(files),
    [referenceGroup],
  );

  const removeReferenceImage = useCallback(
    (index: number) => {
      referenceGroup.remove(index);
    },
    [referenceGroup],
  );

  /* 请求体组装的唯一入口：本地提交行、生成前预览、真实调用三处共用同一份
   * 组装结果（#3949 需求 8 —— 三处各拼一套必然漂移）。 */
  const buildBodies = useCallback(
    () =>
      buildRequestBodies({
        kind,
        mode,
        model: selectedModel,
        referenceImages: referenceGroup.images,
        values,
      }),
    [kind, mode, referenceGroup.images, selectedModel, values],
  );

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
    /* 本地提交行（ISSUE #3799）：点生成立即显示本次要发的请求（relay 端点 +
     * 组装好的统一输入体，长值截断），不等生成结束；上游读数回来后追加在它
     * 后面。 */
    const { imageBody, videoBody } = buildBodies();
    const relayBody = imageBody ?? videoBody ?? {};
    const localRow = relayDebugRow(kind, relayBody);
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
    inputRows,
    kind,
    mode,
    referenceGroup.images,
    selectedModel,
    values,
  ]);

  /** 取消本轮生成（#3949 需求 5）：中止等待与轮询，错误条落「已取消生成」。 */
  const cancelGenerate = useCallback(() => {
    cancelRef.current?.abort();
  }, []);

  /** 预览失败的出口（与生成失败同一反馈位；#3637 失败必须可见）。 */
  const showPreviewError = useCallback((text: string) => {
    setNotice({ kind: "err", text });
  }, []);
  /* 生成前的「准备请求」读数（#3949 需求 8）：子 hook 里走服务端 dry-run，
   * 按当前 模式 / 模型 / 输入 现算**实际上游请求**；点生成后由真实读数接棒。 */
  const previewRows = useRequestPreview({
    buildBodies,
    busy: busy.busy,
    debugRowCount: debugRows.length,
    onError: showPreviewError,
    selectedModel,
  });

  return {
    candidates: modeCandidates,
    debugRows,
    kindCandidateCount,
    inputRows,
    kind,
    error,
    generating: busy.busy,
    generatingSince,
    cancelGenerate,
    referenceImages: referenceGroup.images,
    addReferenceImages,
    removeReferenceImage,
    previewRows,
    adapters,
    mode,
    modeTabs,
    notice,
    generate,
    openBusy: openExternalAction.busy,
    openResultInBrowser,
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
