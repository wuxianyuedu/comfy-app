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
import { useFlashLatch } from "~/components/ui/use-flash-state";
import { useExternalAction } from "~/components/ui/use-external-action";

/* 默认端口从 `~/lib/endpoints` 取（零依赖常量层）：它同时被设置页视图消费，
 * 而 `app-settings.ts` 顶层 import fs —— 走那条路会让设置页整页 500（ISSUE #282/#317）。 */
import { COMFYUI_DEFAULT_PORT } from "~/lib/endpoints";
import { runAsyncAction } from "~/lib/async-action";
import { useReentrancyLock } from "~/components/ui/use-reentrancy-lock";
import { errorMessage, rawErrorDetail } from "~/lib/error-message";
import { isDesktopShell } from "~/lib/shell/desktop-shell-client";
import { useShellTabs } from "~/lib/shell/shell-tabs-store";
import { openComfyTab } from "~/lib/comfy/comfy-tab-client";
import {
  checkAppUpdate as checkAppUpdateClient,
  downloadAndInstallUpdate,
  relaunchApp as relaunchAppClient,
} from "~/lib/shell/app-update-client";
import { parseOllamaLogText } from "~/lib/log/log-ansi";
import { postAppRuntimeLog } from "~/lib/log/log-file-client";
import {
  probeOllama as probeOllamaClient,
  startOllama as startOllamaClient,
  stopOllama as stopOllamaClient,
  type OllamaModel,
} from "~/lib/llm/ollama-client";
import { probeRemoteApi, type RemoteProbeResult } from "~/lib/llm/browser";
import { OLLAMA_READY } from "~/lib/retry-policy";
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

import {
  useRuntimeLogSource,
  type RuntimeLogController,
} from "./use-runtime-log-source";

