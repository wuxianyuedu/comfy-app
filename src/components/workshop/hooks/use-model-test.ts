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
import { isRecord } from "~/lib/is-record";
import { useBusyAction } from "~/components/ui/use-busy-action";
import { useExternalAction } from "~/components/ui/use-external-action";
import {
  apiPreviewRequest,
  fetchWorkshopWorkflows,
  type RelayDebugSink,
  type WorkshopWorkflowOption,
} from "~/lib/workshop/generation-client";
import { debugBodyOf } from "~/lib/workshop/api-channel-core";
import type { ApiCallDebugRow } from "~/lib/workshop/api-channel-core";
import { parseRemoteModeAdapters } from "~/lib/workshop/remote-model-adapter";
import type { RemoteModeAdapter } from "~/lib/workshop/remote-model-adapter";

import { useModelTestGenerate, type ModelTestResult } from "./use-model-test-generate";
import { useReferenceImageGroup } from "./use-reference-image-group";

import { useTRPC } from "~/trpc/react";

import {
  buildRequestBodies,
  candidateValue,
  contractTestRows,
  defaultModeForKind,
  defaultSizeValues,
  modeTabsForKind,
  randomPromptFor,
  relayDebugRow,
  testCandidatesForKind,
  workflowSupportsMode,
  type AdaptersByModel,
  type ModelTestInputRow,
  type ModelTestKind,
  type ModelTestValues,
  type ModeTab,
  type TestCandidate,
} from "../model-test-config";

/** 空适配器索引的稳定引用：查询数据未到时兜底，让 useMemo 依赖不逐渲染变化。 */
const EMPTY_ADAPTERS_BY_MODEL: AdaptersByModel = {};

/** 一次测试的结果（工坊同款输出：图片 URL / 视频 URL / 对话回复文本）。
 *  定义住在 use-model-test-generate（生成动作的产物类型），这里再导出。 */
export type { ModelTestResult };

export type ModelTestController = {
  /** 选中模型的适配器草稿（workshopAdaptersGet 的解析结果）。 */
  adapters: Array<RemoteModeAdapter>;
  /** 追加若干张参考图（读成 data URL 后落组；上限 8 张）。 */
  addReferenceImages: (files: Array<File>) => Promise<void>;
  /** 取消本轮生成（#3949 需求 5）：中断等待与轮询，界面落「已取消生成」。 */
  cancelGenerate: () => void;
  /** 候选模型（当前 kind 下的候选，再按当前模式收窄：远端只列配了该模式
   *  适配器的模型；工作流候选（#4080 评论 4）按 modes 声明判支持）。 */
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
   *  点生成前就显示；生成开始后让位给真实读数（debugRows）。
   *  #3995：首行是「本地提交」行（与点生成那一步同一份组装）—— 未点生成
   *  也能同时看到「本地提交 + 实际请求」两部分。 */
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
  /** 选中的工作流候选（#4080 评论 4）；null = 选中的是远端 / Ollama 模型或未选。 */
  selectedWorkflow: WorkshopWorkflowOption | null;
  selectModel: (name: string) => void;
  /** 图片输入行选完文件后由视图调用：读成 data URL 存进表单值。 */
  setInputFromFile: (type: "first-frame" | "image", file: File) => Promise<void>;
  /** 切换用途页签（候选 / 选中 / 表单随之重置）。 */
  setKind: (kind: ModelTestKind) => void;
  setMode: (mode: string) => void;
  values: ModelTestValues;
  /** 本地工作流任务的进度（SSE state 帧；仅工作流候选生成中非空）。 */
  workflowProgress: { label?: string; pct: number } | null;
};

/** 生成前的「准备请求」读数子 hook（#3949 需求 8）：按当前 模式 / 模型 / 输入
 *  走服务端 dry-run 现算**实际上游请求**（端点 + 适配器翻译后的请求体），
 *  点生成前就显示；点生成后由真实读数（debugRows）接棒。600ms 去抖 + 序号
 *  守卫：慢响应不覆盖新一轮的读数。从主 hook 拆出（§12.13 函数长度硬闸）。 */
