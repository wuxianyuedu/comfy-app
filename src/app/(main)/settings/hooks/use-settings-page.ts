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
import { isDesktopShell } from "~/lib/desktop-shell-client";
import { useShellTabs } from "~/lib/shell-tabs-store";
import {
  checkAppUpdate as checkAppUpdateClient,
  downloadAndInstallUpdate,
  relaunchApp as relaunchAppClient,
} from "~/lib/app-update-client";
import {
  parseAnsiSegments,
  parseOllamaLogText,
  type AnsiSegment,
} from "~/lib/log-ansi";
import { fetchFileLogSlice, type FileLogSlice } from "~/lib/log-file-client";
import {
  probeOllama as probeOllamaClient,
  startOllama as startOllamaClient,
  stopOllama as stopOllamaClient,
  type OllamaModel,
} from "~/lib/llm/ollama-client";
import { probeRemoteApi, type RemoteProbeResult } from "~/lib/llm/browser";
import {
  queryUsageTask,
  testModelUsage,
  type UsageTaskQueryInput,
  type UsageTestInput,
  type UsageTestResult,
} from "~/lib/llm/usage-test-client";
import {
  splitExtraModels,
  TASK_TYPES,
  type RemoteModelEntry,
  type RemoteModelKind,
  type TaskType,
} from "~/lib/llm/types";
import { api } from "~/trpc/react";

export type Settings = {
  trainerUrl: string;
  defaultVideoWorkflow: "auto" | "txt2video" | "img2video";
  comfyLorasDir: string;
  comfyuiPath: string;
  comfyuiExtraArgs: string;
  comfyuiAutoStart: boolean;
  /** ComfyUI 监听端口；0 = 默认 8188（启动时按需显式传 --port）。 */
  comfyuiPort: number;
  /** 应用退出是否连带关闭自己拉起的 ComfyUI（默认 true=连带关闭）。 */
  exitKillComfyui: boolean;
  /** 应用退出是否连带关闭自己拉起的 Ollama（默认 true=连带关闭）。 */
  exitKillOllama: boolean;
};

export type LlmConfig = {
  provider: "local" | "remote";
  baseUrl: string;
  model: string;
  /** 本地 Ollama 启用的候选模型名（纯名字，无 apiKey）—— option C 与远端分开。 */
  localCandidates: string[];
  /** 远端独立模型条目（可带独立 baseUrl / apiKey）—— option C 存 remoteModel 表。 */
  extraModels: RemoteModelEntry[];
  temperature: number;
  temperatureByTask?: Record<TaskType, number>;
  maxTokens: number;
  apiKey: string | null;
};

