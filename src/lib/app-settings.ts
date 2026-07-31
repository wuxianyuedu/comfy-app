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

export type VideoWorkflowPref = "auto" | "txt2video" | "ltxt2video";

export type AppSettings = {
  comfyuiUrl: string;
  trainerUrl: string;
  defaultVideoWorkflow: VideoWorkflowPref;
  comfyLorasDir: string;
};

const DEFAULTS: AppSettings = {
  comfyuiUrl: process.env.COMFYUI_BASE || "http://localhost:8188",
  trainerUrl: process.env.LORA_TRAINER_URL || "",
  defaultVideoWorkflow: "auto",
  comfyLorasDir: process.env.COMFY_LORAS_DIR || "",
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
