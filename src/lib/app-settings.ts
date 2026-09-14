// Local single-user app settings, persisted as a JSON file (no DB migration
// needed). This is the home for preferences that don't belong in the Prisma
// models: ComfyUI base URL, the LoRA trainer backend URL, the default video
// workflow, etc. Values fall back to environment variables.
//
// The file is created on first read with seeded defaults, so a fresh install
// just works. It is intentionally git-ignored (local-only config).

import { promises as fs, readFileSync, existsSync, statSync } from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "data", "app-settings.json");

/** ComfyUI 默认端口 —— 单一事实源在 `endpoints.ts`（零依赖常量层）。
 *
 *  这里只是**再导出**：本文件顶层 `import fs`（读写 `data/app-settings.json`），
 *  浏览器图一碰就会整页 500（`does not support external modules`），而默认端口
 *  要同时被设置页视图、服务端与拉起侧读取。因此定义搬去了 `endpoints.ts`，
 *  这里保留同名出口，服务端的既有引用不受影响。
 *  `0 = 未配置` 的语义由调用方（`configuredPortOf`）承担；两处都不得再出现
 *  裸字面量 `8188`。 */
export { COMFYUI_DEFAULT_PORT } from "./endpoints";

export type VideoWorkflowPref = "auto" | "txt2video" | "img2video";

export type AppSettings = {
  trainerUrl: string;
  defaultVideoWorkflow: VideoWorkflowPref;
  comfyLorasDir: string;
  /**
   * ComfyUI 安装目录。
   * comfyuiPath 语义（配置的目录可以不是源码根本身）：
   *   - 便携版：<path>\python_embeded\python.exe + <path>\main.py
   *   - 桌面版：配置「实例根」（如 ComfyUI-Installs\ComfyUI2）——
   *     <path>\standalone-env\python.exe + <path>\ComfyUI\main.py
     *     也可直接配置实例内的 ComfyUI/ 源码根，解释器会向上查找。
   *   - venv：<path>\.venv\Scripts\python.exe + <path>\main.py
   * 配置后任务执行前若 ComfyUI 未运行会自动拉起（comfyuiAutoStart）。
   */
  comfyuiPath: string;
  /** 传给 ComfyUI main.py 的额外命令行参数（如 --input-directory ...）。 */
  comfyuiExtraArgs: string;
  /** 提交任务发现 ComfyUI 未运行时，是否自动按 comfyuiPath 启动。 */
  comfyuiAutoStart: boolean;
  /**
   * ComfyUI 监听端口。留空 = 默认 8188；非默认端口会在启动时显式传
   * `--port`，保证「界面显示端口 = 实际端口」。连接地址固定 127.0.0.1
   * （ComfyUI 由本应用拉起；远程实例可用环境变量 COMFYUI_BASE 覆盖）。
   */
  comfyuiPort: number;
  /**
   * 是否要求登录才能调用 REST 接口（自定义节点解析 / 素材 / 上传 /
   * 日志 / LLM 配置等）。false（默认，本机单用户模式）= 未登录自动落到
   * 演示用户，与 tRPC authedProcedure 的回退一致；true = 严格 401。
   */
  loginRequired: boolean;
  /**
   * 应用进程退出时是否连带关闭自己拉起的 ComfyUI（进程保活开关，默认 false）。
   * 语义：桌面壳退出是 taskkill /T /F 杀整棵进程树，被杀进程没有任何清理
   * 机会，所以这个开关不是「退出时再决定」，而是「拉起时决定是否脱离进程树」。
   * true = ComfyUI 挂在应用进程树内，应用退出连带关闭；false = 脱离进程树
   * 保活，下次打开应用直接复用。仅对本应用拉起的实例生效（外部启动的不归它管）。
   * 改动会在「下一次拉起」生效。
   *
   * 默认取「保活」：ComfyUI 冷启动 + 加载模型是分钟级的成本，默认随应用退出
   * 连杀会让每次打开应用都要重付一遍；且被杀时正在跑的任务没有机会收尾。
   */
  exitKillComfyui: boolean;
  /** 同 exitKillComfyui，作用于应用拉起的 Ollama serve 进程。 */
  exitKillOllama: boolean;
  /**
   * exitKillComfyui 默认值迁移标记（一次性，非用户可见开关）。
   * 该开关的历史默认值是 true，而 saveSettings 会把整个对象（含默认值）写盘 ——
   * 于是老安装的设置文件里都躺着一条 true，光改 DEFAULTS 对它们不生效。
   * 首次读到没有本标记的文件时把值落成新默认并写标记；之后用户手动勾选不再被覆盖。
   */
  exitKillComfyuiDefaultMigrated?: boolean;
};

/** 从 comfyuiPath 推导 ComfyUI 安装内的只读资源目录（custom_nodes / workflows）。
 *  兼容「comfyuiPath = 源码根」与「comfyuiPath = 桌面实例根（main.py 在
 *  ComfyUI/ 子目录）」两种配置：两处都查 custom_nodes / workflows 所在位置。
 * 找不到时返回 null —— 调用方自行降级（不弹错，只是没有本地工作流/节点可扫）。 */
