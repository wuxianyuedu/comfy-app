"use client";

/**
 * 设置页的**共享类型与常量**（`use-settings-page` 的拆分件）。
 *
 * 从 `use-settings-page.ts` 抽出:视图与容器共用的 `Settings` / `LlmConfig` /
 * `QueryLlmConfig` / `Section` / `OllamaStatus` / `FlashMessage` /
 * `SettingsPageDrafts` / `SettingsPageController` / `ReadySettingsPageController`
 * 类型,与侧边栏分区表 `SETTINGS_SECTIONS`、按任务温度区的 `TEMPERATURE_TASKS`
 * 两个纯配置常量。它们与 `useSettingsPage` hook 的实现体无关,只是被两侧共同
 * 引用;§12.7 `check-circular-deps` 不看 `import type`、只要 AST 上有 import
 * 边就算环,所以类型必须沉到独立叶子文件才能真正把方向拉直:
 *   `use-settings-page-types.ts` ← `use-settings-page.ts`（并 re-export,
 *   消费者 `from "./hooks/use-settings-page"` 的路径不变,§12.18 复用优先）。
 *
 * 拆分动机:`use-settings-page.ts` 1331 行超过 §12.6 文件长度棘轮的阈值。
 * 本次先把类型与常量层拆出去（~260 行）;hook 本体仍 900+ 行、下一轮再按
 * Comfy / Ollama / DbStudio / Update / RemoteModel 五组动作拆 sub-hook。
 */
import type { RuntimeLogController } from "./use-runtime-log-source";
import type { OllamaModel } from "~/lib/llm/ollama-client";
import type { RemoteProbeResult } from "~/lib/llm/browser";
import type {
  UsageTaskQueryInput,
  UsageTestInput,
  UsageTestResult,
} from "~/lib/llm/usage-test-client";
import {
  TASK_TYPES,
  type RemoteModelEntry,
  type RemoteModelKind,
  type TaskType,
} from "~/lib/llm/types";

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
  /** 查看绑定到本地文件的工作流时，是否自动把磁盘最新内容同步回库（默认 false=手动，更新入口是「同步」按钮）。 */
  autoSyncLocalWorkflow: boolean;
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
