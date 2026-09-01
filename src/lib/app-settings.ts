// Local single-user app settings, persisted as a JSON file (no DB migration
// needed). This is the home for preferences that don't belong in the Prisma
// models: ComfyUI base URL, the LoRA trainer backend URL, the default video
// workflow, etc. Values fall back to environment variables.
//
// The file is created on first read with seeded defaults, so a fresh install
// just works. It is intentionally git-ignored (local-only config).

import { promises as fs, readFileSync } from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "data", "app-settings.json");

export type VideoWorkflowPref = "auto" | "txt2video" | "img2video";

export type AppSettings = {
  comfyuiUrl: string;
  trainerUrl: string;
  defaultVideoWorkflow: VideoWorkflowPref;
  comfyLorasDir: string;
  /**
   * ComfyUI 安装目录（包含 main.py 的安装根）。
   * 支持三种布局，启动时自动识别：
   *   - 便携版：<path>\python_embeded\python.exe + <path>\main.py
   *   - 桌面版/standalone：<path>\standalone-env\python.exe + <path>\ComfyUI\main.py
   *   - venv：<path>\.venv\Scripts\python.exe + <path>\main.py
   * 配置后任务执行前若 ComfyUI 未运行会自动拉起（comfyuiAutoStart）。
   */
  comfyuiPath: string;
  /** 传给 ComfyUI main.py 的额外命令行参数（如 --input-directory ...）。 */
  comfyuiExtraArgs: string;
  /** 提交任务发现 ComfyUI 未运行时，是否自动按 comfyuiPath 启动。 */
  comfyuiAutoStart: boolean;
};

const DEFAULTS: AppSettings = {
  comfyuiUrl: process.env.COMFYUI_BASE ?? "http://localhost:8188",
  trainerUrl: process.env.LORA_TRAINER_URL ?? "",
  defaultVideoWorkflow: "auto",
  comfyLorasDir: process.env.COMFY_LORAS_DIR ?? "",
  comfyuiPath: process.env.COMFYUI_PATH ?? "",
  comfyuiExtraArgs: "",
  comfyuiAutoStart: true,
};

let cache: AppSettings | null = null;

/** Synchronous read with in-process caching. Safe to call from request handlers. */
export function getSettingsSync(): AppSettings {
  if (cache) return cache;
  try {
    const raw = readFileSync(FILE, "utf-8");
    cache = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AppSettings>) };
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