export type Settings = {
  trainerUrl: string;
  comfyLorasDir: string;
  comfyuiPath: string;
  comfyuiExtraArgs: string;
  comfyuiAutoStart: boolean;
  /** ComfyUI 监听端口；0 = 默认 8188（启动时按需显式传 --port）。 */
  comfyuiPort: number;
  /** 应用退出是否连带关闭自己拉起的 ComfyUI（默认 false=保活，退出后继续运行）。 */
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

/**
 * 服务端下发的 LLM 配置形状（`llm.configGet` 的出口）。
 *
 * 与草稿 {@link LlmConfig} 的唯一差别在 `extraModels`：下发的是「本地候选字符串 +
 * 远端条目对象」的混合清单（保存时按类型各自写回），而草稿在播种时就拆成了
 * `localCandidates` 与 `extraModels` 两栏。因此「读取兜底缓存」按本类型存。
 */
export type QueryLlmConfig = Omit<
  LlmConfig,
  "extraModels" | "localCandidates" | "temperatureByTask" | "apiKey"
> & {
  /** 服务端出口的 apiKey 可选（未配置时为 undefined 而非 null）。 */
  apiKey?: string | null;
  /** 混合清单：字符串 = 本地候选，对象 = 远端独立模型。 */
  extraModels: Array<string | RemoteModelEntry>;
  /** 服务端可能下发 null（表示「未配置覆盖」），草稿层归一为 undefined。 */
  temperatureByTask?: Record<TaskType, number> | null;
  /** 下发形状不含该栏（它是草稿侧拆出来的），容错为可选。 */
  localCandidates?: string[];
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
  /** ComfyUI 默认端口（未配置端口时的兜底）：视图的 placeholder / 说明文案用它取值，
   *  避免把默认端口在文案里再写一遍（规范 §12.14：默认端口单点定义）。 */
  comfyDefaultPort: number;
  /** 侧边栏当前分区（纯视觉偏好，但影响渲染哪个表单，故由逻辑层持有）。 */
  section: Section;
  setSection: (section: Section) => void;
  /* 外观主题：Light / Dark（持久化偏好，统一走 next-themes）。 */
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
  /* 加载 / 错误 */
  isInitialLoad: boolean;
  /** 加载失败**且**两份草稿都没就绪 —— 容器据此渲染错误降级视图。 */
  hasError: boolean;
  /** 加载未失败、也没在加载，但草稿仍未就绪（理论上不可达，视图兜底用）。 */
  notReady: boolean;
  /** 失败时给用户看的人话文案（原文见日志的 `raw` 字段）。 */
  errorText: string;
  retry: () => void;
  /**
   * 「读不到 / 刚保存的配置」类失败的**可续用**状态（ISSUE #360）：
   * 草稿已由缓存兜底播种，界面可用，只是当次刷新失败——视图据此在顶部渲染一条
   * **非阻塞**提示条（含重试），而不是把整页换成错误视图。
   *
   * 与 `hasError` 的分工：`hasError` = 失败 **且** 连兜底草稿都没有（真的没法用）；
   * `serveState` = 有兜底草稿时的「降级但可用」。两者互斥。
   */
  serveState: { errorText: string } | null;
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
    /** 服务端探测仍在进行 / 事实不可信：状态行显示「检测中…」而不是「未运行」，
     *  避免外部已启动的实例被先误报一次未运行（ISSUE #339）。 */
    probing: boolean;
    /** 服务端「关闭中」窗口（globalThis 计时，可跨设置页挂载存活）：见 ISSUE #103 */
    stopping: boolean;
    base: string | null;
    port: number;
    /** 进程用什么起的（中文短语）：只有端口监听在、HTTP 未就绪时也非空，
     *  状态行据此提示「接口未就绪，可能仍在启动」。 */
    via: string | null;
  } | null;
  /** 安装形态：**只读文件系统的快速判据**，与 comfyStatus 分开取。
   *
   * 为什么不合进 comfyStatus：comfyStatus 要付「进程表查询 + 端口探测」（秒级），
   * 而形态只需毫秒级 fs 判定；合在一起时徽标与「端口/启动参数是否隐藏」会被拖到
   * 探测结束才出现（改路径保存后也一样）。这条与首屏的 `setting.get` 同批返回。 */
  comfyInstance: {
    /** 配置里是否填了路径（与形态同源，都是设置行的事实）。 */
    pathConfigured: boolean;
    /** 桌面版 / 便携版 / venv；未配置路径或判不出形态时为 null。 */
    instanceType: "desktop" | "portable" | "venv" | null;
    /** 桌面实例且能读到实例 ID → 端口/参数由 Comfy Desktop 元数据决定，
     *  设置页据此隐藏 端口/启动参数 输入。 */
    desktopManaged: boolean;
  } | null;
  comfyStarting: boolean;
  comfyStopping: boolean;
  comfyOpening: boolean;
  /** 浏览器打开动作进行中（与页签打开各自独立，便于分别显示忙碌态）。 */
  comfyBrowserOpening: boolean;
  startComfy: () => Promise<void>;
  stopComfy: () => Promise<void>;
  openComfy: () => Promise<void>;
  /** 用系统默认浏览器打开运行中的 ComfyUI（页签内嵌之外的并列出口）。 */
  openComfyInBrowser: () => Promise<void>;
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
  /* 启动日志（log/services/*-runtime.log）：三个分区共用同一套「按会话切分 +
     跟随 + 刷新」的状态，见 use-runtime-log-source（视图只渲染）。 */
  comfyLog: RuntimeLogController;
  dbStudioLog: RuntimeLogController;
  ollamaLog: RuntimeLogController;
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

/* 「没有提示」的空载荷：模块级常量，身份稳定（`useFlashLatch` 的依赖）。 */
const NO_FLASH: FlashMessage | null = null;

/* ── 配置读取的兜底缓存（ISSUE #360）──────────────────────────────────────
 * 设置页的两份读（`setting.get` / `llm.configGet`）是服务端最脆弱的两跳：前者走
 * SQLite，后者还要先跑 remote storage 迁移。应用服务刚重启 / 正在编译 / 数据库
 * 迁移的那几秒里，查询会失败——此前整页被换成「加载设置失败」，而界面本来能用。
 *
 * 兜底值 = 「最后一次成功读到的配置」：
 *   - 本会话内：`lastGood` 状态（内存，最权威，含用户刚保存的草稿）；
 *   - 跨刷新/重开：sessionStorage 里的一份快照（`readSettingsCache`）。
 *
 * 只放**配置**，不放密钥类输入态（API Key 输入框始终从空开始）。写失败
 * （隐私模式 / 配额）静默忽略：缓存是锦上添花，绝不影响主流程。
 */
const SETTINGS_CACHE_KEY = "settingsPage.lastGoodConfig.v1";

function readSettingsCache(): { llm?: QueryLlmConfig; settings?: Settings } {
  try {
    const raw = sessionStorage.getItem(SETTINGS_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as {
      llm?: QueryLlmConfig;
      settings?: Settings;
    };
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeSettingsCache(value: {
  llm?: QueryLlmConfig;
  settings?: Settings;
}): void {
  try {
    sessionStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(value));
  } catch {
    /* 隐私模式 / 配额超限：放弃持久化，兜底退化为「仅本次会话有效」 */
  }
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

/** Ollama 启动就绪轮询：**固定间隔 + 有界次数** —— 取值走
 *  `~/lib/retry-policy` 的 {@link OLLAMA_READY}（20 次 × 2s，覆盖冷启动的
 *  常见耗时；固定 2s 是为了让状态行尽快反映就绪，见 §16.2.4.49）。 */
const OLLAMA_START_POLL_TIMES = OLLAMA_READY.maxAttempts;
const OLLAMA_START_POLL_INTERVAL_MS = OLLAMA_READY.baseMs;

/** 设置页全部状态与动作 —— 见文件头注释的分层说明。 */
export function useSettingsPage(): SettingsPageController {
  const [section, setSection] = useState<Section>("llmLocal");
  const { theme, setTheme } = useTheme();
  const [saving, setSaving] = useState(false);

  /* 应用自更新：检测 / 下载安装的进行态与结果。运算放 lib/app-update-client，
   * 这里只记 UI 需要的暂态（夹在壳交互与视图中层）。 */
  const [appUpdateBusy, setAppUpdateBusy] = useState<
    "idle" | "checking" | "installing"
  >("idle");
  /* 检测 / 下载安装的单飞闸门（规范 16 §16.2.4.69）：两者共用一把 ——
   * 「检测中」时点「安装」会读到还没提交的 `idle`，于是并发发出去。 */
  const appUpdateLock = useReentrancyLock();
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
   * 动作（终止进程树 + 等端口释放）最长可挂 5s，期间 useEffect 触发的探测
   * 会把状态行抢回「未运行」并重开「关闭 Ollama」按钮（同 #103 的
   * 「操作后状态被覆盖」族问题）。 */
  const ollamaStoppingRef = useRef(false);
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const [comfyStarting, setComfyStarting] = useState(false);

  const settingsQ = api.setting.get.useQuery();
  const llmQ = api.llm.configGet.useQuery();
  /* 这两份查询的「最后一次成功结果」：读取失败时用它兜底播种草稿。
   *
   * 为什么必须兜底（ISSUE #360）：设置页此前把「一次刷新失败」当成「整页不可用」，
   * 直接把界面换成错误视图。而这两份配置恰恰是**服务端最脆弱的两个读**——`setting.get`
   * 走 SQLite，`llm.configGet` 还要先跑一次 remote storage 迁移。应用服务刚重启、
   * 编译中、或数据库正在迁移的那几秒里，用户看到的是一整页「加载设置失败」，
   * 而界面本来完全能用（草稿来自上一次成功的读取）。用户的原话就是「设置这边经常
   * 出现这个问题」。
   *
   * 兜底只在「真的有过成功结果」时生效：没有历史结果（首次启动就失败）仍走全页
   * 降级——那时界面确实无从渲染，给错误视图是诚实的。 */
  /* 缓存的是**服务端下发的形状**（`extraModels` 是「字符串 | 对象」的混合清单，
   * 与草稿里的 `LlmConfig` 不同——后者已拆分）。这里按查询返回类型收，播种时再拆。
   *
   * 用 state 而非 ref：下面的播种与「失败兜底」都在渲染期读它，而 React 19 的
   * `react-hooks/refs` 规则禁止渲染期读写 ref（ref 的变化不参与渲染，读了会拿到
   * 陈旧值）。state 的首值从 sessionStorage 取，天然支持「刷新后立刻失败」的场景。 */
  const [lastGood, setLastGood] = useState<{
    llm?: QueryLlmConfig;
    settings?: Settings;
  }>(() => (typeof globalThis === "undefined" ? {} : readSettingsCache()));
  const saveSetting = api.setting.save.useMutation();
  const saveLlmCfg = api.llm.configSave.useMutation();
  /* ComfyUI / Drizzle Studio 状态探测延后到首屏两份配置就绪后再发：
   * comfyStatus 在 ComfyUI 未运行时要对连续端口段做超时探测（秒级），
   * 同挂载触发会被 httpBatchLink 并进首屏同一批请求，而批量响应不分块
   * 流式返回 —— 首屏只需要的 get/configGet 会被迫等整批结束，页面
   * 多停在加载态数秒。 */
  const statusQueriesEnabled = !!settingsQ.data && !!llmQ.data;
  /* 轮询间隔：默认 5s（外部/命令行启动的 ComfyUI 能被及时认出来）；窗口聚焦
   * 时隔更短，让「切回设置页」几乎立刻看到真实状态（ISSUE #339 的「打开界面
   * 要等一会才显示在运行」）。服务端有进程级快照 + HTTP 探测兜底，间隔收紧
   * 不会把压力转成卡顿。 */
  /* 安装形态：**不 gate 在 statusQueriesEnabled 上**，与首屏的 get/configGet 同批
   * 发出 —— 它是 fs-only 的毫秒级判据，跟着 comfyStatus 一起等秒级探测就白拆了。
   * 改路径 / 启动参数后由 savePrefs、startComfy 手动 refetch（形态依赖路径）。 */
  const comfyInstanceQ = api.setting.comfyInstance.useQuery();
  const comfyStatusQ = api.setting.comfyStatus.useQuery(undefined, {
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    enabled: statusQueriesEnabled,
  });
  const comfyStartM = api.setting.comfyStart.useMutation();
  const comfyStopM = api.setting.comfyStop.useMutation();
  /* 「在浏览器打开」：服务端能力早就有了（openComfyUi → openUrlInBrowser 拉起
   * 系统默认浏览器），此前只缺一个能点到它的入口。与页签内嵌**并列**，不替代。 */
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
  const [ollamaStopping, setOllamaStopping] = useState(false);

  /* 设置页的整页提示条：亮起 3.5s 自动收起。定时器管理（连点清旧、
   * 卸载清掉）由 `useFlashLatch` 收口 —— 此前这里是手写的 `flashTimerRef`，
   * 与全库另一处（`logs/SaveExportButton`）逐行同款、各写一份。 */
  const flashLatch = useFlashLatch(FLASH_MS, NO_FLASH);
  const showFlash = useCallback(
    (kind: "ok" | "err", text: string) => flashLatch.flash({ kind, text }),
    [flashLatch],
  );

  /* ── 从查询结果播种草稿 ─────────────────────────────────────
   * 「渲染期对比上一次引用 → setState」是 React 官方推荐的 derived-state 写法，
   * 比 useEffect 少一次多余渲染，也不会闪旧值。 */
  const llmConfig = llmQ.data?.config ?? null;
  /* 每次拿到成功结果就更新缓存（供下次打开/下次失败时兜底）。与下面的播种同属
   * 「从查询结果派生草稿」的一步（渲染期对比上一次引用 → setState 是 React 官方
   * 推荐的 derived-state 写法，比 useEffect 少一次多余渲染）。 */
  if (llmConfig && lastGood.llm !== llmConfig) {
    setLastGood((prev) => ({ ...prev, llm: llmConfig }));
  }
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
      extraModels: split.remoteEntries.filter(
        (e) => e.name !== llmConfig.model,
      ),
      temperatureByTask: llmConfig.temperatureByTask ?? undefined,
    });
  }
  const settingsData = settingsQ.data?.settings ?? null;
  if (settingsData && lastGood.settings !== settingsData) {
    setLastGood((prev) => ({ ...prev, settings: settingsData }));
  }
  const [prevSettingsData, setPrevSettingsData] = useState(settingsData);
  /* 同 llm 播种：缓存命中 / refetch 两种情形都要能落到草稿，避免落到降级 UI。 */
  const settingsChanged = settingsData !== prevSettingsData;
  if (settingsChanged) setPrevSettingsData(settingsData);
  if (settingsData && (settingsChanged || !settingsDraft)) {
    setSettingsDraft(settingsData);
  }

  /* ── 读取失败时的兜底播种（ISSUE #360）─────────────────────────
   * 查询真的失败（不是还在加载）而草稿仍为空时，用「最后一次成功结果」（本次
   * 会话内存里的，或上次运行留在 sessionStorage 的）把草稿播回来——界面立刻可用，
   * 失败原因通过 `serveState` 以非阻塞提示条呈现（见下方 return）。
   *
   * 只在失败时兜底：正在加载（首帧）不播种，避免先闪一份旧值再跳到真实值。 */
  if (llmDraft === null && llmQ.isError && lastGood.llm) {
    const cached = lastGood.llm;
    const split = splitExtraModels(cached.extraModels);
    setLlmDraft({
      ...cached,
      apiKey: cached.apiKey ?? null,
      localCandidates: split.localNames.filter((n) => n !== cached.model),
      extraModels: split.remoteEntries.filter((e) => e.name !== cached.model),
      temperatureByTask: cached.temperatureByTask ?? undefined,
    });
  }
  if (settingsDraft === null && settingsQ.isError && lastGood.settings) {
    setSettingsDraft(lastGood.settings);
  }
  /* 快照写回 sessionStorage：跨整页刷新（dev server 重启会让页面重新加载）后
   * 仍能兜底。只在确有内容时写，避免把空对象盖掉上一份有效快照。 */
  if (lastGood.llm ?? lastGood.settings) {
    writeSettingsCache(lastGood);
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
    /* 「拉起 → 轮询等就绪 → 超时抛错」整段交给出口报成败：失败路径的文案
     *（含超时那句自带可执行动作的说明）走 `errorMessage`，成功静默
     *（状态行自己会变成「已运行」，是这条账里唯一不需要额外说一句的落点）。 */
    const result = await (async () => {
      try {
        return await runAsyncAction(
          async () => {
            await startOllamaClient();
            // 轮询等就绪再交回控制权：期间保持「启动中…」按钮禁用。以前 POST 完
            // 固定睡 2s 就探一次，ollama 冷启动远不止 2s，状态行变回「未运行」、
            // 按钮恢复可点，用户误以为失败会连点——每次点击都再拉起一个 serve
            // 进程，多进程抢 11434 端口在 Windows 上连环弹「端口被占用」错误框。
            for (let i = 0; i < OLLAMA_START_POLL_TIMES; i++) {
              if (llmBaseUrl) {
                const probe = await probeOllamaClient(llmBaseUrl);
                if (probe.up) {
                  setOllamaModels(probe.models);
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
          },
          { report: showFlash, failureText: "启动 Ollama 失败" },
        );
      } finally {
        setOllamaStarting(false);
        ollamaStartingRef.current = false;
      }
    })();
    // 超时/失败后兜底探一次，让状态行和进程的真实情况对齐
    if (!result.ok && llmBaseUrl) await probeOllamaSilent(llmBaseUrl);
  }, [llmBaseUrl, probeOllamaSilent, showFlash]);

  /* ── ComfyUI 启动 ───────────────────────────────────────── */
  const startComfy = useCallback(async () => {
    setSaving(true);
    setComfyStarting(true);
    try {
      await runAsyncAction(
        async () => {
          await saveSetting.mutateAsync({
            comfyuiPath: settingsDraft?.comfyuiPath,
            comfyuiExtraArgs: settingsDraft?.comfyuiExtraArgs,
            comfyuiAutoStart: settingsDraft?.comfyuiAutoStart,
            comfyuiPort: settingsDraft?.comfyuiPort,
          });
          const result = await comfyStartM.mutateAsync({});
          await comfyStatusQ.refetch();
          // 启动动作会先把当前草稿（含路径）落库：形态跟着重判定一次。
          await comfyInstanceQ.refetch();
          /* 端点返回 `{ ok, detail }` 的信封（服务端自己探过启动结果），
           * 交给出口按同一口径读 —— 调用处不再写 `result.ok ? "ok" : "err"`。 */
          return result;
        },
        { report: showFlash, failureText: "启动 ComfyUI 失败" },
      );
    } finally {
      setSaving(false);
      setComfyStarting(false);
    }
  }, [
    settingsDraft,
    saveSetting,
    comfyStartM,
    comfyStatusQ,
    comfyInstanceQ,
    showFlash,
  ]);

  const stopComfy = useCallback(async () => {
    setSaving(true);
    setComfyStopping(true);
    try {
      await runAsyncAction(
        async () => {
          const result = await comfyStopM.mutateAsync();
          await comfyStatusQ.refetch();
          return result;
        },
        { report: showFlash, failureText: "关闭 ComfyUI 失败" },
      );
    } finally {
      setSaving(false);
      setComfyStopping(false);
    }
  }, [comfyStopM, comfyStatusQ, showFlash]);

  const openComfy = useCallback(async () => {
    setComfyOpening(true);
    try {
      /* 点「打开查看」前先要一份新鲜状态：用户此刻的意图就是「打开我在运行的
       * 实例」，拿几秒前的旧结论会直接报「未在运行」并把按钮禁用掉（ISSUE #339
       * 里「外部已经启动了，界面却打不开」的观感来源）。 */
      const fresh = await comfyStatusQ.refetch();
      const base = fresh.data?.base ?? comfyStatusQ.data?.base ?? null;
      if (!base) {
        showFlash("err", "ComfyUI 未在运行，请先点「启动 ComfyUI」再打开查看");
        await comfyStatusQ.refetch();
        return;
      }
      /* 打开方式由服务端探测结论决定（ISSUE #310）：目标是**只有多页签**，
       * 不弹第二个窗口。正常情况下 ComfyUI 由本应用拉起、启动参数带了
       * `--enable-cors-header`，跨源不会被 origin-only 中间件拦 403，直接
       * 内嵌；万一判到不可嵌（外部实例不受本应用参数控制等），页签照常
       * 打开、里面渲染可读说明 —— 仍留在同一个窗口里，不另开窗口。 */
      const decision = await openComfyTab(base, window.location.origin);
      // 用稳定 id 打开 ComfyUI 页签：重启后端口偏移（base 变化）时
      // 复用同一页签并刷新地址，而不是叠出重复页签。
      useShellTabs.getState().openTab({
        id: "comfyui",
        label: "ComfyUI",
        url: decision.embedUrl,
        closable: true,
        blockedReason: decision.target === "blocked" ? decision.detail : null,
        /* 不可嵌时把地址一并带进说明：用户能复制到浏览器自查，也能判断
         * 是外壳拦的还是 ComfyUI 自己拦的（ISSUE #310）。 */
        blockedUrl: decision.target === "blocked" ? decision.base : null,
      });
      showFlash(decision.target === "embed" ? "ok" : "err", decision.detail);
      // 无论成败都刷新状态行，修正探测抖动（如进程查询超时）造成的「未运行」显示。
      await comfyStatusQ.refetch();
    } catch (error) {
      showFlash("err", errorMessage(error, "打开 ComfyUI 失败"));
      // 失败同样要刷新状态行（与上面那条同源：探测抖动造成的「未运行」显示）。
      await comfyStatusQ.refetch();
    } finally {
      setComfyOpening(false);
    }
  }, [comfyStatusQ, showFlash]);

  /* 「在浏览器打开」＝把 ComfyUI 交给系统默认浏览器（放大看 / 装浏览器插件 /
   * 多屏铺开）。它与页签内嵌是**并列出口**，不改变页签那一套：页签仍然内嵌，
   * 这里只是把同一个地址再交给浏览器。
   *
   * 端点用 comfyOpen 而不是 openExternal：地址由服务端自己探（openComfyUi 内部
   * 先 probeComfyUi），不采信前端 state 里的旧 base —— 用户点按钮时可能已经
   * 隔了很久，端口可能已经变了，拿旧地址会打开一个空白浏览器页。
   *
   * 与 openComfy 一样先 refetch 一次状态，避免拿几秒前的旧结论误报「未运行」。 */
  const openComfyInBrowserAction = useExternalAction({
    target: "browser",
    report: showFlash,
  });
  const openComfyInBrowser = useCallback(async () => {
    await openComfyInBrowserAction.run(async () => {
      await comfyStatusQ.refetch();
      return comfyOpenM.mutateAsync();
    });
  }, [openComfyInBrowserAction, comfyOpenM, comfyStatusQ]);

  /* ── Drizzle Studio 启动 / 关闭 / 打开 ─────────────────── */
  const startDbStudio = useCallback(async () => {
    setDbStudioStarting(true);
    try {
      await runAsyncAction(
        async () => {
          const result = await dbStudioStartM.mutateAsync();
          await dbStudioStatusQ.refetch();
          return result;
        },
        { report: showFlash, failureText: "启动 Drizzle Studio 失败" },
      );
    } finally {
      setDbStudioStarting(false);
    }
  }, [dbStudioStartM, dbStudioStatusQ, showFlash]);

  const stopDbStudio = useCallback(async () => {
    setDbStudioStopping(true);
    try {
      await runAsyncAction(
        async () => {
          const result = await dbStudioStopM.mutateAsync();
          await dbStudioStatusQ.refetch();
          return result;
        },
        { report: showFlash, failureText: "关闭 Drizzle Studio 失败" },
      );
    } finally {
      setDbStudioStopping(false);
    }
  }, [dbStudioStopM, dbStudioStatusQ, showFlash]);

  const openDbStudioAction = useExternalAction({
    target: "browser",
    report: showFlash,
  });
  const openDbStudio = useCallback(async () => {
    await openDbStudioAction.run(() => dbStudioOpenM.mutateAsync());
  }, [openDbStudioAction, dbStudioOpenM]);

  /** 用系统默认浏览器打开生成的远程资源（视频 / 公网图片等）。
   *  桌面壳内 target=_blank 外链打不开，统一走服务端 openExternal。 */
  const openExternalAction = useExternalAction({
    target: "browser",
    report: showFlash,
  });
  const openExternalUrl = useCallback(
    async (url: string) => {
      await openExternalAction.runWithTarget(url, (target) =>
        openExternalM.mutateAsync({ url: target }),
      );
    },
    [openExternalAction, openExternalM],
  );

  /* ── 应用自更新（Tauri updater + process）──────────────── */
  const checkAppUpdate = useCallback(async () => {
    /* 重入判据走唯一出口（规范 16 §16.2.4.69）：读 `appUpdateBusy` 是同一次
     * 事件循环里判不出的（`setAppUpdateBusy` 是异步落状态的）。 */
    if (!appUpdateLock.tryEnter()) return;
    setAppUpdateBusy("checking");
    setAppUpdateMessage(null);
    const result = await checkAppUpdateClient();
    setAppUpdateBusy("idle");
    setAppUpdateAvailable(result.available);
    setAppUpdateVersion(result.update?.version ?? null);
    setAppUpdateCurrent(result.update?.currentVersion ?? null);
    setAppUpdateMessage(result.detail);
    appUpdateLock.exit();
  }, [appUpdateLock]);

  const installAppUpdate = useCallback(async () => {
    if (!appUpdateLock.tryEnter()) return;
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
    appUpdateLock.exit();
  }, [appUpdateLock]);

  const relaunchApp = useCallback(async () => {
    const result = await relaunchAppClient();
    if (!result.ok) {
      setAppUpdateMessage(result.detail);
    }
  }, []);

  /* ── 常驻服务启动日志（ComfyUI / Drizzle Studio / Ollama）─────────────
   * 三条通道都是「追加不轮转」的文件（多次启动的行混在一起），服务端按会话
   * 横幅切分后回「会话列表 + 选中会话正文」，见 use-runtime-log-source。
   * `active` = 正在启动 → 每秒跟随本次启动；否则挂载 / 刷新时取一次。 */
  const comfyLogActive = comfyStarting || !!comfyStatusQ.data?.starting;
  const comfyLog = useRuntimeLogSource({
    source: "comfyui-runtime",
    active: comfyLogActive,
  });
  const dbStudioLogActive =
    dbStudioStarting || !!dbStudioStatusQ.data?.starting;
  const dbStudioLog = useRuntimeLogSource({
    source: "drizzle-studio-runtime",
    active: dbStudioLogActive,
  });
  const ollamaLogActive = ollamaStarting || ollamaStatus === "starting";
  const ollamaLog = useRuntimeLogSource({
    source: "ollama-runtime",
    active: ollamaLogActive,
    /* Ollama 落盘的是 logrus 纯文本（无 ANSI 码），按 level= 语义上色 */
    parse: parseOllamaLogText,
  });

  const stopOllamaFn = useCallback(async () => {
    setOllamaStopping(true);
    ollamaStoppingRef.current = true;
    /* 「停止 → 重新探测」两段都跑（无论成败状态行都要对齐），
     * 所以探测不进 `action` —— 它在 finally 的语义上，不在成功分支上。 */
    try {
      await runAsyncAction(() => stopOllamaClient(), {
        report: showFlash,
        failureText: "关闭 Ollama 失败",
        successText: "Ollama 已关闭",
      });
    } finally {
      setOllamaStopping(false);
      ollamaStoppingRef.current = false;
    }
    // 停止后重新探测，状态行回到「未运行」
    if (llmBaseUrl) await probeOllama(llmBaseUrl);
  }, [llmBaseUrl, probeOllama, showFlash]);

  /* ── 保存 ───────────────────────────────────────────────── */
  /** 把给定草稿落库。远程模型的添加 / 编辑 / 移除即时保存也走这里；
   *  apiKey 是「留空不改」语义：llmApiKey 为空就不传。 */
  const persistLlmDraft = useCallback(
    async (draft: LlmConfig): Promise<{ ok: boolean; error?: string }> => {
      setSaving(true);
      /* 这一处**同时**要「反馈通道」与「返回值给调用方继续用」：
       * 出口的返回值正是为此给的（收口前这里是 `catch` 里再拼一次
       * `errorMessage` 并 return 一个 `{ok,error}`）。 */
      try {
        const result = await runAsyncAction(
          async () => {
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
            if (llmApiKey) setLlmApiKey("");
            await llmQ.refetch();
          },
          {
            report: showFlash,
            failureText: "保存失败",
            successText: "LLM 配置已保存",
          },
        );
        return result.ok
          ? { ok: true as const }
          : { ok: false as const, error: result.detail };
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
      await runAsyncAction(
        async () => {
          await saveSetting.mutateAsync(settingsDraft);
          await settingsQ.refetch();
          // 形态是「配置路径的目录形态」的函数：路径可能刚被改过，立即重判定一次
          // （不必等 5s 轮询，也不该再走一次秒级运行态探测）。
          await comfyInstanceQ.refetch();
        },
        {
          report: showFlash,
          failureText: "保存失败",
          successText: "偏好已保存",
        },
      );
    } finally {
      setSaving(false);
    }
  }, [settingsDraft, saveSetting, settingsQ, comfyInstanceQ, showFlash]);

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
      if (!llmDraft) return { ok: false, error: "配置未就绪，请稍后重试" };
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
      if (!llmDraft) return { ok: false, error: "配置未就绪，请稍后重试" };
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
      if (!llmDraft) return { ok: false, error: "配置未就绪，请稍后重试" };
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

  /* ── 加载失败判定 ────────────────────────────────────────────
   * 「任一查询失败」与「两份配置都没拿到」是两件事。此前 `hasError` 只按
   * 「两份数据都为空」判定，于是「setting.get 成功、llm.configGet 失败」时：
   * 失败为真、草稿却仍为空 → 既不满足 hasError、也不满足 isInitialLoad，
   * 容器一路落到那句没有重试、没有原因、也没有日志指引的「配置数据未就绪」，
   * 用户被冻在死胡同里（正是 ISSUE #304 截图的现象）。
   * 现在把两个语义拆开：
   *   - `queryFailed`：任一查询 isError（错误视图与补记日志的判据）；
   *   - `hasError`：queryFailed **且** 草稿未就绪（容器据此走降级视图）。
   * 「一半成功一半失败」时草稿同样为空，因此也会落到错误视图，拿到重试与
   * 日志出口，而不是死角文案。 */
  const queryFailed = !!settingsQ.isError || !!llmQ.isError;
  const isInitialLoad = settingsQ.isLoading || llmQ.isLoading;

  /* 多查询同批失败时，优先展示「更靠近根因」的那条：两份都没拿到时按
   * settings → llm 顺序取第一条非空错误（都是 undefined 时交 fallback）。 */
  const failedError =
    (settingsQ.isError ? settingsQ.error : undefined) ??
    (llmQ.isError ? llmQ.error : undefined);

  const errorText = queryFailed ? errorMessage(failedError, "未知错误") : "";

  /* 失败涉及的查询名（给面板日志的字段用；两个都失败时都记上）。 */
  const failedQueries = [
    settingsQ.isError ? "setting.get" : null,
    llmQ.isError ? "llm.configGet" : null,
  ]
    .filter((name): name is string => name !== null)
    .join(",");

  /* 加载失败落 app-runtime 错误日志（面板轮询 source=app-runtime 可见）。
   * 查询失败只体现在降级 UI，不经过 console / unhandledrejection，全局
   * 错误钩子收不到——不主动补记的话，用户遇到失败时面板里什么也没有。
   * 同一错误文案只记一次（ref 去重；重试后仍是同一错误不刷屏）。 */
  const loggedErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (!queryFailed || errorText === loggedErrorRef.current) return;
    loggedErrorRef.current = errorText;
    void postAppRuntimeLog("settings", "error", `设置加载失败 ${errorText}`, {
      query: failedQueries,
      /* 原始报错（含 tRPC code / 服务端 message / stack 首行）一并落盘：
       * 面板展示的是翻译后的可读文案，原文留在日志里供排查。 */
      raw: rawErrorDetail(failedError),
    });
  }, [queryFailed, errorText, failedQueries, failedError]);

  const retry = useCallback(() => {
    void settingsQ.refetch();
    void llmQ.refetch();
  }, [settingsQ, llmQ]);

  const comfy = comfyStatusQ.data;
  const dbStudio = dbStudioStatusQ.data;

  /* 两份草稿齐了才算「可渲染表单」；只有一份时仍走错误/加载态，避免
   * 半份草稿导致视图里到处判空。 */
  const drafts =
    llmDraft && settingsDraft
      ? { llm: llmDraft, settings: settingsDraft }
      : null;

  return {
    /* ComfyUI 默认端口（未配置端口时的兜底）。视图的 placeholder 与说明文案
     * 直接用它，避免把 8188 在文案里再写一遍（规范 §12.14：默认端口单点定义）。 */
    comfyDefaultPort: COMFYUI_DEFAULT_PORT,
    section,
    setSection,
    theme: theme === "light" ? "light" : "dark",
    setTheme: (value: "light" | "dark") => setTheme(value),
    isInitialLoad:
      isInitialLoad && !queryFailed && !settingsQ.data && !llmQ.data,
    hasError: queryFailed && !drafts,
    /* 既没在加载、也没失败，草稿却仍为空——正常状态机不可达。视图据此给
     * 可操作出口（重试 + 日志面板），不再渲染冻住用户的死胡同文案。 */
    notReady: !drafts && !queryFailed && !isInitialLoad,
    errorText,
    retry,
    /* 有草稿可用时，失败不再等价于「打不开」：界面照常渲染，只把原因放在一条
     * 非阻塞提示里。用户真正被冻住的场景（草稿也没有）仍走 hasError 全页降级。 */
    serveState: queryFailed && drafts ? { errorText } : null,
    drafts,
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
          probing: !!comfy.probing,
          stopping: !!comfy.stopping,
          base: comfy.base ?? null,
          port: comfy.port ?? 0,
          via: comfy.via ?? null,
        }
      : null,
    comfyInstance: comfyInstanceQ.data ?? null,
    comfyStarting,
    comfyStopping,
    comfyOpening,
    comfyBrowserOpening: openComfyInBrowserAction.busy,
    startComfy,
    stopComfy,
    openComfy,
    openComfyInBrowser,
    dbStudioStatus: dbStudio
      ? {
          up: !!dbStudio.up,
          starting: !!dbStudio.starting,
          port: dbStudio.port ?? 4983,
        }
      : null,
    dbStudioStarting,
    dbStudioStopping,
    dbStudioOpening: openDbStudioAction.busy,
    startDbStudio,
    stopDbStudio,
    openDbStudio,
    openExternalUrl,
    comfyLog: { ...comfyLog, active: comfyLogActive },
    dbStudioLog: { ...dbStudioLog, active: dbStudioLogActive },
    ollamaLog: { ...ollamaLog, active: ollamaLogActive },
    ollamaStopping,
    stopOllama: stopOllamaFn,
    saving,
    saveLlm,
    savePrefs,
    flash: flashLatch.value,
    dismissFlash: flashLatch.reset,
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

/** `drafts` 非空由容器保证（`if (!c.drafts)` 早退），用交集类型表达，
 *  消费方（含子视图）内不必逐处判空。 */
export type ReadySettingsPageController = SettingsPageController & {
  drafts: SettingsPageDrafts;
};
