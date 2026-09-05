"use client";

/**
 * 设置页的业务逻辑层（规范 17 §17.2 第②层）。
 *
 * 承载：LLM / 偏好两份草稿的「从查询播种 + 编辑」，Ollama 探测与启动，
 * ComfyUI 启动与状态刷新，保存动作与提示条（flash）。
 *
 * 视图（`./page.tsx`）只消费这里返回的 controller：不碰 tRPC、不发 fetch、
 * 不算「按任务温度」的合并规则。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";

import { errorMessage } from "~/lib/error-message";
import {
  probeOllama as probeOllamaClient,
  startOllama as startOllamaClient,
  stopOllama as stopOllamaClient,
  type OllamaModel,
} from "~/lib/llm/ollama-client";
import { TASK_TYPES, type TaskType } from "~/lib/llm/types";
import { api } from "~/trpc/react";

export type Settings = {
  comfyuiUrl: string;
  trainerUrl: string;
  defaultVideoWorkflow: "auto" | "txt2video" | "img2video";
  comfyLorasDir: string;
  comfyuiPath: string;
  comfyuiExtraArgs: string;
  comfyuiAutoStart: boolean;
  /** ComfyUI 监听端口；0 = 默认 8188（启动时按需显式传 --port）。 */
  comfyuiPort: number;
};

export type LlmConfig = {
  provider: "local" | "remote";
  baseUrl: string;
  model: string;
  temperature: number;
  temperatureByTask?: Record<TaskType, number>;
  maxTokens: number;
  apiKey: string | null;
};

export type Section = "llm" | "comfyui" | "appearance";
export type OllamaStatus = "checking" | "starting" | "up" | "down";

export interface FlashMessage {
  kind: "ok" | "err";
  text: string;
}

/** 两份草稿都已就绪 —— 视图只在 `drafts` 非空时渲染，避免逐处判空。 */
export interface SettingsPageDrafts {
  llm: LlmConfig;
  settings: Settings;
}

export interface SettingsPageController {
  /** 侧边栏当前分区（纯视觉偏好，但影响渲染哪个表单，故由逻辑层持有）。 */
  section: Section;
  setSection: (section: Section) => void;
  /* 外观主题：Light / Dark（持久化偏好，统一走 next-themes）。 */
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
  /* 加载 / 错误 */
  isInitialLoad: boolean;
  hasError: boolean;
  /** 任一查询出错且两份数据都没拿到时的兜底文案。 */
  errorText: string;
  retry: () => void;
  /** 两份草稿；为 null 表示查询还没回来 —— 容器据此走降级 UI，
   *  收窄后传给视图的 controller 里它就是非空的。 */
  drafts: SettingsPageDrafts | null;
  /* 草稿更新：局部 patch，避免视图里到处 `{ ...draft, x }` 与判空 */
  patchLlm: (patch: Partial<LlmConfig>) => void;
  patchSettings: (patch: Partial<Settings>) => void;
  /* LLM：API Key 是「留空不改」语义，故独立于草稿 */
  llmApiKey: string;
  setLlmApiKey: (value: string) => void;
  /* Ollama */
  ollamaStatus: OllamaStatus;
  ollamaModels: OllamaModel[];
  ollamaStarting: boolean;
  startOllama: () => Promise<void>;
  /* ComfyUI */
  comfyStatus: {
    up: boolean;
    starting: boolean;
    base: string | null;
    pathConfigured: boolean;
    port: number;
  } | null;
  comfyStarting: boolean;
  comfyStopping: boolean;
  startComfy: () => Promise<void>;
  stopComfy: () => Promise<void>;
  /* Ollama 关闭（启动已有 startOllama） */
  ollamaStopping: boolean;
  stopOllama: () => Promise<void>;
  /* 保存 */
  saving: boolean;
  saveLlm: () => Promise<void>;
  savePrefs: () => Promise<void>;
  /* 提示条 */
  flash: FlashMessage | null;
  dismissFlash: () => void;
  /** 输入框清空 → 删掉该任务的覆盖值；有值 → 写入覆盖。 */
  setTaskTemperature: (task: TaskType, raw: string) => void;
}

/** 提示条停留时长。 */
const FLASH_MS = 3500;

