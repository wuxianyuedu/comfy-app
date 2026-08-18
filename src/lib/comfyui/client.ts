// Thin REST wrapper around the local ComfyUI instance.
// IMPORTANT: all ComfyUI endpoints are under /api/.
//
// The base URL is resolved per-call from app settings (so it can be changed
// from the Settings page), falling back to COMFYUI_BASE env then localhost.
//
// Port auto-detection: if the configured port is unreachable (ECONNREFUSED),
// the resolver will probe nearby ports (+1, +2, … up to PROBE_RANGE) and use
// the first one that responds. The discovered port is cached in-memory for the
// session lifetime.

import { getSettingsSync } from "../app-settings";

/** How many extra ports to probe when the configured one is unreachable */
const PROBE_RANGE = 5;

/** Cached resolved base URL (set once after successful probe) */
let _resolvedBase: string | null = null;

/**
 * Node's undici `fetch` resolves the hostname `localhost` to IPv6 `::1` first.
 * ComfyUI's default IPv4 listener (0.0.0.0) never answers on `::1`, so every
 * server-side call to `http://localhost:8188` fails with ECONNREFUSED — but a
 * plain `curl localhost:8188` works fine, which makes the failure confusing.
 * Force the loopback to 127.0.0.1 to keep traffic on IPv4. Apps that genuinely
 * run ComfyUI on a LAN IP or a custom hostname are left untouched.
 */
function forceIpv4Host(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.hostname === "localhost") u.hostname = "127.0.0.1";
    return u.toString().replace(/\/$/, "");
  } catch {
    return raw;
  }
}

/** Probe a single port — returns true if ComfyUI responds */
async function probePort(host: string, port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://${host}:${port}/system_stats`, {
      signal: AbortSignal.timeout(800),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Resolve the actual ComfyUI base URL with auto-port-detection.
 * Tries: configured → +1 … +PROBE_RANGE. Caches result for session lifetime.
 */
export async function resolveComfyBase(): Promise<string> {
  if (_resolvedBase) return _resolvedBase;

  const raw = getSettingsSync().comfyuiUrl || process.env.COMFYUI_BASE || "http://localhost:8188";
  let url: URL;
  try { url = new URL(raw); } catch { url = new URL("http://localhost:8188"); }
  const host = url.hostname === "localhost" ? "127.0.0.1" : url.hostname;
  const configuredPort = parseInt(url.port) || 8188;

  // Try configured port first
  if (await probePort(host, configuredPort)) {
    _resolvedBase = `http://${host}:${configuredPort}`;
    console.log(`[comfyui] Connected on configured port :${configuredPort}`);
    return _resolvedBase;
  }

  // Probe nearby ports (ComfyUI often auto-increments when port is occupied)
  for (let offset = 1; offset <= PROBE_RANGE; offset++) {
    const p = configuredPort + offset;
    if (await probePort(host, p)) {
      _resolvedBase = `http://${host}:${p}`;
      console.warn(
        `[comfyui] Configured port :${configuredPort} unreachable, auto-discovered ComfyUI on :${p}`
      );
      return _resolvedBase;
    }
  }

  // All probes failed — fall back to configured value (callers will get 503)
  console.error(
    `[comfyui] Cannot reach ComfyUI on :${configuredPort} or any of [${Array.from({length: PROBE_RANGE}, (_, i) => configuredPort + i + 1).join(", ")}]`
  );
  return raw;
}

/**
 * Synchronous version — returns cached value or raw config (no probing).
 * Use this for non-critical reads where latency matters more than accuracy.
 * For mutations (upload/prompt), prefer resolveComfyBase().
 */
export function comfyBase(): string {
  const raw = _resolvedBase ?? getSettingsSync().comfyuiUrl ?? process.env.COMFYUI_BASE ?? "http://localhost:8188";
  return forceIpv4Host(raw);
}

/**
 * Drop the cached probe result so the next resolveComfyBase() re-probes.
 *
 * Needed because ComfyUI may restart on a *different* port (it auto-increments
 * when the configured one is busy). Without this the cache pins us to a dead
 * port for the whole process lifetime. The runner calls this whenever the
 * WebSocket drops, so a reconnect always re-discovers the live port.
 */
export function resetComfyBase(): void {
  _resolvedBase = null;
}

/** `http(s)://host:port` → `ws(s)://host:port` (ComfyUI serves /api/ws there). */
export function toWsBase(httpBase: string): string {
  return httpBase.replace(/^http(s?):\/\//i, (_m, s) => `ws${s}://`);
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
  const base = await resolveComfyBase();
  const res = await fetch(`${base}/api/prompt`, {
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
    const res = await fetch(`${comfyBase()}/api/models/${encodeURIComponent(folder)}`);
    if (!res.ok) return [];
    const data = (await res.json()) as string[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * The model directories ComfyUI actually knows about (`GET /api/models`).
 *
 * This is the authoritative answer to "by what rules are models found": a live
 * install exposes ~86 folders (checkpoints, loras, ultralytics_bbox, sams,
 * gguf, …).  The model-library config UI lists these so the user picks from
 * real directories instead of guessing a folder name.
 *
 * Returns `[]` when ComfyUI is unreachable — callers then show an empty
 * directory list (the user configures from real directories only).
 */
export async function listModelFolders(): Promise<string[]> {
  try {
    const res = await fetch(`${comfyBase()}/api/models`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as string[];
    return Array.isArray(data) ? data.filter((f) => typeof f === "string" && f.length > 0) : [];
  } catch {
    return [];
  }
}

export async function uploadImage(
  buffer: Buffer,
  filename: string,
  type = "input"
): Promise<{ name?: string }> {
  const base = await resolveComfyBase();
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(buffer)]), filename);
  form.append("type", type);
  const res = await fetch(`${base}/api/upload/image`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(`ComfyUI 上传失败 (${res.status}): ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as { name?: string };
}

export async function interrupt(): Promise<void> {
  const base = await resolveComfyBase();
  await fetch(`${base}/api/interrupt`, { method: "POST" });
}
