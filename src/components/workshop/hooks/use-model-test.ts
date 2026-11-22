"use client";

// ── 工坊「测试模型能力」：逻辑层（规范 17 §17.2 第②层）──────────────────────
// 候选模型来自设置页配置（configGet）+ 工作流库（工作流提供的图片/视频模型，
// #4080 评论 4），适配器来自「模型适配」注册表；生成动作走**工坊同款通道**
// （对话 #4080 / 本地工作流 #4080 评论 4 / 图片视频中继）。
// 运行态按「用途 + 模式 + 模型」一格一份（ModelTestSession，#4080 评论 12）：
// 状态 / 请求读数 / 执行日志 / 产物互相隔离，切走再切回各看各的，不同模型
// 可以同时测试。视图（ModelTestView）只渲染 + 上抛，不出现 fetch / api.*。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { readFileAsDataUrl } from "~/lib/file-io";
import { runAsyncAction } from "~/lib/async-action";
import {
  chatFallbackGroupForCurrentModel,
  effectiveProviderType,
  isChatModelKind,
  splitExtraModels,
} from "~/lib/llm/types";
import { isRecord } from "~/lib/is-record";
import {
  fetchWorkshopWorkflows,
  type TaskLogEntry,
  type WorkshopWorkflowOption,
} from "~/lib/workshop/generation-client";
import { debugBodyOf } from "~/lib/workshop/api-channel-shared";
import type { ApiCallDebugRow } from "~/lib/workshop/api-channel-shared";
import { parseRemoteModeAdapters } from "~/lib/workshop/remote-model-adapter";
import type { RemoteModeAdapter } from "~/lib/workshop/remote-model-adapter";

import type { ModelTestRetryPayload } from "~/components/studio/history/history-detail-derive";
import {
  emptyModelTestSession,
  useModelTestGenerate,
  type ModelTestResult,
  type ModelTestSession,
} from "./use-model-test-generate";
import { useModelTestReprint } from "./use-model-test-reprint";
import { useRequestPreview } from "./use-model-test-request-preview";
import { useReferenceImageGroup } from "./use-reference-image-group";
import { useApplyJsonValues } from "./use-model-test-json";
import { useOpenResultInBrowser } from "./use-open-result-in-browser";

import { useTRPC } from "~/trpc/react";

