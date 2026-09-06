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
//
// 多实例场景：comfyuiPath 配置了实例根目录后，resolveComfyBase 会先在 OS
// 进程列表确认「该路径的 main.py 是否真的在运行」，再通过 PID→监听端口
// 定位实际端口。端口上有别的 ComfyUI 响应 ≠ 配置路径的实例在运行。

import { getSettingsSync } from "../app-settings";
import { resolveComfyLaunchPlan } from "./launch-path";
import {
  findPidForMainPyDetailed,
  findPidListeningPort,
} from "./proc-detect";
import { logger } from "~/server/lib/logger";

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

    const url = new URL(raw);

    if (url.hostname === "localhost") url.hostname = "127.0.0.1";

    return url.toString().replace(/\/$/, "");

  } catch {

    return raw;
  }
}

/** Probe a single port — returns true if ComfyUI responds
 *
 * 超时按环回地址给 300ms：真实监听中的 ComfyUI 应答 /system_stats 是毫秒级，
 * 800ms 只会拉长「未运行」场景的空扫（配置端口 +1..+5 共 6 次探测，
 * ComfyUI 未运行时 resolveComfyBase 每次都要付完全部超时）。 */
async function probePort(host: string, port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://${host}:${port}/system_stats`, {
      signal: AbortSignal.timeout(300),
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

  const settings = getSettingsSync();
  // 连接地址固定本机（ComfyUI 由本应用按 comfyuiPath 拉起）；远程实例用
  // 环境变量 COMFYUI_BASE 覆盖。端口以 comfyuiPort 为准（默认 8188）。
  let url: URL;
  try {
    url = new URL(
      process.env.COMFYUI_BASE ??
        `http://127.0.0.1:${settings.comfyuiPort && settings.comfyuiPort > 0 ? settings.comfyuiPort : 8188}`,
    );
  } catch { url = new URL("http://127.0.0.1:8188"); }
  const host = url.hostname === "localhost" ? "127.0.0.1" : url.hostname;
  const configuredPort =
    settings.comfyuiPort && settings.comfyuiPort > 0
      ? settings.comfyuiPort
      : parseInt(url.port) || 8188;

  // comfyuiPath 已配置：先确认配置的实例在 OS 层确实在运行。
  // 避免「端口上有任何 ComfyUI 响应 = 已在运行」的误判——可能跑着的是
  // 另一个实例，并非用户配置路径的那个。
  const comfyuiPath = settings.comfyuiPath?.trim();
  if (comfyuiPath) {
    const plan = resolveComfyLaunchPlan(comfyuiPath);
    if (!("error" in plan)) {
      const lookup = await findPidForMainPyDetailed(plan.mainPy);
      if (lookup.pid) {
        const port = await findPidListeningPort(lookup.pid);
        if (port) {
          _resolvedBase = `http://${host}:${port}`;
          logger.info(`[comfyui] Connected to configured instance on :${port} (pid=${lookup.pid})`);
          return _resolvedBase;
        }
        // 进程在但端口未绑定（仍在启动）——不误连到别的 ComfyUI，返回配置地址。
        logger.info(`[comfyui] Configured instance (pid=${lookup.pid}) starting, port not bound yet`);
        return `http://${host}:${configuredPort}`;
      }
      // 进程查询失败（超时/高负载）≠ 实例未运行：结果不可信，此时不能抛错，
      // 否则正在运行的实例会被状态探测误报为「未运行」（ISSUE #114：启动
      // 成功后状态行回退「未运行」，但点「打开查看」又能打开）。
      // 退回端口探测：先试配置端口，再试 +1..+N（下方公共路径）。若配置
      // 端口上有 ComfyUI 响应，几乎总是本实例（另一实例占端口的场景在
      // 查询成功分支已覆盖）。
      if (lookup.failed) {
        logger.warn(
          `[comfyui] Process lookup failed (timeout/busy?) for ${plan.mainPy}, falling back to port probe`,
        );
      } else {
        // 配置的实例确认没有在运行——抛错触发自动启动（executor-ws connect 的 catch）
        logger.warn(`[comfyui] Configured instance not running: ${plan.mainPy}`);
        throw new Error("Configured ComfyUI instance is not running");
      }
    }
    // comfyuiPath 无效（如目录不存在）——退到端口探测
    logger.warn(`[comfyui] Invalid comfyuiPath, falling back to port probe`);
  }

  // Try configured port first
  if (await probePort(host, configuredPort)) {
    _resolvedBase = `http://${host}:${configuredPort}`;
    logger.info(`[comfyui] Connected on configured port :${configuredPort}`);
    return _resolvedBase;
  }

  // Probe nearby ports (ComfyUI often auto-increments when port is occupied)
  for (let offset = 1; offset <= PROBE_RANGE; offset++) {

    const port = configuredPort + offset;

    if (await probePort(host, port)) {

      _resolvedBase = `http://${host}:${port}`;

      logger.warn(

        `[comfyui] Configured port :${configuredPort} unreachable, auto-discovered ComfyUI on :${port}`

      );

      return _resolvedBase;

    }

  }


  // All probes failed — fall back to configured value (callers will get 503)
  logger.error(
    `[comfyui] Cannot reach ComfyUI on :${configuredPort} or any of [${Array.from({length: PROBE_RANGE}, (_, i) => configuredPort + i + 1).join(", ")}]`
  );
  return `http://${host}:${configuredPort}`;
}