function useRequestPreview(args: {
  buildBodies: () => ReturnType<typeof buildRequestBodies>;
  busy: boolean;
  debugRowCount: number;
  /** 预览也要按用途分流（#4080）：对话测试不走图片/视频的 dry-run 预览。 */
  kind: ModelTestKind;
  /** 预览失败的出口（如「模型没有可用接口地址」）——与生成失败同一反馈位。 */
  onError: (text: string) => void;
  selectedModel: string;
  /** 选中工作流候选（#4080 评论 4）时跳过：dry-run 是 API 中继的预演，
   *  本地通道没有这一步（提交行已由 localPreviewRow 给出）。 */
  skip: boolean;
}): Array<ApiCallDebugRow> {
  const { busy, buildBodies, debugRowCount, kind, onError, selectedModel, skip } = args;
  const [previewRows, setPreviewRows] = useState<Array<ApiCallDebugRow>>([]);
  const seqRef = useRef(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (busy || kind === "chat" || skip || selectedModel === "" || debugRowCount > 0) {
        setPreviewRows([]);
        return;
      }
      const seq = ++seqRef.current;
      const { imageBody, videoBody } = buildBodies();
      const relayBody = imageBody ?? videoBody ?? {};
      void runAsyncAction(
        async () => {
          const rows = await apiPreviewRequest(relayBody, kind);
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
  }, [busy, buildBodies, debugRowCount, onError, selectedModel, kind, skip]);
  return previewRows;
}

/** 候选 / 契约 / 适配器索引的取数与派生（§12.13 第二刀）：这一簇只读
 *  configGet / modeContractsGet / workshopAdaptersGet 与工作流列表四份读数做
 *  派生，主 hook（useModelTest）只留表单状态与动作。 */
function useTestCatalog(args: {
  kind: ModelTestKind;
  mode: string;
  selectedModel: string;
  trpc: ReturnType<typeof useTRPC>;
}): {
  adapters: Array<RemoteModeAdapter>;
  adaptersByModel: AdaptersByModel | undefined;
  candidates: Array<TestCandidate>;
  contract: Parameters<typeof contractTestRows>[0];
  inputRows: Array<ModelTestInputRow>;
  kindCandidateCount: number;
  loading: boolean;
  modeCandidates: Array<TestCandidate>;
  modeTabs: Array<ModeTab>;
  selectedCandidate: TestCandidate | null;
} {
  const { kind, mode, selectedModel, trpc } = args;
  const queryClient = useQueryClient();
  const configQ = useQuery(trpc.llm.configGet.queryOptions());
  /* 设置页配置的候选（extraModels：字符串 = 本地 Ollama，对象 = 远端模型）。 */
  const configuredCandidates = useMemo<Array<TestCandidate>>(() => {
    const raw: unknown = configQ.data?.config;
    if (!isRecord(raw) || !Array.isArray(raw.extraModels)) {
      return [];
    }
    const out: Array<TestCandidate> = [];
    for (const item of raw.extraModels) {
      /* 字符串条目 = 本地 Ollama 候选（#4080）：没有 baseUrl / kind，只能做
       * 对话测试 —— 按 local 候选进入下拉的「本地模型」分组。 */
      if (typeof item === "string") {
        out.push({ name: item, kind: "chat", baseUrl: null, local: true });
        continue;
      }
      if (!isRecord(item)) {
        continue;
      }
      out.push({
        name: typeof item.name === "string" ? item.name : "",
        kind: typeof item.kind === "string" ? item.kind : "",
        baseUrl: typeof item.baseUrl === "string" ? item.baseUrl : null,
        local: false,
      });
    }
    return out;
  }, [configQ.data]);

  /* 工作流提供的图片 / 视频模型（#4080 评论 4）：工作流库条目是「本地模型」
   * 的第二种形态。与工坊「生成资源」下拉同一份来源（fetchWorkshopWorkflows）
   * —— 工坊里配置了哪些工作流，测试页就能测哪些，两处不会各说各话。 */
  const workflowsQ = useQuery({
    queryKey: ["workshop", "workflows", "model-test"],
    queryFn: fetchWorkshopWorkflows,
  });
  const workflowCandidates = useMemo<Array<TestCandidate>>(() => {
    if (kind === "chat") {
      return [];
    }
    return (workflowsQ.data ?? [])
      .filter((w) => w.category === kind)
      .map((w) => ({ baseUrl: null, kind, local: true, name: w.name, workflow: w }));
  }, [workflowsQ.data, kind]);

  const candidates = useMemo(
    () => testCandidatesForKind(kind, [...configuredCandidates, ...workflowCandidates]),
    [configuredCandidates, workflowCandidates, kind],
  );

  /* 选中的候选：下拉的取值空间是「模型名 / wf::<工作流id>」（candidateValue）。 */
  const selectedCandidate = useMemo<TestCandidate | null>(
    () => candidates.find((c) => candidateValue(c) === selectedModel) ?? null,
    [candidates, selectedModel],
  );

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
   * 集合。工作流候选（#4080 评论 4）按本地 ComfyUI 通道的承接集合判「未承接」，
   * 远端候选按 API 中继的集合。契约读数未到时退兜底行，表单不至于闪空。 */
  const inputRows = useMemo<Array<ModelTestInputRow>>(
    () =>
      contractTestRows(contract, kind, selectedCandidate?.workflow === undefined ? "api" : "local"),
    [contract, kind, selectedCandidate],
  );

  const kindCandidateCount = candidates.length;

  const candidateNames = useMemo(
    () => candidates.filter((c) => c.workflow === undefined).map((c) => c.name),
    [candidates],
  );

  /* 全部候选的适配器（#3635：左栏每个模式页签要显示「配了几个可用模型」）。
   * 候选是设置页配置的少量条目，并行逐个取已配适配器即可，不为此新增批量端点。
   * 工作流候选没有适配器，不参与这批查询（它的模式支持看 modes 声明）。 */
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
    () =>
      modeTabsForKind(
        kind,
        adaptersByModelQ.data ?? EMPTY_ADAPTERS_BY_MODEL,
        workflowCandidates.flatMap((c) => (c.workflow === undefined ? [] : [c.workflow])),
      ),
    [kind, adaptersByModelQ.data, workflowCandidates],
  );

  /* 模式收窄（ISSUE #3778 问题 3）：远端候选只保留配了当前模式适配器的 ——
   * 左栏页签徽标的「N 模型」与下拉是同一份读数，页签说 0 模型时下拉不再出现
   * 不支持该模式的模型。适配器索引未到时远端候选先不收窄（避免下拉先空后跳）。
   * 工作流候选（#4080 评论 4）按 modes / taskType 的**声明**判模式支持 ——
   * 模式码是工坊与库之间唯一的生成模式判据，不从内容类别反推。
   * 对话没有「模式」维度（#4080）：本地 / 远端候选都不做收窄。 */
  const modeCandidates = useMemo<Array<TestCandidate>>(() => {
    if (kind === "chat") {
      return candidates;
    }
    const byModel = adaptersByModelQ.data;
    return candidates.filter((c) => {
      if (c.workflow !== undefined) {
        return workflowSupportsMode(c.workflow, mode);
      }
      if (byModel === undefined) {
        return true;
      }
      return (byModel[c.name] ?? []).some((a) => a.mode === mode);
    });
  }, [candidates, adaptersByModelQ.data, mode, kind]);

  const adaptersQ = useQuery(
    trpc.llm.workshopAdaptersGet.queryOptions(
      { name: selectedModel },
      /* 工作流候选没有适配器（#4080 评论 4）：不去按「模型名」查适配器。 */
      { enabled: selectedModel !== "" && selectedCandidate?.workflow === undefined },
    ),
  );
  const adapters = useMemo(
    () => parseRemoteModeAdapters(adaptersQ.data?.adapters ?? []),
    [adaptersQ.data],
  );

  return {
    adapters,
    adaptersByModel: adaptersByModelQ.data,
    candidates,
    contract,
    inputRows,
    kindCandidateCount,
    loading: configQ.isLoading || workflowsQ.isLoading,
    modeCandidates,
    modeTabs,
    selectedCandidate,
  };
}