import {
  buildRequestBodies,
  candidateLabel,
  candidateValue,
  contractTestRows,
  defaultModeForKind,
  defaultSizeValues,
  modeTabsForKind,
  pickWorkshopInputValues,
  randomPromptFor,
  relayDebugRow,
  summarizeGeneratingSessions,
  testCandidatesForKind,
  workflowPreviewBody,
  workflowSupportsMode,
  type AdaptersByModel,
  type ModelTestInputRow,
  type ModelTestKind,
  type ModelTestValues,
  type ModeTab,
  type TestCandidate,
} from "../model-test-config";
import { workflowModeDefaults } from "../model-test-defaults";

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
  /** 解析并应用一段 JSON（ISSUE #4769：历史「复制去重投」的载荷）。合法 →
   *  写回当前格表单值并返回合并后的值（调用方同一次点击里接着生成）；
   *  非法 → 错误落当前格反馈位，返回 ok:false。 */
  applyJsonValues: (
    json: string,
  ) => { ok: true; values: ModelTestValues } | { error: string; ok: false };
  /** 应用历史页「重试」的带参预填（#4841）：按任务模式切模式页签，能对上
   *  候选时预选同款工作流；契约口值进预填层。 */
  applyReprintPrefill: (payload: ModelTestRetryPayload) => void;
  /** 取消当前格（用途 + 模式 + 模型）的生成（#3949 需求 5 / #4080 评论 12）：
   *  中断等待与轮询，界面落「已取消生成」。 */
  cancelGenerate: (key?: string) => void;
  /** 下拉选项值 → 显示名（#4080 评论 17：工作流候选显示**模型名**——工作流上
   *  挂的模型标签；同一模型挂在多个工作流上时用工作流名消歧）。 */
  candidateLabels: Record<string, string>;
  /** 当前格的候选模型（按当前模式收窄：远端只列配了该模式适配器的；
   *  工作流候选按 modes 声明判支持）。 */
  candidates: Array<TestCandidate>;
  /** 最近一次生成的失败文案（空 = 没失败）。 */
  error: string | null;
  /** 生成动作：按适配器映射收集统一输入并发起一次真实调用（消耗额度）。
   *  不传 key = 测当前格。 */
  /** 发起一次真实生成。`valuesOverride`（ISSUE #4769）：JSON 输入模式解析出的
   *  表单值在同一次点击里直接进生成，不吃旧闭包。 */
  generate: (key?: string, valuesOverride?: ModelTestValues) => Promise<void>;
  /** 当前格是否在生成中。 */
  generating: boolean;
  /** 左栏「生成中」标记的读数（ISSUE #4838）：**全部格**聚合的生成中索引 ——
   *  用途页签 / 模式列表的计数与模型下拉的徽标都读它，不只当前格。 */
  generatingByKind: Record<ModelTestKind, number>;
  /** 键 = `${kind}::${mode}`，值 = 该模式下生成中的模型数。 */
  generatingByMode: Record<string, number>;
  /** 正在生成的模型取值集合（模型名或 `wf::<id>`）。 */
  generatingModels: ReadonlySet<string>;
  /** 当前格生成发起的时刻（ms；null = 不在生成中）：请求详情的已过时间按它走秒。 */
  generatingSince: number | null;
  /** 统一输入行清单（ISSUE #3778：来自当前模式契约，带必备标记与承接状态）。 */
  inputRows: Array<ModelTestInputRow>;
  /** 当前用途（图片 / 视频 / 对话页签）。 */
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
  /** 当前格的反馈位（如「已交给系统浏览器打开」）：下一次动作或重置时清除。 */
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
  /** 提示词随机按钮（ISSUE #3742）：从常用样本里随机填一条。 */
  randomizePrompt: () => void;
  /** 参考图组（#3949 需求 6/7）：契约口 reference-image 的多张取值（data URL）。 */
  referenceImages: Array<string>;
  /** 移除第 `index` 张参考图。 */
  removeReferenceImage: (index: number) => void;
  /** 历史页「重试」折好的预填载荷（#4841）：非 null 时统一输入表单显示的是
   *  它叠在默认档上的值，界面上亮出「预填自哪条任务」的提示；用户在任意输入
   *  上动手（改值 / 随机 / 贴 JSON / 选文件）后整份退场，恢复普通测试。 */
  reprintPrefill: ModelTestRetryPayload | null;
  /** 当前格的请求行：本地提交 + 实际请求（#3949 需求 8 / #3995 / 评论 13：
   *  生成后保留，仅徽标翻转）。 */
  requestRows: Array<ApiCallDebugRow>;
  /** 当前格的响应读数（真实调用回来了什么）：与「请求」分区显示
   *  （#4080 评论 13）。 */
  responseRows: Array<ApiCallDebugRow>;
  /** 最近一次成功产物（当前格）。 */
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
  /** 当前格本地工作流任务 id（入队后登记；null = 没有可看大屏的任务）。 */
  taskId: string | null;
  /** 当前格的执行日志（SSE log 帧，#4080 评论 8）。 */
  taskLogs: Array<TaskLogEntry>;
  values: ModelTestValues;
  /** 当前格本地工作流任务的进度（SSE state 帧；仅工作流候选生成中非空）。 */
  workflowProgress: { label?: string; pct: number } | null;
};

/** 候选 / 契约 / 适配器索引的取数与派生（§12.13 第二刀）：这一簇只读
 *  configGet / modeContractsGet / workshopAdaptersGet 与工作流列表四份读数做
 *  派生，主 hook（useModelTest）只留表单状态与动作。
 *  导出（#4834）：项目里各生成入口统一成测试模型的级联选择，候选装配与
 *  模式收窄的口径只有这一份（use-model-catalog 薄封装消费），不另立第二份。 */