export type Section =
  | "appearance"
  | "appUpdate"
  | "llmLocal"
  | "llmRemote"
  | "comfyui"
  | "database"
  | "exit";
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
    /** 服务端「关闭中」窗口（globalThis 计时，可跨设置页挂载存活）：见 ISSUE #103 */
    stopping: boolean;
    base: string | null;
    pathConfigured: boolean;
    port: number;
    /** 安装形态：桌面版/便携版/venv；未配置路径或无路径时为 null。 */
    instanceType: "desktop" | "portable" | "venv" | "unknown" | null;
    /** 桌面实例且能读到实例 ID → 端口/参数由 Comfy Desktop 元数据决定，
     *  设置页据此隐藏 端口/启动参数 输入。 */
    desktopManaged: boolean;
  } | null;
  comfyStarting: boolean;
  comfyStopping: boolean;
  comfyOpening: boolean;
  startComfy: () => Promise<void>;
  stopComfy: () => Promise<void>;
  openComfy: () => Promise<void>;
  /* Drizzle Studio（本地数据库可视化）：状态 + 启动/关闭/打开查看 */
  dbStudioStatus: {
    up: boolean;
    starting: boolean;
    port: number;
  } | null;
  dbStudioStarting: boolean;
  dbStudioStopping: boolean;
  dbStudioOpening: boolean;
  startDbStudio: () => Promise<void>;
  stopDbStudio: () => Promise<void>;
  openDbStudio: () => Promise<void>;
  /** 用系统默认浏览器打开生成的远程资源（视频等），桌面壳内替代 target=_blank */
  openExternalUrl: (url: string) => Promise<void>;
  /* ComfyUI 启动日志（log/services/comfyui-runtime.log）：启动期间自动跟随，可手动刷新 */
  comfyLogText: string;
  comfyLogSegments: AnsiSegment[];
  comfyLogActive: boolean;
  refreshComfyLog: () => Promise<void>;
  /* Drizzle Studio 启动日志（log/services/drizzle-studio-runtime.log）：同 ComfyUI，可跟随/刷新 */
  dbStudioLogText: string;
  dbStudioLogSegments: AnsiSegment[];
  dbStudioLogActive: boolean;
  refreshDbStudioLog: () => Promise<void>;
  /* Ollama 启动日志（log/services/ollama-runtime.log）：同 ComfyUI，可跟随/刷新 */
  ollamaLogText: string;
  ollamaLogSegments: AnsiSegment[];
  ollamaLogActive: boolean;
  refreshOllamaLog: () => Promise<void>;
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
  /** 输入框清空 → 删掉该任务的覆盖值（恢复该任务的推荐默认温度）；有值 → 写入覆盖。 */
  setTaskTemperature: (task: TaskType, raw: string) => void;
  /** 勾选/取消一个候选模型（本地 Ollama 多模型管理） */
  toggleExtraModel: (name: string) => void;
  /* 远端模型管理：列表 + 添加 / 编辑 / 移除 + 测试。增删改即时落库
   * （无需单独的保存按钮），返回本次保存结果供弹窗留在原地报错。 */
  remoteModelList: RemoteModelEntry[];
  addRemoteModel: (entry: {
    name: string;
    baseUrl?: string;
    apiKey?: string;
    kind?: RemoteModelKind;
  }) => Promise<{ ok: boolean; error?: string }>;
  /** 编辑既有条目（只作用于已配置条目）；重名校验排除自身，改名时若生效
   *  模型引用旧名会同步更新。
   *  patch.baseUrl = null / clearApiKey = true 表示清掉独立配置、跟随全局。 */
  updateRemoteModel: (
    name: string,
    patch: {
      name?: string;
      baseUrl?: string | null;
      apiKey?: string;
      clearApiKey?: boolean;
      kind?: RemoteModelKind | null;
    },
  ) => Promise<{ ok: boolean; error?: string }>;
  removeRemoteModel: (name: string) => Promise<{ ok: boolean; error?: string }>;
  probeRemote: (input: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  }) => Promise<RemoteProbeResult>;
  /** 按用途发起一次真实调用（图片 / 视频会真实生成、消耗额度） */
  testModelUsage: (input: UsageTestInput) => Promise<UsageTestResult>;
  /** 对已提交但仍在生成的异步视频任务「继续等待」一轮：只查既有任务，不重复提交扣费 */
  queryUsageTask: (input: UsageTaskQueryInput) => Promise<UsageTestResult>;
  /* 应用自更新（Tauri updater + process）：检测 / 下载安装 / 重启 */
  appUpdate: {
    /** 是否在桌面壳内（决定「检测更新」是否可用）。 */
    inShell: boolean;
    /** 一次操作的进行态；idle 表示空闲。 */
    busy: "idle" | "checking" | "installing";
    /** 最近一次检测是否发现可用更新。 */
    available: boolean;
    /** 可用的远端版本号（available 时非空）。 */
    version: string | null;
    /** 当前本地版本号（可用时从检测结果读取）。 */
    currentVersion: string | null;
    /** 最近一次检测/安装的可读结果或提示。 */
    message: string | null;
    /** 下载进度（bytes，total 可能为空），installing 时非空。 */
    progress: { downloaded: number; total?: number } | null;
  };
  checkAppUpdate: () => Promise<void>;
  installAppUpdate: () => Promise<void>;
  relaunchApp: () => Promise<void>;
}

/** 提示条停留时长。 */
const FLASH_MS = 3500;

/* ── ComfyUI 启动日志 ─────────────────────────────────────
 * lifecycle.ts 会把 spawn 参数与子进程 stdout/stderr 追加进
 * log/services/comfyui-runtime.log；这里在启动期间每秒跟随其尾部。 */
const COMFY_LOG_POLL_MS = 1000;
/** 客户端保留上限：一次超长冷启动也不至于把内存吃穿。 */
const COMFY_LOG_MAX_CHARS = 120_000;
/** \r（Windows 行尾）在日志面板里只添乱；SGR 颜色序列保留给视图层渲染。 */
const COMFY_LOG_CR_RE = /\r/g;

function capComfyLog(text: string): string {
  return text.length > COMFY_LOG_MAX_CHARS
    ? text.slice(-COMFY_LOG_MAX_CHARS)
    : text;
}

/**
 * 合并候选模型：主模型 + 勾选的多选，按首次出现去重。
 * 主模型永远在列（本地 Ollama 当前生效模型）；查询结果相同时返回原引用，
 * 避免「主模型切换 → 勾选列表重算」引发受控组件输入抖动。
 */
function mergeExtraModels(
  current: string[],
  model: string,
  toggled: string,
): string[] {
  const next =
    model.trim() !== ""
      ? [model, ...current.filter((m) => m !== model)]
      : [...current];
  if (!toggled.trim()) return next;
  if (next.includes(toggled)) {
    // 取消勾选：主模型不可移除
    if (toggled === model) return next;
    return next.filter((m) => m !== toggled);
  }
  return [...next, toggled];
}

/** Ollama 启动就绪轮询：最多 20 次 × 2s（覆盖 ollama 冷启动的常见耗时）。 */
/** 启动流程期间状态行持有权标记的 ref 初始值（见 probeOllama 内说明）。 */
const OLLAMA_START_POLL_TIMES = 20;
const OLLAMA_START_POLL_INTERVAL_MS = 2000;

