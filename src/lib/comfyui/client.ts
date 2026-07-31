// Thin REST wrapper around the local ComfyUI instance.
// IMPORTANT: all ComfyUI endpoints are under /api/.
//
// The base URL is resolved per-call from app settings (so it can be changed
// from the Settings page), falling back to COMFYUI_BASE env then localhost.

import { getSettingsSync } from "../app-settings";

export function comfyBase(): string {
  const s = getSettingsSync();
  return s.comfyuiUrl || process.env.COMFYUI_BASE || "http://localhost:8188";
}

export type PromptResult = {
  prompt_id?: string;
  number?: number;
  node_errors?: Record<string, unknown>;
  error?: string;
};

export async function postPrompt(
  prompt: unknown,
  clientId: string
): Promise<PromptResult> {
  const res = await fetch(`${comfyBase()}/api/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, client_id: clientId }),
  });
  return (await res.json()) as PromptResult;
}

export async function getHistory(promptId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${comfyBase()}/api/history/${promptId}`);
  return (await res.json()) as Record<string, unknown>;
}

export async function getView(
  filename: string,
  subfolder: string,
  type: string
): Promise<Buffer> {
  const u = new URL(`${comfyBase()}/api/view`);
  u.searchParams.set("filename", filename);
  u.searchParams.set("subfolder", subfolder ?? "");
  u.searchParams.set("type", type ?? "");
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error(`getView failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Returns the list of real filenames on disk for a model folder.
export async function listModels(folder: string): Promise<string[]> {
  try {
    const res = await fetch(`${comfyBase()}/api/models/${folder}`);
    if (!res.ok) return [];
    const data = (await res.json()) as string[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function uploadImage(
  buffer: Buffer,
  filename: string,
  type = "input"
): Promise<{ name?: string }> {
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(buffer)]), filename);
  form.append("type", type);
  const res = await fetch(`${comfyBase()}/api/upload/image`, {
    method: "POST",
    body: form,
  });
  return (await res.json()) as { name?: string };
}

export async function interrupt(): Promise<void> {
  await fetch(`${comfyBase()}/api/interrupt`, { method: "POST" });
}

export const COMFYUI_BASE = comfyBase();