export function deriveComfyuiSubdir(
  comfyuiPath: string,
  subdir: "custom_nodes" | "workflows"
): string | null {
  const root = (comfyuiPath ?? "").trim();
  if (!root) return null;
  // 各布局的「ComfyUI 源码根」（main.py 所在目录）。
  const candidates = [
    root, // 便携版 / venv：main.py 直接在配置根下
    path.join(root, "ComfyUI"), // 桌面版：ComfyUI\main.py
  ];
  for (const base of candidates) {
    const dir = path.join(base, subdir);
    try {
      if (existsSync(dir) && statSync(dir).isDirectory()) return dir;
    } catch {
      /* ignore — fall through */
    }
  }
  return null;
}

/** ComfyUI「用户工作流」目录的候选相对路径，按优先级排列。
 *  现代 ComfyUI（桌面版 / 1.x）把用户工作流放在 `user/default/workflows`，
 *  只有旧源码布局才是 `<root>/workflows`：只认后者时，明明配好了 ComfyUI 路径
 *  却一个本地工作流都扫不到，而扫描器把「根不存在」当「没有工作流」，界面上
 *  完全看不出原因。 */
const COMFYUI_WORKFLOW_SUBDIRS: readonly (readonly string[])[] = [
  ["user", "default", "workflows"],
  ["workflows"],
];

/** 推导本地工作流根目录：`<comfyuiPath>[/ComfyUI]/user/default/workflows` 优先，
 *  回退旧的 `<comfyuiPath>[/ComfyUI]/workflows`。找不到返回 null（调用方自行降级）。 */
export function deriveComfyuiWorkflowsDir(comfyuiPath: string): string | null {
  const root = (comfyuiPath ?? "").trim();
  if (!root) return null;
  for (const base of [root, path.join(root, "ComfyUI")]) {
    for (const sub of COMFYUI_WORKFLOW_SUBDIRS) {
      const dir = path.join(base, ...sub);
      try {
        if (existsSync(dir) && statSync(dir).isDirectory()) return dir;
      } catch {
        /* 该候选不可访问 → 试下一个 */
      }
    }
  }
  return null;
}

const DEFAULTS: AppSettings = {
  trainerUrl: process.env.LORA_TRAINER_URL ?? "",
  defaultVideoWorkflow: "auto",
  comfyLorasDir: process.env.COMFY_LORAS_DIR ?? "",
  comfyuiPath: process.env.COMFYUI_PATH ?? "",
  comfyuiExtraArgs: "",
  comfyuiAutoStart: true,
  comfyuiPort: 0,
  loginRequired: false,
  exitKillComfyui: false,
  exitKillOllama: true,
};

/** 退出策略默认值变更的一次性迁移（判据见 exitKillComfyuiDefaultMigrated）。
 *  纯函数、不做 IO —— 导出供单测直接锁住「迁移一次就收手」的行为。 */
export function migrateExitDefaults(settings: AppSettings): AppSettings {
  if (settings.exitKillComfyuiDefaultMigrated === true) return settings;
  return {
    ...settings,
    exitKillComfyui: DEFAULTS.exitKillComfyui,
    exitKillComfyuiDefaultMigrated: true,
  };
}

let cache: AppSettings | null = null;

/** Synchronous read with in-process caching. Safe to call from request handlers. */
export function getSettingsSync(): AppSettings {
  if (cache) return cache;
  try {
    const raw = readFileSync(FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AppSettings> & { comfyuiUrl?: string };
    /* comfyuiUrl 已废弃（ComfyUI 由本应用拉起，连接地址固定 127.0.0.1:端口）；
     * 从旧文件里剥掉，下次保存时彻底从磁盘消失。 */
    delete parsed.comfyuiUrl;
    cache = migrateExitDefaults({ ...DEFAULTS, ...parsed });
  } catch {
    cache = migrateExitDefaults({ ...DEFAULTS });
  }
  return cache;
}

export async function getSettings(): Promise<AppSettings> {
  return getSettingsSync();
}

/** Merge a partial update and persist. Returns the full, updated settings. */
export async function saveSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  const next: AppSettings = { ...getSettingsSync(), ...partial };
  cache = next;
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

/** 退出策略：应用进程退出时是否连带关闭自己拉起的后台服务。 */
export type ExitPolicy = {
  /** true = 应用退出连带关闭 ComfyUI；false = ComfyUI 保活（默认）。 */
  exitKillComfyui: boolean;
  /** true = 应用退出连带关闭 Ollama（默认）；false = Ollama 保活。 */
  exitKillOllama: boolean;
};

/** 取退出策略（应用拉起的后台服务在退出时的关停语义）。
 *  基于当前设置的 exitKillComfyui / exitKillOllama 投影成策略结构，
 *  调用方（ComfyUI lifecycle / Ollama 启动路由）据此在「拉起时」决定是走
 *  bound（随应用退出）还是 keepAlive（保活）。 */
export function getExitPolicy(): ExitPolicy {
  const s = getSettingsSync();
  return {
    exitKillComfyui: s.exitKillComfyui ?? false,
    exitKillOllama: s.exitKillOllama ?? true,
  };
}
