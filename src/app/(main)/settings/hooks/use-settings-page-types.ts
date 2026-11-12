/**
 * 设置页的共享类型与常量（`use-settings-page` 的叶子依赖）。
 * §12.7 `check-circular-deps` 连 `import type` 也算环边，类型须沉在独立叶子文件才能把方向拉直（hook 侧 re-export，消费路径不变）。
 * 本文件只有类型与常量、没有 React —— 不带 `"use client"`，服务端也能安全引它。
 */
import type { RuntimeLogController } from "~/components/studio/logs/use-runtime-log-source";
import type { BackupEntry, PendingRestore } from "./use-settings-page-backup";
import type { OllamaModel } from "~/lib/llm/ollama-client";
import type { DesktopStoragePaths } from "~/lib/comfyui/desktop-storage-paths";
import type {
  UsageTaskQueryInput,
  UsageTestInput,
  UsageTestResult,
} from "~/lib/llm/usage-test-client";
import { TASK_TYPES, type RemoteModelEntry, type TaskType } from "~/lib/llm/types";
import type { CpuLimitMode } from "~/lib/comfyui/cpu-limit";

export type Settings = {
  /** 查看绑定到本地文件的工作流时，是否自动把磁盘最新内容同步回库（默认 false=手动，更新入口是「同步」按钮）。 */
  autoSyncLocalWorkflow: boolean;
  /** comfy-cli 的 Python 解释器（桌包不随包 Python，用户自备后在这里指路径）。 */
  comfyCliPython: string;
  comfyuiAutoStart: boolean;
  /** 出图进程的 CPU 档位（ISSUE #1959）；缺值按环境默认（见 `~/lib/comfyui/cpu-limit`）。 */
  comfyuiCpuLimit?: CpuLimitMode;
  comfyuiExtraArgs: string;
  comfyuiPath: string;
  /** ComfyUI 监听端口；0 = 默认 8188（启动时按需显式传 --port）。 */
  comfyuiPort: number;
  /** 应用退出是否连带关闭自己拉起的 ComfyUI（默认 false=保活，退出后继续运行）。 */
  exitKillComfyui: boolean;
  /** 应用退出是否连带关闭自己拉起的 Ollama（默认 true=连带关闭）。 */
  exitKillOllama: boolean;
};

export type LlmConfig = {
  apiKey: string | null;
  baseUrl: string;
  /** 远端独立模型条目（可带独立 baseUrl / apiKey）—— option C 存 remoteModel 表。 */
  extraModels: Array<RemoteModelEntry>;
  /** 本地 Ollama 启用的候选模型名（纯名字，无 apiKey）—— option C 与远端分开。 */
  localCandidates: Array<string>;
  maxTokens: number;
  model: string;
  provider: "local" | "remote";
  temperature: number;
  temperatureByTask?: Record<TaskType, number>;
};

/**
 * 服务端下发的 LLM 配置形状（`llm.configGet` 的出口）。与草稿 {@link LlmConfig} 的差别在 `extraModels`：
 * 下发是「本地候选字符串 + 远端条目对象」混合清单（保存时按类型各自写回），草稿在播种时就拆成两栏；
 * 「读取兜底缓存」按本类型存。
 */
export type QueryLlmConfig = Omit<
  LlmConfig,
  "extraModels" | "localCandidates" | "temperatureByTask" | "apiKey"
> & {
  /** 服务端出口的 apiKey 可选（未配置时为 undefined 而非 null）。 */
  apiKey?: string | null;
  /** 混合清单：字符串 = 本地候选，对象 = 远端独立模型。 */
  extraModels: Array<string | RemoteModelEntry>;
  /** 下发形状不含该栏（它是草稿侧拆出来的），容错为可选。 */
  localCandidates?: Array<string>;
  /** 服务端可能下发 null（表示「未配置覆盖」），草稿层归一为 undefined。 */
  temperatureByTask?: Record<TaskType, number> | null;
};

export type Section =
  | "appearance"
  | "appUpdate"
  | "llmLocal"
  | "llmRemote"
  | "comfyui"
  | "database"
  | "backup"
  | "dataLocation"
  | "exit"
  | "logs";
export type OllamaStatus = "checking" | "starting" | "up" | "down";

export type FlashMessage = {
  kind: "ok" | "err";
  text: string;
};

/** 两份草稿都已就绪 —— 视图只在 `drafts` 非空时渲染，避免逐处判空。 */
export type SettingsPageDrafts = {
  llm: LlmConfig;
  settings: Settings;
};