/**
 * Synchronous version — returns cached value or raw config (no probing).
 * Use this for non-critical reads where latency matters more than accuracy.
 * For mutations (upload/prompt), prefer resolveComfyBase().
 */
export function comfyBase(): string {
  if (_resolvedBase) return forceIpv4Host(_resolvedBase);
  const settings = getSettingsSync();
  const port =
    settings.comfyuiPort && settings.comfyuiPort > 0 ? settings.comfyuiPort : 8188;
  const raw = process.env.COMFYUI_BASE ?? `http://127.0.0.1:${port}`;
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

  const url = new URL(`${comfyBase()}/api/view`);

  url.searchParams.set("filename", filename);

  url.searchParams.set("subfolder", subfolder ?? "");

  url.searchParams.set("type", type ?? "");

  const res = await fetch(url.toString());

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
    return Array.isArray(data) ? data.filter((datum) => typeof datum === "string" && datum.length > 0) : [];
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

/* ── /system_stats ──────────────────────────────────────────────────────
 * ComfyUI 系统状态：返回 GPU（devices）与系统内存（system）容量与占用，
 * 底部状态栏据此显示显存/内存占用；进程离线时返回 null（调用方降级展示）。 */
/** 折叠成状态栏关心的聚合视图，保留原始字段便于扩展 */
export interface ComfySystemStats {
  online: boolean;
  /** GPU 型号（取第一块）；无 GPU 时为 undefined */
  gpuName?: string;
  /** 显存占用（字节） */
  vramUsed: number;
  /** 显存总量（字节） */
  vramTotal: number;
  /** 系统内存占用（字节） */
  ramUsed: number;
  /** 系统内存总量（字节） */
  ramTotal: number;
}

/** 拉取 ComfyUI `/system_stats` 并折叠成状态栏需要的聚合字段。
 *  服务不可达 / 解析失败时返回 null，由调用方决定降级展示。 */
export async function getSystemStats(): Promise<ComfySystemStats | null> {
  try {
    const res = await fetch(`${comfyBase()}/system_stats`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      system?: { ram_total?: number; ram_free?: number };
      devices?: Array<{
        name?: string;
        type?: string;
        vram_total?: number;
        vram_used?: number;
      }>;
    };
    const dev = Array.isArray(data.devices) ? data.devices[0] : undefined;
    const ramTotal = data.system?.ram_total ?? 0;
    const ramFree = data.system?.ram_free ?? 0;
    return {
      online: true,
      gpuName: dev?.name ?? (dev?.type === "cpu" ? "CPU" : undefined),
      vramUsed: dev?.vram_used ?? 0,
      vramTotal: dev?.vram_total ?? 0,
      ramUsed: ramTotal > 0 ? Math.max(0, ramTotal - ramFree) : 0,
      ramTotal,
    };
  } catch {
    return null;
  }
}