/** Ollama 启动就绪轮询：最多 20 次 × 2s（覆盖 ollama 冷启动的常见耗时）。 */
/** 启动流程期间状态行持有权标记的 ref 初始值（见 probeOllama 内说明）。 */
const OLLAMA_START_POLL_TIMES = 20;
const OLLAMA_START_POLL_INTERVAL_MS = 2000;

/** 设置页全部状态与动作 —— 见文件头注释的分层说明。 */
export function useSettingsPage(): SettingsPageController {
  const [section, setSection] = useState<Section>("llm");
  const { theme, setTheme } = useTheme();
  const [flash, setFlash] = useState<FlashMessage | null>(null);
  const [saving, setSaving] = useState(false);

  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmDraft, setLlmDraft] = useState<LlmConfig | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>("checking");
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [ollamaStarting, setOllamaStarting] = useState(false);
  // startOllama 的轮询里要读最新状态；state 闭包会拿到旧值，用 effect 同步到 ref
  const ollamaStatusRef = useRef<OllamaStatus>("checking");
  useEffect(() => {
    ollamaStatusRef.current = ollamaStatus;
  }, [ollamaStatus]);
  /* 启动流程期间状态行的持有权标记：launch 流程会自己落「启动中/运行中/未运行」，
   * 期间挂载触发的探测不得覆盖状态（否则 UI 会跳变——轮询探测本身不发
   * 「checking」+ 静默写结果，但 baseUrl 等其它 effect 仍可能并发探测）。 */
  const ollamaStartingRef = useRef(false);
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const [comfyStarting, setComfyStarting] = useState(false);

  const settingsQ = api.setting.get.useQuery();
  const llmQ = api.llm.configGet.useQuery();
  const saveSetting = api.setting.save.useMutation();
  const saveLlmCfg = api.llm.configSave.useMutation();
  const comfyStatusQ = api.setting.comfyStatus.useQuery(undefined, {
    refetchInterval: 15_000,
  });
  const comfyStartM = api.setting.comfyStart.useMutation();
  const comfyStopM = api.setting.comfyStop.useMutation();
  const [comfyStopping, setComfyStopping] = useState(false);
  const [ollamaStopping, setOllamaStopping] = useState(false);

  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFlash = useCallback((kind: "ok" | "err", text: string) => {
    setFlash({ kind, text });
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlash(null), FLASH_MS);
  }, []);
  useEffect(
    () => () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    },
    [],
  );

  /* ── 从查询结果播种草稿 ─────────────────────────────────────
   * 「渲染期对比上一次引用 → setState」是 React 官方推荐的 derived-state 写法，
   * 比 useEffect 少一次多余渲染，也不会闪旧值。 */
  const llmConfig = llmQ.data?.config ?? null;
  const [prevLlmConfig, setPrevLlmConfig] = useState(llmConfig);
  if (llmConfig !== prevLlmConfig) {
    setPrevLlmConfig(llmConfig);
    if (llmConfig) {
      setLlmDraft({
        ...llmConfig,
        apiKey: llmConfig.apiKey ?? null,
        temperatureByTask: llmConfig.temperatureByTask ?? undefined,
      });
    }
  }
  const settingsData = settingsQ.data?.settings ?? null;
  const [prevSettingsData, setPrevSettingsData] = useState(settingsData);
  if (settingsData !== prevSettingsData) {
    setPrevSettingsData(settingsData);
    if (settingsData) setSettingsDraft(settingsData);
  }

  /* ── Ollama 探测 ───────────────────────────────────────── */
  /* 单独取出 baseUrl：下面 effect 与 startOllama 都只需它，依赖写具体字段可让
   * React Compiler 校验通过（写 `llmDraft?.baseUrl` 会被判定为「推断依赖比
   * 手写依赖更宽」，进而跳过整个组件的优化）。 */
  const llmBaseUrl = llmDraft?.baseUrl ?? "";
  /** 静默探测：不发「检测中」、不与其他探测互相覆盖状态。 */
  const probeOllamaSilent = useCallback(async (baseUrl: string) => {
    const result = await probeOllamaClient(baseUrl);
    if (ollamaStartingRef.current) return;
    if (result.up) {
      setOllamaModels(result.models);
      setOllamaStatus("up");
      return;
    }
    setOllamaModels([]);
    setOllamaStatus("down");
  }, []);

  /** 探测并把结果落到状态行。启动流程内部轮询禁用此函数（见 probeOllamaSilent）。 */
  const probeOllama = useCallback(
    async (baseUrl: string) => {
      if (ollamaStartingRef.current) return;
      setOllamaStatus("checking");
      await probeOllamaSilent(baseUrl);
    },
    [probeOllamaSilent],
  );

  // baseUrl 变化或本地 provider 切换时重新探测
  useEffect(() => {
    if (llmDraft?.provider !== "local" || !llmBaseUrl) return;
    const timer = setTimeout(() => void probeOllama(llmBaseUrl), 0);
    return () => clearTimeout(timer);
  }, [llmDraft?.provider, llmBaseUrl, probeOllama]);

  const startOllama = useCallback(async () => {
    setOllamaStarting(true);
    ollamaStartingRef.current = true;
    setOllamaStatus("starting");
    try {
      await startOllamaClient();
      // 轮询等就绪再交回控制权：期间保持「启动中…」按钮禁用。以前 POST 完
      // 固定睡 2s 就探一次，ollama 冷启动远不止 2s，状态行变回「未运行」、
      // 按钮恢复可点，用户误以为失败会连点——每次点击都再拉起一个 serve
      // 进程，多进程抢 11434 端口在 Windows 上连环弹「端口被占用」错误框。
      for (let i = 0; i < OLLAMA_START_POLL_TIMES; i++) {
        if (llmBaseUrl) {
          const result = await probeOllamaClient(llmBaseUrl);
          if (result.up) {
            setOllamaModels(result.models);
            setOllamaStatus("up");
            return;
          }
        }
        await new Promise((resolve) =>
          setTimeout(resolve, OLLAMA_START_POLL_INTERVAL_MS),
        );
      }
      throw new Error(
        "Ollama 启动超时：进程可能未成功运行，请确认已安装 Ollama 并可手动执行 ollama serve",
      );
    } catch (error) {
      showFlash("err", errorMessage(error, "启动 Ollama 失败"));
      // 超时/失败后兜底探一次，让状态行和进程的真实情况对齐
      if (llmBaseUrl) await probeOllamaSilent(llmBaseUrl);
    } finally {
      setOllamaStarting(false);
      ollamaStartingRef.current = false;
    }
  }, [llmBaseUrl, probeOllamaSilent, showFlash]);

  /* ── ComfyUI 启动 ───────────────────────────────────────── */
  const startComfy = useCallback(async () => {
    setSaving(true);
    setComfyStarting(true);
    try {
      await saveSetting.mutateAsync({
        comfyuiPath: settingsDraft?.comfyuiPath,
        comfyuiExtraArgs: settingsDraft?.comfyuiExtraArgs,
        comfyuiAutoStart: settingsDraft?.comfyuiAutoStart,
        comfyuiPort: settingsDraft?.comfyuiPort,
      });
      const result = await comfyStartM.mutateAsync({});
      showFlash(result.ok ? "ok" : "err", result.detail);
      await comfyStatusQ.refetch();
    } catch (error) {
      showFlash("err", errorMessage(error, "启动 ComfyUI 失败"));
    } finally {
      setSaving(false);
      setComfyStarting(false);
    }
  }, [settingsDraft, saveSetting, comfyStartM, comfyStatusQ, showFlash]);

  const stopComfy = useCallback(async () => {
    setSaving(true);
    setComfyStopping(true);
    try {
      const result = await comfyStopM.mutateAsync();
      showFlash(result.ok ? "ok" : "err", result.detail);
      await comfyStatusQ.refetch();
    } catch (error) {
      showFlash("err", errorMessage(error, "关闭 ComfyUI 失败"));
    } finally {
      setSaving(false);
      setComfyStopping(false);
    }
  }, [comfyStopM, comfyStatusQ, showFlash]);

  const stopOllamaFn = useCallback(async () => {
    setOllamaStopping(true);
    try {
      await stopOllamaClient();
      // 停止后重新探测，状态行回到「未运行」
      if (llmBaseUrl) await probeOllama(llmBaseUrl);
      showFlash("ok", "Ollama 已关闭");
    } catch (error) {
      showFlash("err", errorMessage(error, "关闭 Ollama 失败"));
      if (llmBaseUrl) await probeOllama(llmBaseUrl);
    } finally {
      setOllamaStopping(false);
    }
  }, [llmBaseUrl, probeOllama, showFlash]);

  /* ── 保存 ───────────────────────────────────────────────── */
  const saveLlm = useCallback(async () => {
    if (!llmDraft) return;
    setSaving(true);
    try {
      await saveLlmCfg.mutateAsync({
        ...llmDraft,
        apiKey: llmApiKey || undefined,
      });
      showFlash("ok", "LLM 配置已保存");
      if (llmApiKey) setLlmApiKey("");
      await llmQ.refetch();
    } catch (error) {
      showFlash("err", errorMessage(error, "保存失败"));
    } finally {
      setSaving(false);
    }
  }, [llmDraft, llmApiKey, saveLlmCfg, llmQ, showFlash]);

  const savePrefs = useCallback(async () => {
    if (!settingsDraft) return;
    setSaving(true);
    try {
      await saveSetting.mutateAsync(settingsDraft);
      await settingsQ.refetch();
      showFlash("ok", "偏好已保存");
    } catch (error) {
      showFlash("err", errorMessage(error, "保存失败"));
    } finally {
      setSaving(false);
    }
  }, [settingsDraft, saveSetting, settingsQ, showFlash]);

  /* ── 按任务温度 ─────────────────────────────────────────── */
  const patchLlm = useCallback((patch: Partial<LlmConfig>) => {
    setLlmDraft((draft) => (draft ? { ...draft, ...patch } : draft));
  }, []);

  const patchSettings = useCallback((patch: Partial<Settings>) => {
    setSettingsDraft((draft) => (draft ? { ...draft, ...patch } : draft));
  }, []);

  const setTaskTemperature = useCallback(
    (task: TaskType, raw: string) => {
      if (!llmDraft) return;
      const base = llmDraft.temperatureByTask ?? {};
      /* 清空输入框 = 删掉该 key（而不是写入 undefined），否则「已覆盖」徽标
       * 会一直亮着，且保存时会把 undefined 一并发给后端。 */
      const next =
        raw === ""
          ? Object.fromEntries(
              Object.entries(base).filter(([key]) => key !== task),
            )
          : { ...base, [task]: Number(raw) };
      patchLlm({
        temperatureByTask:
          Object.keys(next).length > 0
            ? (next as Record<TaskType, number>)
            : undefined,
      });
    },
    [llmDraft, patchLlm],
  );

  const hasError = !!settingsQ.isError || !!llmQ.isError;
  const isInitialLoad = settingsQ.isLoading || llmQ.isLoading;

  const errorText = hasError
    ? errorMessage(settingsQ.error ?? llmQ.error, "未知错误")
    : "";

  const retry = useCallback(() => {
    void settingsQ.refetch();
    void llmQ.refetch();
  }, [settingsQ, llmQ]);

  const comfy = comfyStatusQ.data;

  return {
    section,
    setSection,
    theme: theme === "light" ? "light" : "dark",
    setTheme: (value: "light" | "dark") => setTheme(value),
    isInitialLoad: isInitialLoad && !settingsQ.data && !llmQ.data && !hasError,
    hasError: hasError && !settingsData && !llmConfig,
    errorText,
    retry,
    drafts:
      llmDraft && settingsDraft
        ? { llm: llmDraft, settings: settingsDraft }
        : null,
    patchLlm,
    patchSettings,
    llmApiKey,
    setLlmApiKey,
    ollamaStatus,
    ollamaModels,
    ollamaStarting,
    startOllama,
    comfyStatus: comfy
      ? {
          up: !!comfy.up,
          starting: !!comfy.starting,
          base: comfy.base ?? null,
          pathConfigured: !!comfy.pathConfigured,
          port: comfy.port ?? 0,
        }
      : null,
    comfyStarting,
    comfyStopping,
    startComfy,
    stopComfy,
    ollamaStopping,
    stopOllama: stopOllamaFn,
    saving,
    saveLlm,
    savePrefs,
    flash,
    dismissFlash: useCallback(() => setFlash(null), []),
    setTaskTemperature,
  };
}

/** 侧边栏分区 —— 纯配置，视图直接消费。 */
export const SETTINGS_SECTIONS: { id: Section; label: string }[] = [
  { id: "appearance", label: "外观" },
  { id: "llm", label: "语言模型" },
  { id: "comfyui", label: "创作后端" },
];

/** 按任务温度区的任务清单 —— 视图遍历渲染，顺序即渲染顺序。 */
export const TEMPERATURE_TASKS = Object.entries(TASK_TYPES) as [
  TaskType,
  (typeof TASK_TYPES)[TaskType],
][];