export type SettingsPageController = {
  /** 跳转目标真正落定 —— 外壳命中锚点后调它（清空 `pendingJump` + 消费载荷）。 */
  ackJumpSection: () => void;
  /* 应用自更新（Tauri updater + process）：检测 / 下载安装 / 重启 */
  appUpdate: {
    /** 最近一次检测是否发现可用更新。 */
    available: boolean;
    /** 一次操作的进行态；idle 表示空闲。 */
    busy: "idle" | "checking" | "installing";
    /** 当前本地版本号（可用时从检测结果读取）。 */
    currentVersion: string | null;
    /** 是否在桌面壳内（决定「检测更新」是否可用）。 */
    inShell: boolean;
    /** 最近一次检测/安装的可读结果或提示。 */
    message: string | null;
    /** 下载进度（bytes，total 可能为空），installing 时非空。 */
    progress: { downloaded: number; total?: number } | null;
    /** 可用的远端版本号（available 时非空）。 */
    version: string | null;
  };
  backupBusy: boolean;
  backupListLoading: boolean;
  /* 数据库备份 / 恢复（D6）：清单 + 手动备份 + 登记恢复。
   * 「恢复」是两步 —— `restoreFrom` 只写待恢复标记，换文件在下次启动，
   * 所以有 `pendingRestore` 这一格要被视图讲出来（见 `use-settings-page-backup`）。 */
  backups: Array<BackupEntry>;
  checkAppUpdate: () => Promise<void>;
  /** ComfyUI 默认端口（未配置端口时的兜底）：视图的 placeholder / 说明文案用它取值，
   *  避免把默认端口在文案里再写一遍（规范 §12.14：默认端口单点定义）。 */
  comfyDefaultPort: number;
  /* ComfyUI（**只剩配置侧**：运行态与启动日志在侧栏「ComfyUI」页，
     见 `~/components/studio/comfyui/hooks/use-comfyui-control`） */
  /** 安装形态：**只读文件系统的快速判据**。
   *
   * 为什么不合进 comfyStatus：comfyStatus 要付「进程表查询 + 端口探测」（秒级），
   * 而形态只需毫秒级 fs 判定；合在一起时徽标与「端口/启动参数是否隐藏」会被拖到
   * 探测结束才出现（改路径保存后也一样）。这条与首屏的 `setting.get` 同批返回。 */
  comfyInstance: {
    /** 桌面实例且能读到实例 ID → 端口/参数由 Comfy Desktop 元数据决定，
     *  设置页据此隐藏 端口/启动参数 输入。 */
    desktopManaged: boolean;
    /** 桌面版 / 便携版 / venv；未配置路径或判不出形态时为 null。 */
    instanceType: "desktop" | "portable" | "venv" | null;
    /** 配置里是否填了路径（与形态同源，都是设置行的事实）。 */
    pathConfigured: boolean;
  } | null;
  /** 桌面实例的六个存储目录（模型 / 共享模型 / 输入 / 共享输入 / 输出 /
   *  共享输出）——**只读**；非桌面实例为 null（便携版 / venv 的目录只由启动参数
   *  决定）。与 `comfyInstance` 同为配置路径的函数，保存偏好后重取、不进轮询。 */
  comfyStorage: DesktopStoragePaths | null;
  /** 提交一次 LLM 草稿局部补丁并立即落库（离散控件：模型选择 / 按任务温度等）。
   *  成功静默、失败报错；返回本次结果供调用方回滚/刷新。 */
  commitLlm: (patch: Partial<LlmConfig>) => Promise<{ error?: string; ok: boolean }>;
  /** 提交一次偏好局部补丁并立即落库（离散控件：开关 / 单选 / CPU 档位等）。
   *  成功静默、失败报错；返回本次结果供调用方回滚/刷新。 */
  commitPrefs: (patch: Partial<Settings>) => Promise<{ error?: string; ok: boolean }>;
  createBackupNow: () => Promise<void>;
  /* 启动日志（log/services/*-runtime.log）：共用同一套「按会话切分 + 跟随 +
     刷新」的状态，见 `~/components/studio/logs/use-runtime-log-source`
     （视图只渲染）。ComfyUI 那一份随运行态一起搬去了侧栏「ComfyUI」页。 */
  dbStudioLog: RuntimeLogController;
  dbStudioOpening: boolean;
  dbStudioStarting: boolean;
  /* Drizzle Studio（本地数据库可视化）：状态 + 启动/关闭/打开查看 */
  dbStudioStatus: {
    port: number;
    starting: boolean;
    up: boolean;
  } | null;
  dbStudioStopping: boolean;
  dismissFlash: () => void;
  /** 两份草稿；为 null 表示查询还没回来 —— 容器据此走降级 UI，
   *  收窄后传给视图的 controller 里它就是非空的。 */
  drafts: SettingsPageDrafts | null;
  /** 失败时给用户看的人话文案（原文见日志的 `raw` 字段）。 */
  errorText: string;
  /* 提示条 */
  flash: FlashMessage | null;
  /** 加载失败**且**两份草稿都没就绪 —— 容器据此渲染错误降级视图。 */
  hasError: boolean;
  installAppUpdate: () => Promise<void>;
  /* 加载 / 错误 */
  isInitialLoad: boolean;
  /* LLM：API Key 是「留空不改」语义，故独立于草稿 */
  llmApiKey: string;
  /** 加载未失败、也没在加载，但草稿仍未就绪（理论上不可达，视图兜底用）。 */
  notReady: boolean;
  ollamaLog: RuntimeLogController;
  ollamaModels: Array<OllamaModel>;
  ollamaStarting: boolean;
  /* Ollama */
  ollamaStatus: OllamaStatus;
  /* Ollama 关闭（启动已有 startOllama） */
  ollamaStopping: boolean;
  openDbStudio: () => Promise<void>;
  /** 用系统默认浏览器打开生成的远程资源（视频等），桌面壳内替代 target=_blank */
  openExternalUrl: (url: string) => Promise<void>;
  /* 草稿更新：局部 patch，避免视图里到处 `{ ...draft, x }` 与判空 */
  patchLlm: (patch: Partial<LlmConfig>) => void;
  patchSettings: (patch: Partial<Settings>) => void;
  /**
   * 跳转载荷要求直接停驻、但**尚未落定**的分区；已落定（外壳真的滚过去并回调）
   * 后为 null。外壳据此在分区节铺好之后瞬时滚过去。
   */
  pendingJump: Section | null;
  pendingRestore: PendingRestore | null;
  /** 对已提交但仍在生成的异步视频任务「继续等待」一轮：只查既有任务，不重复提交扣费 */
  queryUsageTask: (input: UsageTaskQueryInput) => Promise<UsageTestResult>;
  relaunchApp: () => Promise<void>;
  restoreBusy: boolean;
  restoreFrom: (name: string) => Promise<void>;
  retry: () => void;
  saveLlm: () => Promise<void>;
  /**
   * 偏好落库（即时自动保存的失焦/提交出口，成功静默、仅报错提示）。
   * 可选 `override`：commitPrefs 即时提交时传入算好的下一份草稿，避免读到 stale 闭包。
   */
  savePrefs: (override?: Settings | null) => Promise<{ error?: string; ok: boolean }>;
  /* 保存 */
  saving: boolean;
  /** 侧边栏当前分区（纯视觉偏好，但影响渲染哪个表单，故由逻辑层持有）。 */
  section: Section;
  /**
   * 「读不到 / 刚保存的配置」类失败的**可续用**状态（ISSUE #360）：草稿已由缓存
   * 兜底播种，视图据此渲染**非阻塞**提示条而非整页错误。与 `hasError` 互斥：
   * `hasError` = 连兜底草稿都没有，`serveState` = 有兜底的降级可用。
   */
  serveState: { errorText: string } | null;
  setLlmApiKey: (value: string) => void;
  setSection: (section: Section) => void;
  /** 输入框清空 → 删掉该任务的覆盖值（恢复该任务的推荐默认温度）；有值 → 写入覆盖。 */
  setTaskTemperature: (task: TaskType, raw: string) => void;
  setTheme: (theme: "light" | "dark") => void;
  startDbStudio: () => Promise<void>;
  startOllama: () => Promise<void>;
  stopDbStudio: () => Promise<void>;
  stopOllama: () => Promise<void>;
  /** 按用途发起一次真实调用（图片 / 视频会真实生成、消耗额度） */
  testModelUsage: (input: UsageTestInput) => Promise<UsageTestResult>;
  /* 外观主题：Light / Dark（持久化偏好，统一走 next-themes）。 */
  theme: "light" | "dark";
  /** 勾选/取消一个候选模型（本地 Ollama 多模型管理）；即时落库，返回保存结果 */
  toggleExtraModel: (name: string) => Promise<{ error?: string; ok: boolean }>;
};