export function useTestCatalog(args: {
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
  /** 工作流候选清单的查询是否已 settle（成功 / 失败）：重试预填的「预选同款
   *  工作流」等它到位再补，不能拿「已有若干候选」当就绪判据 —— 配置型候选
   *  先于工作流清单到达时，长度非空但工作流候选还缺。 */
  selectedCandidate: TestCandidate | null;
  workflowsReady: boolean;
} {
  const { kind, mode, selectedModel, trpc } = args;
  const queryClient = useQueryClient();
  const configQ = useQuery(trpc.llm.configGet.queryOptions());
  /* 设置页配置的候选（extraModels：字符串 = 本地 Ollama，对象 = 远端模型）。
   * 拆分与归一走 `splitExtraModels`（#4823）：与工坊下拉 / 设置页同一次实现，
   * kind 白名单、空名丢弃这些读边界口径在库里只有一个答案，本处不再手搓。 */
  const configuredCandidates = useMemo<Array<TestCandidate>>(() => {
    const raw: unknown = configQ.data?.config;
    if (!isRecord(raw) || !Array.isArray(raw.extraModels)) {
      return [];
    }
    const split = splitExtraModels(raw.extraModels);
    const pool: Array<TestCandidate> = [
      /* 字符串条目 = 本地 Ollama 候选（#4080）：没有 baseUrl / kind，只能做
       * 对话测试 —— 按 local 候选进入下拉的「本地模型」分组。 */
      ...split.localNames.map((name) => ({ name, kind: "chat", baseUrl: null, local: true })),
      ...split.remoteEntries.map((e) => ({
        name: e.name,
        kind: e.kind ?? "",
        baseUrl: e.baseUrl ?? null,
        local: false,
      })),
    ];
    /* 对话候选兜底（#4823）：设置页把「当前生效主模型」排除在 extraModels 外
     * （播种过滤 + 保存不并回），只设了主模型、没勾候选的单模型 Ollama 配置
     * 在这里会空态 —— 按生效提供方把主模型兜底归组，与工坊文本下拉同口径
     * （判据是共享纯函数 chatFallbackGroupForCurrentModel）。远端兜底候选要
     * 带上可解析的地址（条目自己的 → 全局 baseUrl），与既有「远端候选要求
     * baseUrl 非空」的过滤同一条理由。 */
    const model = typeof raw.model === "string" ? raw.model : "";
    const trimmed = model.trim();
    if (trimmed !== "") {
      const remoteEntry = split.remoteEntries.find((e) => e.name === trimmed);
      const fallbackGroup = chatFallbackGroupForCurrentModel({
        model,
        provider: effectiveProviderType(
          raw.provider === "remote" ? "remote" : "local",
          typeof raw.baseUrl === "string" ? raw.baseUrl : null,
          raw.hasApiKey === true,
        ),
        inChatCandidates:
          split.localNames.includes(trimmed) ||
          split.remoteEntries.some((e) => e.name === trimmed && isChatModelKind(e.kind)),
        remoteEntryKind: remoteEntry?.kind,
      });
      if (fallbackGroup === "local") {
        pool.push({ name: trimmed, kind: "chat", baseUrl: null, local: true });
      }
      if (fallbackGroup === "remote") {
        const resolved =
          remoteEntry?.baseUrl ?? (typeof raw.baseUrl === "string" ? raw.baseUrl : null);
        if (resolved !== null && resolved.trim() !== "") {
          pool.push({ name: trimmed, kind: "chat", baseUrl: resolved, local: false });
        }
      }
    }
    return pool;
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
    workflowsReady: workflowsQ.isSuccess || workflowsQ.isError,
  };
}

/** 本地工作流候选的详情查询与**模式默认值**播种（ISSUE #4633）。
 *
 * 从 useModelTest 拆出（§12.13：宿主函数越过 400 行硬闸）：这一簇只读
 * `workflow.detailFull`（富化视图）并把 `workflowModeDefaults` 的结果缓存成
 * memo——端口的 defaultValue 要取**图内当前控件值**，原始行里的 IO 列可能是
 * 作者勾选时的旧存档（没有 defaultValue）。
 * `workflowDefaultsReady`：详情 settle（成功 / 失败）前为 false，调用方在此
 * 期间不摆任何默认（打开瞬间的「通用默认 → 工作流默认」闪烁即源于此）。 */
function useWorkflowModeDefaults(
  selectedCandidate: TestCandidate | null,
  mode: string,
): { workflowDefaults: ModelTestValues; workflowDefaultsReady: boolean } {
  const trpc = useTRPC();
  const workflowDetailQ = useQuery(
    trpc.workflow.detailFull.queryOptions(
      { id: selectedCandidate?.workflow?.id ?? "" },
      { enabled: selectedCandidate?.workflow !== undefined },
    ),
  );
  const workflowDefaults = useMemo<ModelTestValues>(() => {
    if (selectedCandidate?.workflow === undefined) {
      return {};
    }
    const detail = workflowDetailQ.data;
    if (detail === null || detail === undefined) {
      return {};
    }
    return workflowModeDefaults({ io: detail.workflowIO, mode, paramMap: detail.paramMap });
  }, [mode, selectedCandidate?.workflow, workflowDetailQ.data]);
  const workflowDefaultsReady =
    selectedCandidate?.workflow === undefined ||
    workflowDetailQ.isSuccess === true ||
    workflowDetailQ.isError === true;
  return { workflowDefaults, workflowDefaultsReady };
}

/** 「本地提交」行的派生本体（ISSUE #3995）：对话 / 本地工作流 / API 中继
 * 三条通道各给一行；工作流候选在封装后升级为带 workflowInputs 落点清单的
 * 实况行（submissionRow 由调用点覆盖本行）。纯派生，无 React。 */
function deriveLocalPreviewRow(args: {
  buildBodies: (values: ModelTestValues) => ReturnType<typeof buildRequestBodies>;
  kind: ModelTestKind;
  mode: string;
  selectedCandidate: TestCandidate | null;
  selectedModel: string;
  values: ModelTestValues;
}): ApiCallDebugRow | null {
  const { buildBodies, kind, mode, selectedCandidate, selectedModel, values } = args;
  if (selectedModel === "") {
    return null;
  }
  /* 对话测试（#4080）：本地提交行带模型与提示词，端点在生成后由响应行给出。 */
  if (kind === "chat") {
    return {
      body: debugBodyOf({
        kind: "chat",
        model: selectedModel,
        prompt: values.prompt?.trim() ?? "",
      }),
      durationMs: null,
      endpoint: "chat/completions",
      excerpt: null,
      ok: true,
      phase: "relay" as const,
      status: null,
    };
  }
  const workflow = selectedCandidate?.workflow;
  if (workflow !== undefined) {
    return {
      body: debugBodyOf({
        kind,
        debug: true,
        workflow: workflow.name,
        mode,
        ...workflowPreviewBody(values),
      }),
      durationMs: null,
      endpoint: "generate.generate（本地 ComfyUI）",
      excerpt: null,
      ok: true,
      phase: "relay" as const,
      status: null,
    };
  }
  const { imageBody, videoBody } = buildBodies(values);
  return relayDebugRow(kind, imageBody ?? videoBody ?? {});
}

export function useModelTest(): ModelTestController {
  const trpc = useTRPC();
  const [kind, setKindState] = useState<ModelTestKind>("image");
  const [selectedModel, setSelectedModel] = useState("");
  /* 模式由左栏页签直接选定（#3635）：初值与切用途时的重置都取该用途的
   * 第一个生成类模式，不再从「选中模型的适配器」里播种 —— 模式是用户
   * 先选的入口，模型是其后在下拉里挑的具体执行者。 */
  const [mode, setModeState] = useState(() => defaultModeForKind("image"));
  /* 运行态按「用途 + 模式 + 模型」一格一份（#4080 评论 12）：状态 / 请求
   * 读数 / 执行日志 / 产物 / **表单值**互相隔离，切走再切回各看各的，不同
   * 模型可以同时测试。 */
  const [sessions, setSessions] = useState<Record<string, ModelTestSession>>({});

  /* 当前格的键：用途 + 模式 + 模型（候选取值空间 = 模型名 / wf::<id>）。 */
  const activeKey = `${kind}::${mode}::${selectedModel}`;
  /* 回调里读「当前格」用 ref 转发，保持回调身份稳定（每次渲染后同步）。 */
  const activeKeyRef = useRef(activeKey);
  useEffect(() => {
    activeKeyRef.current = activeKey;
  });
  const activeSession = sessions[activeKey] ?? emptyModelTestSession();

  const patchSession = useCallback((key: string, patch: Partial<ModelTestSession>) => {
    setSessions((prev) => {
      const base = prev[key] ?? emptyModelTestSession();
      return { ...prev, [key]: { ...base, ...patch } };
    });
  }, []);
  const appendResponseRows = useCallback((key: string, rows: ReadonlyArray<ApiCallDebugRow>) => {
    if (rows.length === 0) {
      return;
    }
    setSessions((prev) => {
      const base = prev[key] ?? emptyModelTestSession();
      return { ...prev, [key]: { ...base, responseRows: [...base.responseRows, ...rows] } };
    });
  }, []);
  const appendTaskLog = useCallback((key: string, entry: TaskLogEntry) => {
    setSessions((prev) => {
      const base = prev[key] ?? emptyModelTestSession();
      return { ...prev, [key]: { ...base, taskLogs: [...base.taskLogs, entry] } };
    });
  }, []);
  /* 每格自己的取消句柄（#4080 评论 12）：取消只中止那一格的任务。 */
  const cancelControllersRef = useRef<Map<string, AbortController>>(new Map());
  const setCancelController = useCallback((key: string, controller: AbortController | null) => {
    if (controller === null) {
      cancelControllersRef.current.delete(key);
      return;
    }
    cancelControllersRef.current.set(key, controller);
  }, []);
  /* 参考图组（#3949 需求 6/7）：表单级共享状态（切模型重置）。 */
  const referenceGroup = useReferenceImageGroup((text) => {
    patchSession(activeKeyRef.current, { error: text });
  });

  /* 产物原链交给系统浏览器（服务端 openExternal；免重编壳，#3791）收在
   * useOpenResultInBrowser（§12.13 拆分）。 */
  const { openBusy, openResultInBrowser } = useOpenResultInBrowser({
    activeKeyRef,
    patchSession,
  });
  /* 对话测试（#4080）：向本地 / 远端被测模型发一条提示词，返回补全与耗时。 */
  const chatTestM = useMutation(trpc.llm.chatTest.mutationOptions());

  /* 候选 / 契约 / 适配器索引：取数与派生收在 useTestCatalog（§12.13 第二刀）。 */
  const {
    adapters,
    adaptersByModel,
    candidates,
    contract,
    inputRows,
    kindCandidateCount,
    loading,
    modeCandidates,
    modeTabs,
    selectedCandidate,
    workflowsReady,
  } = useTestCatalog({ kind, mode, selectedModel, trpc });

  /* 本地工作流候选的模式默认值与就绪位（#4633）：详情没 settle 前不摆通用默认。 */
  const { workflowDefaults, workflowDefaultsReady } = useWorkflowModeDefaults(
    selectedCandidate,
    mode,
  );

  /* 历史页「重试」的带参预填（#4841）收在 useModelTestReprint（§12.13：主
   * hook 越过文件长度硬闸，按职责拆子 hook）——预填兜底层、应用动作与
   * 「工作流清单 settle 后补选同款工作流」都在那边；这里只接线。 */
  const { reprintPrefill, dropReprintPrefill, applyReprintPrefill } = useModelTestReprint({
    candidates,
    referenceGroup,
    selectedModel,
    setKindState,
    setSelectedModel,
    setModeState,
    workflowsReady,
  });

  /* 表单值随格走（#4080 评论 19）：测试界面不关闭时，切模型不丢已填参数。
   * 没填过的格：本地工作流候选回落**工作流在该模式下的默认值**（ISSUE #4633），
   * 其余回落该用途/模式的最常用档。
   * 工作流候选的详情没 settle（成功 / 失败）前**不摆任何默认**（#4633 评论 2：
   * 打开瞬间先摆通用「1:1 / 1k」、详情到了再跳成工作流默认，界面闪一下）——
   * 表单留空一瞬，等详情到位一次性播工作流默认；查询失败也算 settle，回落
   * 通用默认，不至于永远空着。
   * 兜底再叠一层历史「重试」的预填（#4841）：只在「当前模式 = 载荷模式」且
   * 会话还没写值时叠加 —— 用户切走模式或写入了任何一格即视为接管，预填让位。
   * 预填放兜底层而不是写进会话，是为了换模型不丢：重试时用户常要换个模型
   * 再跑，写进某一格会在切换后消失。 */
  const values = useMemo(() => {
    const base =
      Object.keys(activeSession.values).length > 0
        ? activeSession.values
        : workflowDefaultsReady
          ? { ...defaultSizeValues(mode), ...workflowDefaults }
          : {};
    if (reprintPrefill === null || reprintPrefill.mode !== mode) {
      return base;
    }
    return { ...base, ...pickWorkshopInputValues(reprintPrefill.inputs) };
  }, [activeSession.values, mode, workflowDefaults, workflowDefaultsReady, reprintPrefill]);

  /* 下拉显示名（#4080 评论 17）：工作流候选显示**模型名**（工作流上挂的模型
   * 标签，如 z-image），不是工作流文件名；同一模型挂在多个工作流上时，后
   * 出现的用工作流名消歧；没挂标签的退工作流名。 */
  const candidateLabels = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    const seen = new Map<string, number>();
    for (const c of modeCandidates) {
      const base = candidateLabel(c);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      out[candidateValue(c)] = n === 0 ? base : `${base} · ${c.workflow?.name ?? c.name}`;
    }
    return out;
  }, [modeCandidates]);

  const setKind = useCallback(
    (next: ModelTestKind) => {
      setKindState(next);
      setSelectedModel("");
      const nextMode = defaultModeForKind(next);
      setModeState(nextMode);
      referenceGroup.reset();
      /* 运行态按格隔离（#4080 评论 12）：切用途不删别的格的状态，
       * 当前格显示它自己的（没有就是空态）。表单值随格走（评论 19）：
       * 新格由播种效应以该模式的最常用档初始化。 */
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
      referenceGroup.reset();
      /* 运行态按格隔离（#4080 评论 12）：切模式不删别的格的状态。 */
    },
    [adaptersByModel, referenceGroup, selectedCandidate, selectedModel],
  );

  const selectModel = useCallback(
    (name: string) => {
      setSelectedModel(name);
      /* 表单值随格走（#4080 评论 19）：切模型不丢已填参数，也不清掉别的格；
       * 新格的默认档由播种效应初始化。 */
      referenceGroup.reset();
    },
    [referenceGroup],
  );

  const patchValue = useCallback(
    (type: keyof ModelTestValues, value: string) => {
      dropReprintPrefill();
      patchSession(activeKeyRef.current, { values: { ...values, [type]: value } });
    },
    [dropReprintPrefill, patchSession, values],
  );

  /* 批量更新（尺寸下拉一次写回比例 / 百万像素 / 分辨率 / 倍数四个键）。 */
  const patchValues = useCallback(
    (patch: Partial<ModelTestValues>) => {
      dropReprintPrefill();
      patchSession(activeKeyRef.current, { values: { ...values, ...patch } });
    },
    [dropReprintPrefill, patchSession, values],
  );

  /* 提示词随机按钮（ISSUE #3742）：从常用样本里随机填一条。 */
  const randomizePrompt = useCallback(() => {
    dropReprintPrefill();
    patchSession(activeKeyRef.current, { values: { ...values, prompt: randomPromptFor() } });
  }, [dropReprintPrefill, patchSession, values]);

  const setInputFromFile = useCallback(
    async (type: "first-frame" | "image", file: File) => {
      /* 失败反馈走 runAsyncAction（P27：try/catch + setError 的样板不手写）。 */
      await runAsyncAction(
        async () => {
          const dataUrl = await readFileAsDataUrl(file);
          dropReprintPrefill();
          patchSession(activeKeyRef.current, { values: { ...values, [type]: dataUrl } });
          return { ok: true as const };
        },
        {
          report: (k, text) => {
            if (k === "err") {
              patchSession(activeKeyRef.current, { error: text });
            }
          },
          failureText: "读取图片失败",
        },
      );
    },
    [dropReprintPrefill, patchSession, values],
  );

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
   * 组装结果（#3949 需求 8 —— 三处各拼一套必然漂移）。值显式入参：生成可带
   * 覆盖值（JSON 输入模式，ISSUE #4769），预览 / 提交行走当前表单值。 */
  const buildBodies = useCallback(
    (values: ModelTestValues) =>
      buildRequestBodies({
        kind,
        mode,
        model: selectedModel,
        referenceImages: referenceGroup.images,
        values,
      }),
    [kind, mode, referenceGroup.images, selectedModel],
  );

  /* 生成动作（对话 #4080 / 本地工作流 #4080 评论 4 / 图片视频中继三条通道
   * 的编排）收在 useModelTestGenerate（§12.13 拆分），只编排不另判。 */
  const { generate: generateSession } = useModelTestGenerate({
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
  });
  const generate = useCallback(
    (key?: string, valuesOverride?: ModelTestValues) =>
      generateSession(key ?? activeKeyRef.current, valuesOverride),
    [generateSession],
  );

  /* JSON 输入模式的解析与应用（ISSUE #4769）收在 useApplyJsonValues
   * （§12.13：主 hook 越过函数长度硬闸，按职责拆子 hook）。贴 JSON 是一次
   * 用户接管：历史「重试」的预填层一并退场（#4841）。 */
  const { applyJsonValues } = useApplyJsonValues({
    values,
    activeKeyRef,
    patchSession,
    onApplied: dropReprintPrefill,
  });

  /** 取消当前格（或指定格）的生成（#3949 需求 5 / #4080 评论 12）。 */
  const cancelGenerate = useCallback((key?: string) => {
    cancelControllersRef.current.get(key ?? activeKeyRef.current)?.abort();
  }, []);

  /** 预览失败的出口（与生成失败同一反馈位；#3637 失败必须可见）。 */
  const showPreviewError = useCallback(
    (text: string) => {
      patchSession(activeKeyRef.current, { notice: { kind: "err", text } });
    },
    [patchSession],
  );
  /* 生成前的「准备请求」读数（#3949 需求 8）：子 hook 里走服务端 dry-run，
   * 按当前 模式 / 模型 / 输入 现算**实际上游请求**，落在当前格的会话里；
   * 生成中不清空、不重算 —— 实际请求在请求中与生成后都保持可见
   * （#4080 评论 20）。工作流候选（#4080 评论 4）跳过 —— dry-run 是 API
   * 中继的预演，本地通道没有这一步。 */
  useRequestPreview({
    buildBodies,
    busy: activeSession.generating,
    kind,
    onError: showPreviewError,
    selectedModel,
    sessionKey: activeKey,
    values,
    patchSession,
    skip: selectedCandidate?.workflow === undefined ? false : true,
  });
  /* 生成前的「本地提交」行（ISSUE #3995）：与点生成那一步同一份组装
   * （buildBodies + relayDebugRow，两处各拼一套必然漂移）。派生本体收在
   * `deriveLocalPreviewRow`（§12.13：主 hook 越过函数长度硬闸，按职责搬出
   * 函数体），这里只剩接线。 */
  const localPreviewRow = useMemo(
    () =>
      deriveLocalPreviewRow({
        buildBodies,
        kind,
        mode,
        selectedCandidate,
        selectedModel,
        values,
      }),
    [buildBodies, kind, mode, selectedCandidate, selectedModel, values],
  );
  /* 当前格的请求行 = 本地提交 + 实际请求（#4080 评论 13：生成后保留，仅徽标
   * 翻转；实际请求来自该格会话的 dry-run 读数）。 */
  const requestRows = useMemo(() => {
    const submission = activeSession.submissionRow ?? localPreviewRow;
    return submission === null
      ? [...activeSession.previewRows]
      : [submission, ...activeSession.previewRows];
  }, [activeSession.previewRows, activeSession.submissionRow, localPreviewRow]);

  /* 左栏「生成中」标记的读数（ISSUE #4838）：全部格聚合，随 sessions 变化
   * （任一格开始 / 结束生成都会重算）。 */
  const generatingIndex = useMemo(() => summarizeGeneratingSessions(sessions), [sessions]);

  return {
    candidates: modeCandidates,
    candidateLabels,
    responseRows: activeSession.responseRows,
    requestRows,
    kindCandidateCount,
    inputRows,
    applyJsonValues,
    kind,
    error: activeSession.error,
    generating: activeSession.generating,
    generatingSince: activeSession.generatingSince,
    generatingByKind: generatingIndex.byKind,
    generatingByMode: generatingIndex.byMode,
    generatingModels: generatingIndex.models,
    cancelGenerate,
    referenceImages: referenceGroup.images,
    addReferenceImages,
    removeReferenceImage,
    adapters,
    mode,
    modeTabs,
    notice: activeSession.notice,
    generate,
    openBusy,
    openResultInBrowser,
    loading,
    selectedModel,
    selectedWorkflow: selectedCandidate?.workflow ?? null,
    taskLogs: activeSession.taskLogs,
    taskId: activeSession.taskId,
    workflowProgress: activeSession.workflowProgress,
    setInputFromFile,
    setKind,
    setMode,
    selectModel,
    patchValue,
    patchValues,
    randomizePrompt,
    reprintPrefill,
    applyReprintPrefill,
    result: activeSession.result,
    values,
  };
}
