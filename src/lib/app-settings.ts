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

/** ComfyUI 默认端口（main.py 未传 --port 时的监听端口）。 */
export const COMFYUI_DEFAULT_PORT = 8188;

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

const DEFAULTS: AppSettings = {
  trainerUrl: process.env.LORA_TRAINER_URL ?? "",
  defaultVideoWorkflow: "auto",
  comfyLorasDir: process.env.COMFY_LORAS_DIR ?? "",
  comfyuiPath: process.env.COMFYUI_PATH ?? "",
  comfyuiExtraArgs: "",
  comfyuiAutoStart: true,
  comfyuiPort: 0,
};

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
    cache = { ...DEFAULTS, ...parsed };
  } catch {
    cache = { ...DEFAULTS };
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