export function useModelTest(): ModelTestController {
  const trpc = useTRPC();
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
  /* 本地工作流任务的进度（#4080 评论 4）：SSE state 帧，整百分比变化才更新。 */
  const [workflowProgress, setWorkflowProgress] = useState<{
    label?: string;
    pct: number;
  } | null>(null);
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
  /* 对话测试（#4080）：向本地 / 远端被测模型发一条提示词，返回补全与耗时。 */
  const chatTestM = useMutation(trpc.llm.chatTest.mutationOptions());
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

  /* 候选 / 契约 / 适配器索引：取数与派生收在 useTestCatalog（§12.13 第二刀）。 */
  const {
    adapters,
    adaptersByModel,
    contract,
    inputRows,
    kindCandidateCount,
    loading,
    modeCandidates,
    modeTabs,
    selectedCandidate,
  } = useTestCatalog({ kind, mode, selectedModel, trpc });

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
      setWorkflowProgress(null);
      referenceGroup.reset();
    },
    [referenceGroup],
  );

  const setMode = useCallback(
    (next: string) => {
      setModeState(next);
      /* 模式收窄后，当前选中的模型可能不支持新模式 → 清掉选择，让下拉回到
       * 占位态，而不是留着「测的不是这个模式」的选中。工作流候选（#4080
       * 评论 4）按 modes 声明判支持；远端候选按适配器判。 */
      if (selectedCandidate?.workflow !== undefined) {
        if (!workflowSupportsMode(selectedCandidate.workflow, next)) {
          setSelectedModel("");
        }
      } else if (selectedModel !== "") {
        const supports = adaptersByModel?.[selectedModel]?.some((a) => a.mode === next) ?? false;
        if (!supports) {
          setSelectedModel("");
        }
      }
      setResult(null);
      setError(null);
      /* 请求详情按模式隔离（#3949 需求 8）：不残留上一个模式的读数。 */
      setDebugRows([]);
      setWorkflowProgress(null);
      referenceGroup.reset();
    },
    [adaptersByModel, referenceGroup, selectedCandidate, selectedModel],
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
      setWorkflowProgress(null);
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

  /* 生成 / 取消动作（对话 #4080 / 本地工作流 #4080 评论 4 / 图片视频中继三
   * 条通道的编排）收在 useModelTestGenerate（§12.13 拆分），只编排不另判。 */
  const { cancelGenerate, generate } = useModelTestGenerate({
    appendDebug,
    buildBodies,
    busy,
    cancelRef,
    chatTestM,
    contract,
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
  });

  /** 预览失败的出口（与生成失败同一反馈位；#3637 失败必须可见）。 */
  const showPreviewError = useCallback((text: string) => {
    setNotice({ kind: "err", text });
  }, []);
  /* 生成前的「准备请求」读数（#3949 需求 8）：子 hook 里走服务端 dry-run，
   * 按当前 模式 / 模型 / 输入 现算**实际上游请求**；点生成后由真实读数接棒。
   * 工作流候选（#4080 评论 4）跳过 —— dry-run 是 API 中继的预演，本地通道
   * 没有这一步。 */
  const upstreamPreviewRows = useRequestPreview({
    buildBodies,
    busy: busy.busy,
    debugRowCount: debugRows.length,
    kind,
    onError: showPreviewError,
    selectedModel,
    skip: selectedCandidate?.workflow !== undefined,
  });
  /* 生成前的「本地提交」行（ISSUE #3995）：与点生成那一步同一份组装
   * （buildBodies + relayDebugRow，两处各拼一套必然漂移），未点生成也先给
   * 出来 —— 请求详情面板在生成前就同时可见「本地提交 + 实际请求」两部分。
   * 未选模型时不给（没有可提交的对象）。 */
  const localPreviewRow = useMemo(() => {
    if (selectedModel === "") {
      return null;
    }
    /* 工作流候选（#4080 评论 4）：本地提交行描述的是本地任务（工作流 + 模式
     * + 提示词），没有 relay 请求体可组装。 */
    const workflow = selectedCandidate?.workflow;
    if (workflow !== undefined) {
      return {
        body: debugBodyOf({
          kind,
          debug: true,
          workflow: workflow.name,
          mode,
          prompt: values.prompt?.trim() ?? "",
        }),
        durationMs: null,
        endpoint: "generate.generate（本地 ComfyUI）",
        excerpt: null,
        ok: true,
        phase: "relay" as const,
        status: null,
      };
    }
    const { imageBody, videoBody } = buildBodies();
    return relayDebugRow(kind, imageBody ?? videoBody ?? {});
  }, [buildBodies, kind, mode, selectedCandidate, selectedModel, values.prompt]);
  const previewRows = useMemo(
    () =>
      localPreviewRow === null ? upstreamPreviewRows : [localPreviewRow, ...upstreamPreviewRows],
    [localPreviewRow, upstreamPreviewRows],
  );

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
    loading,
    selectedModel,
    selectedWorkflow: selectedCandidate?.workflow ?? null,
    workflowProgress,
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
