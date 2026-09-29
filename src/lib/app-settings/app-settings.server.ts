/* ── 应用设置的**服务端 IO 部分**（Node-only）──────────────────────────
 *
 * 与 `./index.ts` 的分工见该文件头：类型 / 默认值 / 纯派生函数在那边，
 * 这里只做「读 `data/app-settings.json` + 进程内缓存 + 写盘」。
 *
 * 文件名以 `.server.ts` 结尾是 §18.4 的第二类形态（同一领域的服务端拆件），
 * 它同时是「浏览器图不要引我」的机器可读标记 —— 视图层要默认端口时应当引
 * `~/lib/endpoints`（零依赖常量层），而不是走这条会拖进 `node:fs` 的路。
 */

import fs from "node:fs";
import path from "node:path";

import {
  DEFAULTS,
  migrateExitDefaults,
  type AppSettings,
  type ExitPolicy,
} from "./index";

export * from "./index";
export type { AppSettings, ExitPolicy };

/** 设置文件位置：项目根的 `data/app-settings.json`（git 忽略的本机配置）。 */
const SETTINGS_FILE = path.join(process.cwd(), "data", "app-settings.json");

/** 从 comfyuiPath 推导 ComfyUI 安装内的只读资源目录（custom_nodes / workflows）。
 *  兼容「comfyuiPath = 源码根」与「comfyuiPath = 桌面实例根（main.py 在
 *  ComfyUI/ 子目录）」两种配置：两处都查 custom_nodes / workflows 所在位置。
 *  找不到时返回 null —— 调用方自行降级（不弹错，只是没有本地工作流/节点可扫）。
 *
 *  放在本文件是因为判据是**目录存在性**（`existsSync` / `statSync`）：它看起来是
 *  「字符串推导」，实际是一次 fs 探测，留在纯模块里会让纯模块重新带上 fs。 */
export function deriveComfyuiSubdir(
  comfyuiPath: string,
  subdir: "custom_nodes" | "workflows",
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
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
    } catch {
      /* 忽略 —— 继续往下走 */
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
        if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
      } catch {
        /* 该候选不可访问 → 试下一个 */
      }
    }
  }
  return null;
}

let cache: AppSettings | null = null;

/* 缓存的失效判据是**文件指纹**，不是「进程内有没有缓存」。
 * 桌包拓扑里这两件事发生在两个进程：设置由内嵌 server 写盘，解释器路径由执行宿主
 * 取值。宿主只在第一次取值时读盘 → 用户在「设置」页填完解释器再点「重试」，宿主
 * 拿到的仍是空值，同一个 FAILED 复现（实测：宿主不重启就永远读不到新值）。
 * 判据取 `mtimeMs` + `size` 二元组，与 `comfyui/localWorkflows.ts` 的校验和备忘同口径。 */
let cacheFingerprint = "";

/** 设置文件的指纹；文件缺失 / 不可读时返回空串 —— 「缺失」本身也只需触发一次重读。 */
function settingsFileFingerprint(): string {
  try {
    const stat = fs.statSync(/*turbopackIgnore: true*/ SETTINGS_FILE);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "";
  }
}

/* 同步读取，带进程内缓存（磁盘上的设置一变就重读）。从请求处理器里调用是安全的。 */
export function getSettingsSync(): AppSettings {
  const fingerprint = settingsFileFingerprint();
  if (cache && fingerprint === cacheFingerprint) return cache;
  try {
    const raw = fs.readFileSync(
      /*turbopackIgnore: true*/ SETTINGS_FILE,
      "utf-8",
    );
    const parsed = JSON.parse(raw) as Partial<AppSettings> & {
      comfyuiUrl?: string;
    };
    /* comfyuiUrl 已废弃（ComfyUI 由本应用拉起，连接地址固定 127.0.0.1:端口）；
     * 从旧文件里剥掉，下次保存时彻底从磁盘消失。 */
    delete parsed.comfyuiUrl;
    cache = migrateExitDefaults({ ...DEFAULTS, ...parsed });
  } catch {
    cache = migrateExitDefaults({ ...DEFAULTS });
  }
  /* 指纹先取、内容后读：中间若有人写了盘，下一次调用会因为指纹对不上而重读，
   * 最坏是多重读一次；反过来（先读再取指纹）会把「新指纹 + 旧内容」钉住，永久读到旧值。 */
  cacheFingerprint = fingerprint;
  return cache;
}

export async function getSettings(): Promise<AppSettings> {
  return getSettingsSync();
}

/* 合并一次局部更新并落盘，返回合并后的完整设置。 */
export async function saveSettings(
  partial: Partial<AppSettings>,
): Promise<AppSettings> {
  const next: AppSettings = { ...getSettingsSync(), ...partial };
  cache = next;
  await fs.promises.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await fs.promises.writeFile(
    SETTINGS_FILE,
    JSON.stringify(next, null, 2),
    "utf-8",
  );
  /* 落盘后把指纹对齐到刚写的这一份：不这样做的话，下一次读会拿「自己刚写进去的
   * mtime」判成外部改动、白白重读一遍。别的进程（执行宿主）不受这里影响，
   * 它自己按文件指纹重读。 */
  cacheFingerprint = settingsFileFingerprint();
  return next;
}

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