/** 设置页全部状态与动作 —— 见文件头注释的分层说明。 */
export function useSettingsPage(): SettingsPageController {
  const [section, setSection] = useState<Section>("llmLocal");
  const { theme, setTheme } = useTheme();
  const [flash, setFlash] = useState<FlashMessage | null>(null);
  const [saving, setSaving] = useState(false);

  /* 应用自更新：检测 / 下载安装的进行态与结果。运算放 lib/app-update-client，
   * 这里只记 UI 需要的暂态（夹在壳交互与视图中层）。 */
  const [appUpdateBusy, setAppUpdateBusy] = useState<
    "idle" | "checking" | "installing"
  >("idle");
  const [appUpdateAvailable, setAppUpdateAvailable] = useState(false);
  const [appUpdateVersion, setAppUpdateVersion] = useState<string | null>(null);
  const [appUpdateCurrent, setAppUpdateCurrent] = useState<string | null>(null);
  const [appUpdateMessage, setAppUpdateMessage] = useState<string | null>(null);
  const [appUpdateProgress, setAppUpdateProgress] = useState<{
    downloaded: number;
    total?: number;
  } | null>(null);

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
  /* 「关闭中」持锁标记：stopOllama 进行中禁止探测覆盖状态。Ollama 的关闭
   * 动作（taskkill + 等端口释放）最长可挂 5s，期间 useEffect 触发的探测
   * 会把状态行抢回「未运行」并重开「关闭 Ollama」按钮（同 #103 的
   * 「操作后状态被覆盖」族问题）。 */
  const ollamaStoppingRef = useRef(false);
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const [comfyStarting, setComfyStarting] = useState(false);

  const settingsQ = api.setting.get.useQuery();
  const llmQ = api.llm.configGet.useQuery();
  const saveSetting = api.setting.save.useMutation();
  const saveLlmCfg = api.llm.configSave.useMutation();
  /* ComfyUI / Drizzle Studio 状态探测延后到首屏两份配置就绪后再发：
   * comfyStatus 在 ComfyUI 未运行时要对连续端口段做超时探测（秒级），
   * 同挂载触发会被 httpBatchLink 并进首屏同一批请求，而批量响应不分块
   * 流式返回 —— 首屏只需要的 get/configGet 会被迫等整批结束，页面
   * 多停在加载态数秒。 */
  const statusQueriesEnabled = !!settingsQ.data && !!llmQ.data;
  const comfyStatusQ = api.setting.comfyStatus.useQuery(undefined, {
    refetchInterval: 15_000,
    enabled: statusQueriesEnabled,
  });
  const comfyStartM = api.setting.comfyStart.useMutation();
  const comfyStopM = api.setting.comfyStop.useMutation();
  const comfyOpenM = api.setting.comfyOpen.useMutation();
  const [comfyStopping, setComfyStopping] = useState(false);
  const [comfyOpening, setComfyOpening] = useState(false);
  /* Drizzle Studio：状态查询 + 启动/关闭/打开动作（enabled 门控同 comfyStatus） */
  const dbStudioStatusQ = api.setting.dbStudioStatus.useQuery(undefined, {
    refetchInterval: 15_000,
    enabled: statusQueriesEnabled,
  });
  const dbStudioStartM = api.setting.dbStudioStart.useMutation();
  const dbStudioStopM = api.setting.dbStudioStop.useMutation();
  const dbStudioOpenM = api.setting.dbStudioOpen.useMutation();
  const openExternalM = api.setting.openExternal.useMutation();
  const [dbStudioStarting, setDbStudioStarting] = useState(false);
  const [dbStudioStopping, setDbStudioStopping] = useState(false);
  const [dbStudioOpening, setDbStudioOpening] = useState(false);
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
  /* 播种条件：数据引用变化（保存后 refetch 回写）时重新播种；或数据已就绪
   * 而草稿仍为空（含首次挂载即命中 tRPC 缓存的场景）时播种。若只用引用对比，
   * 关闭再打开时 prev 初值被缓存命中，分支永不触发，草稿一直为空，页面
   * 会落到「配置数据未就绪」。 */
  const llmChanged = llmConfig !== prevLlmConfig;
  if (llmChanged) setPrevLlmConfig(llmConfig);
  if (llmConfig && (llmChanged || !llmDraft)) {
    const split = splitExtraModels(llmConfig.extraModels);
    setLlmDraft({
      ...llmConfig,
      apiKey: llmConfig.apiKey ?? null,
      /* 本地候选（字符串）与远端独立模型（对象）从同一下发清单里拆开存，互不混写 */
      localCandidates: split.localNames.filter((n) => n !== llmConfig.model),
      extraModels: split.remoteEntries.filter((e) => e.name !== llmConfig.model),
      temperatureByTask: llmConfig.temperatureByTask ?? undefined,
    });
  }
  const settingsData = settingsQ.data?.settings ?? null;
  const [prevSettingsData, setPrevSettingsData] = useState(settingsData);
  /* 同 llm 播种：缓存命中 / refetch 两种情形都要能落到草稿，避免落到降级 UI。 */
  const settingsChanged = settingsData !== prevSettingsData;
  if (settingsChanged) setPrevSettingsData(settingsData);
  if (settingsData && (settingsChanged || !settingsDraft)) {
    setSettingsDraft(settingsData);
  }

  /* ── Ollama 探测 ───────────────────────────────────────── */
  /* 单独取出 baseUrl：下面 effect 与 startOllama 都只需它，依赖写具体字段可让
   * React Compiler 校验通过（写 `llmDraft?.baseUrl` 会被判定为「推断依赖比
   * 手写依赖更宽」，进而跳过整个组件的优化）。 */
  const llmBaseUrl = llmDraft?.baseUrl ?? "";
  /** 静默探测：不发「检测中」、不与其他探测互相覆盖状态。 */
  const probeOllamaSilent = useCallback(async (baseUrl: string) => {
    const result = await probeOllamaClient(baseUrl);
    if (ollamaStartingRef.current || ollamaStoppingRef.current) return;
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
      if (ollamaStartingRef.current || ollamaStoppingRef.current) return;
      setOllamaStatus("checking");
      await probeOllamaSilent(baseUrl);
    },
    [probeOllamaSilent],
  );

  // baseUrl 变化或本地 provider 切换时重新探测。
  // 只有「本地 provider + 已填 baseUrl」才有得探测；否则说明当前没有可探测的
  // Ollama（provider 是远端、或还没填地址），若仍停留在初始/遗留的 checking
  // 态，状态行会一直「检测 Ollama 服务…」转圈永不结束——这里落定为 down。
  useEffect(() => {
    if (llmDraft?.provider !== "local" || !llmBaseUrl) {
      // 没有可探测的 Ollama（provider 是远端、或还没填地址）：若仍停留在
      // 初始/遗留的 checking 态，状态行会一直「检测 Ollama 服务…」转圈永不
      // 结束——这里 defer 一次把它落定为 down（不落在同步 effect 体里）。
      const settle = setTimeout(() => {
        setOllamaStatus((prev) => (prev === "checking" ? "down" : prev));
      }, 0);
      return () => clearTimeout(settle);
    }
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

  const openComfy = useCallback(async () => {
    setComfyOpening(true);
    try {
      const base = comfyStatusQ.data?.base ?? null;
      if (isDesktopShell()) {
        // 桌面壳内：优先在壳里开一个「子页签」窗口（Rust open_comfyui_window），
        // 不再拉起系统浏览器；无壳/未运行则走浏览器兜底（见 else 分支）。
        if (!base) {
          showFlash("err", "ComfyUI 未在运行，请先点「启动 ComfyUI」再打开查看");
          await comfyStatusQ.refetch();
          return;
        }
        // 桌面壳内：在同一个主窗口里开一个「ComfyUI」页签（iframe 内嵌），
        // 替代此前会弹出空白独立窗口的 open_comfyui_window 方案。
        // 用稳定 id 打开 ComfyUI 页签：重启后端口偏移（base 变化）时
        // 复用同一页签并刷新地址，而不是叠出重复页签。
        useShellTabs.getState().openTab({
          id: "comfyui",
          label: "ComfyUI",
          url: base,
          closable: true,
        });
        showFlash("ok", `已在页签中打开 ComfyUI（${base}）`);
      } else {
        // 浏览器 / dev 模式：没有可开窗的壳，走服务端命令用系统浏览器打开。
        const result = await comfyOpenM.mutateAsync();
        showFlash(result.ok ? "ok" : "err", result.detail);
      }
      // 无论成败都刷新状态行，修正探测抖动（如进程查询超时）造成的「未运行」显示。
      await comfyStatusQ.refetch();
    } catch (error) {
      showFlash("err", errorMessage(error, "打开 ComfyUI 失败"));
    } finally {
      setComfyOpening(false);
    }
  }, [comfyOpenM, comfyStatusQ, showFlash]);

  /* ── Drizzle Studio 启动 / 关闭 / 打开 ─────────────────── */
  const startDbStudio = useCallback(async () => {
    setDbStudioStarting(true);
    try {
      const result = await dbStudioStartM.mutateAsync();
      showFlash(result.ok ? "ok" : "err", result.detail);
      await dbStudioStatusQ.refetch();
    } catch (error) {
      showFlash("err", errorMessage(error, "启动 Drizzle Studio 失败"));
    } finally {
      setDbStudioStarting(false);
    }
  }, [dbStudioStartM, dbStudioStatusQ, showFlash]);

  const stopDbStudio = useCallback(async () => {
    setDbStudioStopping(true);
    try {
      const result = await dbStudioStopM.mutateAsync();
      showFlash(result.ok ? "ok" : "err", result.detail);
      await dbStudioStatusQ.refetch();
    } catch (error) {
      showFlash("err", errorMessage(error, "关闭 Drizzle Studio 失败"));
    } finally {
      setDbStudioStopping(false);
    }
  }, [dbStudioStopM, dbStudioStatusQ, showFlash]);

  const openDbStudio = useCallback(async () => {
    setDbStudioOpening(true);
    try {
      const result = await dbStudioOpenM.mutateAsync();
      showFlash(result.ok ? "ok" : "err", result.detail);
    } catch (error) {
      showFlash("err", errorMessage(error, "打开 Drizzle Studio 失败"));
    } finally {
      setDbStudioOpening(false);
    }
  }, [dbStudioOpenM, showFlash]);

  /** 用系统默认浏览器打开生成的远程资源（视频 / 公网图片等）。
   *  桌面壳内 target=_blank 外链打不开，统一走服务端 openExternal。 */
  const openExternalUrl = useCallback(async (url: string) => {
    if (!url) {
      showFlash("err", "没有可打开的资源地址");
      return;
    }
    try {
      const result = await openExternalM.mutateAsync({ url });
      showFlash(result.ok ? "ok" : "err", result.detail);
    } catch (error) {
      showFlash("err", errorMessage(error, "打开资源失败"));
    }
  }, [openExternalM, showFlash]);

  /* ── 应用自更新（Tauri updater + process）──────────────── */
  const checkAppUpdate = useCallback(async () => {
    if (appUpdateBusy !== "idle") return;
    setAppUpdateBusy("checking");
    setAppUpdateMessage(null);
    const result = await checkAppUpdateClient();
    setAppUpdateBusy("idle");
    setAppUpdateAvailable(result.available);
    setAppUpdateVersion(result.update?.version ?? null);
    setAppUpdateCurrent(result.update?.currentVersion ?? null);
    setAppUpdateMessage(result.detail);
  }, [appUpdateBusy]);

  const installAppUpdate = useCallback(async () => {
    if (appUpdateBusy !== "idle") return;
    setAppUpdateBusy("installing");
    setAppUpdateMessage(null);
    setAppUpdateProgress({ downloaded: 0 });
    const result = await downloadAndInstallUpdate((downloaded, total) => {
      setAppUpdateProgress({ downloaded, total });
    });
    setAppUpdateBusy("idle");
    setAppUpdateProgress(null);
    // 安装成功后应用通常会退出重启；失败时把可读错误透给用户。
    setAppUpdateMessage(
      result.triggered ? "更新已安装，应用即将重启…" : result.detail,
    );
  }, [appUpdateBusy]);

  const relaunchApp = useCallback(async () => {
    const result = await relaunchAppClient();
    if (!result.ok) {
      setAppUpdateMessage(result.detail);
    }
  }, []);

  /* ── ComfyUI 启动日志 ─────────────────────────────────── */
  const comfyLogOffsetRef = useRef(0);
  const [comfyLogText, setComfyLogText] = useState("");
  /* SGR 颜色序列解析成片段，视图层按样式渲染（Issue：启动日志显示颜色） */
  const [comfyLogSegments, setComfyLogSegments] = useState<AnsiSegment[]>([]);
  /* 启动进行中（本地动作或服务端自动拉起）即进入跟随轮询 */
  const comfyLogActive = comfyStarting || !!comfyStatusQ.data?.starting;

  const applyComfyLogSlice = useCallback(
    (mode: "append" | "replace", slice: FileLogSlice) => {
      const cleaned = slice.content.replace(COMFY_LOG_CR_RE, "");
      setComfyLogText((prev) =>
        capComfyLog(mode === "replace" ? cleaned : prev + cleaned),
      );
      setComfyLogSegments((prev) => {
        const incoming = parseAnsiSegments(cleaned);
        const merged = mode === "replace" ? incoming : [...prev, ...incoming];
        return merged.length > 4000 ? merged.slice(-4000) : merged;
      });
    },
    [],
  );

  const pullComfyLog = useCallback(
    async (mode: "append" | "replace") => {
      const slice = await fetchFileLogSlice(
        "comfyui-runtime",
        comfyLogOffsetRef.current,
      );
      if (!slice) return;
      /* 服务端回到 0 且本地游标非 0 → 日志被清空/重置，整体替换而非追加 */
      const replace =
        mode === "replace" ||
        (slice.offset === 0 && comfyLogOffsetRef.current > 0);
      comfyLogOffsetRef.current = slice.size;
      applyComfyLogSlice(replace ? "replace" : "append", slice);
    },
    [applyComfyLogSlice],
  );

  useEffect(() => {
    if (!comfyLogActive) return;
    void pullComfyLog("append");
    const timer = setInterval(
      () => void pullComfyLog("append"),
      COMFY_LOG_POLL_MS,
    );
    return () => clearInterval(timer);
  }, [comfyLogActive, pullComfyLog]);

  const refreshComfyLog = useCallback(async () => {
    comfyLogOffsetRef.current = 0;
    await pullComfyLog("replace");
  }, [pullComfyLog]);

  /* ── Drizzle Studio 启动日志 ────────────────────────────
   * drizzle-studio/lifecycle.ts 会把 spawn 参数与子进程 stdout/stderr 追加进
   * log/services/drizzle-studio-runtime.log；这里在启动期间每秒跟随尾部（同 ComfyUI）。 */
  const dbStudioLogOffsetRef = useRef(0);
  const [dbStudioLogText, setDbStudioLogText] = useState("");
  const [dbStudioLogSegments, setDbStudioLogSegments] = useState<AnsiSegment[]>(
    [],
  );
  const dbStudioLogActive =
    dbStudioStarting || !!dbStudioStatusQ.data?.starting;

  const applyDbStudioLogSlice = useCallback(
    (mode: "append" | "replace", slice: FileLogSlice) => {
      const cleaned = slice.content.replace(COMFY_LOG_CR_RE, "");
      setDbStudioLogText((prev) =>
        capComfyLog(mode === "replace" ? cleaned : prev + cleaned),
      );
      setDbStudioLogSegments((prev) => {
        const incoming = parseAnsiSegments(cleaned);
        const merged = mode === "replace" ? incoming : [...prev, ...incoming];
        return merged.length > 4000 ? merged.slice(-4000) : merged;
      });
    },
    [],
  );

  const pullDbStudioLog = useCallback(
    async (mode: "append" | "replace") => {
      const slice = await fetchFileLogSlice(
        "drizzle-studio-runtime",
        dbStudioLogOffsetRef.current,
      );
      if (!slice) return;
      const replace =
        mode === "replace" ||
        (slice.offset === 0 && dbStudioLogOffsetRef.current > 0);
      dbStudioLogOffsetRef.current = slice.size;
      applyDbStudioLogSlice(replace ? "replace" : "append", slice);
    },
    [applyDbStudioLogSlice],
  );

  useEffect(() => {
    if (!dbStudioLogActive) return;
    void pullDbStudioLog("append");
    const timer = setInterval(
      () => void pullDbStudioLog("append"),
      COMFY_LOG_POLL_MS,
    );
    return () => clearInterval(timer);
  }, [dbStudioLogActive, pullDbStudioLog]);

  const refreshDbStudioLog = useCallback(async () => {
    dbStudioLogOffsetRef.current = 0;
    await pullDbStudioLog("replace");
  }, [pullDbStudioLog]);

  /* ── Ollama 启动日志 ─────────────────────────────────────
   * ollama-start/route.ts 会把 spawn 参数与子进程 stdout/stderr 追加进
   * log/services/ollama-runtime.log；这里在启动期间每秒跟随尾部（同 ComfyUI/Drizzle）。 */
  const ollamaLogOffsetRef = useRef(0);
  const [ollamaLogText, setOllamaLogText] = useState("");
  /* SGR 颜色序列解析成片段，视图层按样式渲染（同 ComfyUI / Drizzle Studio） */
  const [ollamaLogSegments, setOllamaLogSegments] = useState<AnsiSegment[]>([]);
  const ollamaLogActive = ollamaStarting || ollamaStatus === "starting";

  const applyOllamaLogSlice = useCallback(
    (mode: "append" | "replace", slice: FileLogSlice) => {
      const cleaned = slice.content.replace(COMFY_LOG_CR_RE, "");
      setOllamaLogText((prev) =>
        capComfyLog(mode === "replace" ? cleaned : prev + cleaned),
      );
      setOllamaLogSegments((prev) => {
        /* Ollama 落盘的是 logrus 纯文本（无 ANSI 码），按 level= 语义上色 */
        const incoming = parseOllamaLogText(cleaned);
        const merged = mode === "replace" ? incoming : [...prev, ...incoming];
        return merged.length > 4000 ? merged.slice(-4000) : merged;
      });
    },
    [],
  );

  const pullOllamaLog = useCallback(
    async (mode: "append" | "replace") => {
      const slice = await fetchFileLogSlice(
        "ollama-runtime",
        ollamaLogOffsetRef.current,
      );
      if (!slice) return;
      const replace =
        mode === "replace" ||
        (slice.offset === 0 && ollamaLogOffsetRef.current > 0);
      ollamaLogOffsetRef.current = slice.size;
      applyOllamaLogSlice(replace ? "replace" : "append", slice);
    },
    [applyOllamaLogSlice],
  );

  useEffect(() => {
    if (!ollamaLogActive) return;
    void pullOllamaLog("append");
    const timer = setInterval(
      () => void pullOllamaLog("append"),
      COMFY_LOG_POLL_MS,
    );
    return () => clearInterval(timer);
  }, [ollamaLogActive, pullOllamaLog]);

  const refreshOllamaLog = useCallback(async () => {
    ollamaLogOffsetRef.current = 0;
    await pullOllamaLog("replace");
  }, [pullOllamaLog]);

  const stopOllamaFn = useCallback(async () => {
    setOllamaStopping(true);
    ollamaStoppingRef.current = true;
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
      ollamaStoppingRef.current = false;
    }
  }, [llmBaseUrl, probeOllama, showFlash]);

  /* ── 保存 ───────────────────────────────────────────────── */
  /** 把给定草稿落库。远程模型的添加 / 编辑 / 移除即时保存也走这里；
   *  apiKey 是「留空不改」语义：llmApiKey 为空就不传。 */
  const persistLlmDraft = useCallback(
    async (draft: LlmConfig): Promise<{ ok: boolean; error?: string }> => {
      setSaving(true);
      try {
        // option C：把「本地候选(字符串) + 远端独立模型(对象)」合并成一整份清单
        // 发给 configSave，由服务端按「字符串 vs 对象」各自写回 llmConfig / remoteModel 表。
        const payloadExtra: Array<string | RemoteModelEntry> = [
          ...draft.localCandidates,
          ...draft.extraModels,
        ];
        await saveLlmCfg.mutateAsync({
          provider: draft.provider,
          apiKey: llmApiKey || undefined,
          baseUrl: draft.baseUrl,
          model: draft.model,
          extraModels: payloadExtra,
          temperature: draft.temperature,
          temperatureByTask: draft.temperatureByTask,
          maxTokens: draft.maxTokens,
        });
        showFlash("ok", "LLM 配置已保存");
        if (llmApiKey) setLlmApiKey("");
        await llmQ.refetch();
        return { ok: true };
      } catch (error) {
        const msg = errorMessage(error, "保存失败");
        showFlash("err", msg);
        return { ok: false, error: msg };
      } finally {
        setSaving(false);
      }
    },
    [llmApiKey, saveLlmCfg, llmQ, showFlash],
  );

  const saveLlm = useCallback(async () => {
    if (!llmDraft) return;
    await persistLlmDraft(llmDraft);
  }, [llmDraft, persistLlmDraft]);

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

  /** 勾选/取消一个本地候选模型（多选集 = 主模型 + 勾选项）。
   *  option C：本地候选只存名字（字符串、无 apiKey），与远端独立模型(extraModels)
   *  彻底分开，不写进 remoteModel。 */
  const toggleExtraModel = useCallback((name: string) => {
    setLlmDraft((draft) => {
      if (!draft) return draft;
      const nextNames = mergeExtraModels(
        draft.localCandidates,
        draft.model,
        name,
      );
      const unchanged =
        nextNames.length === draft.localCandidates.length &&
        nextNames.every((n, i) => n === draft.localCandidates[i]);
      return unchanged ? draft : { ...draft, localCandidates: nextNames };
    });
  }, []);

  /* ── 远端模型管理 ──
   * 设置页只做「配置」：条目的增删改 + 测试连接，不区分「当前生效」——
   * 实际用哪个模型由工坊运行时切换（configSave.model）。
   * 增删改即时落库（无需再点保存按钮），失败时提示条给出可读错误。
   * 连通性 / 实际调用测试走服务端代理（apiKey 不直接打远端）。 */
  const addRemoteModel = useCallback(
    async (entry: {
      name: string;
      baseUrl?: string;
      apiKey?: string;
      kind?: RemoteModelKind;
    }): Promise<{ ok: boolean; error?: string }> => {
      if (!llmDraft)
        return { ok: false, error: "配置未就绪，请稍后重试" };
      const name = entry.name.trim();
      if (!name) return { ok: false, error: "请填写模型名称" };
      if (llmDraft.extraModels.some((e) => e.name === name)) {
        return { ok: false, error: `模型「${name}」已在列表中` };
      }
      const cleaned: RemoteModelEntry = {
        name,
        baseUrl: entry.baseUrl?.trim() ? entry.baseUrl.trim() : null,
        apiKey: entry.apiKey?.trim() ? entry.apiKey.trim() : null,
        kind: entry.kind ?? null,
      };
      const nextDraft = {
        ...llmDraft,
        extraModels: [...llmDraft.extraModels, cleaned],
      };
      setLlmDraft(nextDraft);
      return persistLlmDraft(nextDraft);
    },
    [llmDraft, persistLlmDraft],
  );

  const removeRemoteModel = useCallback(
    async (name: string): Promise<{ ok: boolean; error?: string }> => {
      if (!llmDraft)
        return { ok: false, error: "配置未就绪，请稍后重试" };
      const next = llmDraft.extraModels.filter((e) => e.name !== name);
      if (next.length === llmDraft.extraModels.length) return { ok: true };
      const nextDraft = { ...llmDraft, extraModels: next };
      setLlmDraft(nextDraft);
      return persistLlmDraft(nextDraft);
    },
    [llmDraft, persistLlmDraft],
  );

  /** 编辑既有条目（只作用于已配置条目）；改名时若当前生效模型引用的是旧名，
   *  同步改 draft.model —— 工坊按名字引用模型，不同步会指向不存在的名字。 */
  const updateRemoteModel = useCallback(
    async (
      name: string,
      patch: {
        name?: string;
        baseUrl?: string | null;
        apiKey?: string;
        clearApiKey?: boolean;
        kind?: RemoteModelKind | null;
      },
    ): Promise<{ ok: boolean; error?: string }> => {
      if (!llmDraft)
        return { ok: false, error: "配置未就绪，请稍后重试" };
      const nextName = (patch.name ?? name).trim();
      if (!nextName) return { ok: false, error: "请填写模型名称" };
      const existing = llmDraft.extraModels.find((e) => e.name === name);
      if (!existing) {
        return { ok: false, error: `模型「${name}」不存在，请刷新后重试` };
      }
      if (
        nextName !== name &&
        llmDraft.extraModels.some((e) => e.name === nextName)
      ) {
        return { ok: false, error: `模型「${nextName}」已在列表中` };
      }
      const updated: RemoteModelEntry = {
        name: nextName,
        baseUrl:
          patch.baseUrl === undefined
            ? (existing?.baseUrl ?? null)
            : patch.baseUrl,
        apiKey: patch.clearApiKey
          ? null
          : patch.apiKey?.trim()
            ? patch.apiKey.trim()
            : (existing?.apiKey ?? null),
        kind: patch.kind === undefined ? (existing?.kind ?? null) : patch.kind,
      };
      const nextDraft = {
        ...llmDraft,
        model: llmDraft.model === name ? nextName : llmDraft.model,
        extraModels: llmDraft.extraModels.map((e) =>
          e.name === name ? updated : e,
        ),
      };
      setLlmDraft(nextDraft);
      return persistLlmDraft(nextDraft);
    },
    [llmDraft, persistLlmDraft],
  );

  const probeRemote = useCallback(
    async (input: { baseUrl?: string; apiKey?: string; model?: string }) =>
      probeRemoteApi(input),
    [],
  );

  /** 模型「实际使用」测试（chat / 生图 / 生视频各一次真实调用）。
   *  网络封装在 lib/llm/usage-test-client，密钥解析在服务端完成。 */
  const testModelUsageFn = useCallback(
    async (input: UsageTestInput) => testModelUsage(input),
    [],
  );

  /** 「继续等待」已提交的异步视频任务（同一条目连接参数 + taskId，只查不重交）。
   *  网络封装在 lib/llm/usage-test-client，密钥解析在服务端完成。 */
  const queryUsageTaskFn = useCallback(
    async (input: UsageTaskQueryInput) => queryUsageTask(input),
    [],
  );

  /** 远端候选模型列表（配置视图，按保存顺序）——设置页不区分「当前生效」，
   *  用哪个模型由工坊运行时切换。 */
  const remoteModelList: RemoteModelEntry[] = llmDraft?.extraModels ?? [];

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
  const dbStudio = dbStudioStatusQ.data;

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
    toggleExtraModel,
    remoteModelList,
    addRemoteModel,
    updateRemoteModel,
    removeRemoteModel,
    probeRemote,
    testModelUsage: testModelUsageFn,
    queryUsageTask: queryUsageTaskFn,
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
          stopping: !!comfy.stopping,
          base: comfy.base ?? null,
          pathConfigured: !!comfy.pathConfigured,
          port: comfy.port ?? 0,
          instanceType: comfy.instanceType ?? null,
          desktopManaged: !!comfy.desktopManaged,
        }
      : null,
    comfyStarting,
    comfyStopping,
    comfyOpening,
    startComfy,
    stopComfy,
    openComfy,
    dbStudioStatus: dbStudio
      ? {
          up: !!dbStudio.up,
          starting: !!dbStudio.starting,
          port: dbStudio.port ?? 4983,
        }
      : null,
    dbStudioStarting,
    dbStudioStopping,
    dbStudioOpening,
    startDbStudio,
    stopDbStudio,
    openDbStudio,
    openExternalUrl,
    comfyLogText,
    comfyLogSegments,
    comfyLogActive,
    refreshComfyLog,
    dbStudioLogText,
    dbStudioLogSegments,
    dbStudioLogActive,
    refreshDbStudioLog,
    ollamaLogText,
    ollamaLogSegments,
    ollamaLogActive,
    refreshOllamaLog,
    ollamaStopping,
    stopOllama: stopOllamaFn,
    saving,
    saveLlm,
    savePrefs,
    flash,
    dismissFlash: useCallback(() => setFlash(null), []),
    setTaskTemperature,
    appUpdate: {
      inShell: isDesktopShell(),
      busy: appUpdateBusy,
      available: appUpdateAvailable,
      version: appUpdateVersion,
      currentVersion: appUpdateCurrent,
      message: appUpdateMessage,
      progress: appUpdateProgress,
    },
    checkAppUpdate,
    installAppUpdate,
    relaunchApp,
  };
}

/** 侧边栏分区 —— 纯配置，视图直接消费。本地 / 远程模型各自独立成页。 */
export const SETTINGS_SECTIONS: { id: Section; label: string }[] = [
  { id: "appearance", label: "外观" },
  { id: "appUpdate", label: "应用更新" },
  { id: "llmLocal", label: "本地模型" },
  { id: "llmRemote", label: "远程模型" },
  { id: "comfyui", label: "创作后端" },
  { id: "database", label: "数据库" },
  { id: "exit", label: "退出与后台服务" },
];

/** 按任务温度区的任务清单 —— 视图遍历渲染，顺序即渲染顺序。 */
export const TEMPERATURE_TASKS = Object.entries(TASK_TYPES) as [
  TaskType,
  (typeof TASK_TYPES)[TaskType],
][];