export const SETTINGS_SECTIONS: Array<{ id: Section; label: string }> = [
  { id: "appearance", label: "外观" },
  { id: "appUpdate", label: "应用更新" },
  { id: "llmLocal", label: "本地模型" },
  { id: "llmRemote", label: "远程模型" },
  { id: "comfyui", label: "创作后端" },
  { id: "database", label: "数据库" },
  { id: "backup", label: "备份与恢复" },
  { id: "dataLocation", label: "数据存放位置" },
  { id: "exit", label: "退出与后台服务" },
  { id: "logs", label: "日志" },
];

/** 按任务温度区的任务清单 —— 视图遍历渲染，顺序即渲染顺序。 */
function isTaskType(value: string): value is TaskType {
  return Object.hasOwn(TASK_TYPES, value);
}

export const TEMPERATURE_TASKS: Array<[TaskType, (typeof TASK_TYPES)[TaskType]]> = Object.entries(
  TASK_TYPES,
).filter((entry): entry is [TaskType, (typeof TASK_TYPES)[TaskType]] => isTaskType(entry[0]));

/** `drafts` 非空由容器保证（`if (!c.drafts)` 早退），用交集类型表达，
 *  消费方（含子视图）内不必逐处判空。 */
export type ReadySettingsPageController = SettingsPageController & {
  drafts: SettingsPageDrafts;
};
