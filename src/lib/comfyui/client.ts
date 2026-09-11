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
import { queryNvidiaVram } from "./gpu-vram";
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
        // 进程在但端口未绑定（仍在加载）——先按配置地址返回给调用方试一次；
        // 探头不要把这次「还在启动」的结论缓存住，否则 ComfyUI 稍后绑定端口 /
        // 落在偏移端口上时，本进程会一直沿用这个连不上的地址（见
        // probeComfyUi 的按次探测口径）。
        logger.info(`[comfyui] Configured instance (pid=${lookup.pid}) starting, port not bound yet`);
        return `http://${host}:${configuredPort}`;
      }
      // 进程查询失败（超时/高负载）≠ 实例未运行：结果不可信，此时不能抛错，
      // 否则正在运行的实例会被状态探测误报为「未运行」（ISSUE #114：启动
      // 成功后状态行回退「未运行」，但点「打开查看」又能打开）。
      // 退回端口探测：先试配置端口，再试 +1..+N（下方公共路径）。若配置
      // 端口上有 ComfyUI 响应，几乎总是本实例（另一实例占端口的场景在
      // 查询成功分支已覆盖）。
      // 「进程表里查不到配置路径的 main.py」不再抛错，退回端口探测。
      //
      // 抛错的本意是「避免误连到别的实例，并触发自动启动」，但判据本身不成立：
      // Comfy Desktop 的实例由 standalone-env 启动，命令行里没有 `main.py`
      // （见 status.ts 的同类教训），进程在跑也查不到 —— 于是 `resolveComfyBase`
      // 直接抛错，`probeComfyUi()` 连一次 HTTP 都没发出去就被 catch 成「不可达」。
      // 表现就是设置页永远停在「ComfyUI 正在启动…」：端口上明明有实例正常应答
      // （ISSUE #344）。「实例在不在」由 status.ts 的进程级快照负责，
      // `resolveComfyBase` 只负责「连得上哪个地址」，不该越权下「没在跑」的结论。
      logger.warn(
        lookup.failed
          ? `[comfyui] Process lookup failed (timeout/busy?) for ${plan.mainPy}, falling back to port probe`
          : `[comfyui] Configured instance (${plan.mainPy}) not found in process table, falling back to port probe`,
      );
    } else {
      // comfyuiPath 无效（如目录不存在）——退到端口探测
      logger.warn(`[comfyui] Invalid comfyuiPath, falling back to port probe`);
    }
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

/** 端口探测的结果地址，但不写进会话缓存。
 *
 * 与 `resolveComfyBase` 的分工：那个是「本次会话连哪个地址」的**粘性**结论
 * （命中后不再复查，供提交/上传等 mutation 复用）；本函数是**按次**探测，
 * 只回答「此刻哪个地址应答」，不改变会话结论。
 *
 * 状态判定必须走这条：`getComfyUiStatus` 每次轮询都要拿当下的事实，
 * 若沿用粘性缓存，一次「进程在但端口未绑定」的探测会把配置地址钉在缓存里，
 * ComfyUI 随后就绪（或落在偏移端口）时仍被当成不可达 —— 设置页的「正在启动…」
 * 就再也不会翻成「运行中」（ISSUE #344）。*/
export async function probeComfyBase(): Promise<string | null> {
  const cached = _resolvedBase;
  try {
    const base = await resolveComfyBase();
    return await probeBaseOnce(base);
  } finally {
    /* 还原会话缓存：按次探测不得污染「本次会话连哪个地址」的粘性结论。
     * 探测本身已经写入了 `_resolvedBase`（resolveComfyBase 的既有行为），
     * 这里回滚成探测前的值。 */
    _resolvedBase = cached;
  }
}

/** 对指定地址各发一次 `/system_stats`，通了返回该地址。 */
async function probeBaseOnce(base: string): Promise<string | null> {
  try {
    const r = await fetch(`${base}/system_stats`, {
      signal: AbortSignal.timeout(1500),
    });
    return r.ok ? base : null;
  } catch {
    return null;
  }
}

/** 直接探一个已知端口，**不做**任何进程表查询 / 端口扫描。
 *
 * 给「进程级快照已经定位到实例与端口」的调用方用（设置页状态判定）：
 * 那种情况下 `probeComfyBase()` 是绕远路——它会先 `resolveComfyBase()`，
 * 而后者在配置了路径时又要查一遍进程表（PowerShell 枚举 `Win32_Process`，
 * 本机 ~2.5s），再决定探哪个地址，等于把已经拿到的事实重新推一遍。
 * 直接探快照给出的端口既省掉这段重复 IO，也比「按配置端口 + 偏移扫描」
 * 更准：快照里的端口就是该 PID 实际监听的端口（ISSUE #339 残留延迟）。 */
export async function probeComfyAtPort(port: number): Promise<string | null> {
  if (!Number.isInteger(port) || port <= 0) return null;
  /* `COMFYUI_BASE` 指向的是远端实例（不是本机进程），此时「快照给出的本机监听
   * 端口」与要连的地址根本不是一回事——把远端主机的端口换成本机端口会直接
   * 探错地方。这种情况下返回 null，交给调用方走通用探测（它会尊重
   * COMFYUI_BASE）。 */
  if (process.env.COMFYUI_BASE) return null;
  return probeBaseOnce(`http://127.0.0.1:${port}`);
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
  /** GPU 型号（取第一块可用 GPU）；无 GPU 时为 undefined */
  gpuName?: string;
  /** 显存占用（字节）：vram_total - vram_free 推导 */
  vramUsed: number;
  /** 显存总量（字节） */
  vramTotal: number;
  /** 显存剩余可用（字节）：ComfyUI 上报的 vram_free 原值 */
  vramFree: number;
  /** nvidia-smi 物理专用显存占用（字节）；不适用/查询失败为 undefined */
  smiVramUsed?: number;
  /** nvidia-smi 物理专用显存总量（字节）；不适用/查询失败为 undefined */
  smiVramTotal?: number;
  /** 系统内存占用（字节） */
  ramUsed: number;
  /** 系统内存总量（字节） */
  ramTotal: number;
}

/** 从 `/system_stats.devices` 中挑出真正在用的 GPU。
 *  ComfyUI 的 devices 首项未必是 GPU——CPU/纯 CPU 后端会把 type="cpu" 设备排前，
 *  其 vram_* 恒为 0，直接取 devices[0] 会让显存占用恒读成 0%。这里先过滤出
 *  显存容量 >0 的 GPU，取不到才回退到首项（调用方据此判定纯 CPU 并隐藏占用条）。 */
interface ComfyDevice {
  name?: string;
  type?: string;
  vram_total?: number;
  vram_used?: number;
  vram_free?: number;
}

function pickGpu(devices: ComfyDevice[] | undefined): ComfyDevice | undefined {
  if (!Array.isArray(devices) || devices.length === 0) return undefined;
  return (
    devices.find((d) => d.type !== "cpu" && (d.vram_total ?? 0) > 0) ??
    devices[0]
  );
}

/** 拉取 ComfyUI `/system_stats` 并折叠成状态栏需要的聚合字段。
 *  服务不可达 / 解析失败时返回 null，由调用方决定降级展示。
 *  显存双口径：vram_free 是「还有多少可用」，已用 = vram_total - vram_free
 *  （ComfyUI CUDA 逻辑口径，与内存侧 ram_total - ram_free 推导一致）。nvidia-smi
 *  额外上报物理专用显存（smiVram*，取本机首块 GPU），供与任务管理器对照。
 *  上游个别后端不填充 vram_used（恒 0），不作为占用来源。 */
export async function getSystemStats(): Promise<ComfySystemStats | null> {
  try {
    const res = await fetch(`${comfyBase()}/system_stats`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      system?: { ram_total?: number; ram_free?: number };
      devices?: ComfyDevice[];
    };
    const dev = pickGpu(data.devices);
    const vramTotal = dev?.vram_total ?? 0;
    const vramFree = Math.max(
      0,
      Math.min(dev?.vram_free ?? vramTotal, vramTotal),
    );
    const vramUsed = vramTotal - vramFree;
    const ramTotal = data.system?.ram_total ?? 0;
    const ramFree = data.system?.ram_free ?? 0;
    // 并行查 nvidia-smi 物理专用显存：nvidia-smi 反映本机物理 GPU，与
    // ComfyUI 的 CUDA 逻辑口径并列展示供对照。查询失败 / 非 NVIDIA 卡
    // 返回 null，不影响 ComfyUI 主数据与在线状态。
    const smi = await queryNvidiaVram();
    return {
      online: true,
      gpuName: dev?.name ?? (dev?.type === "cpu" ? "CPU" : undefined),
      vramUsed,
      vramFree,
      vramTotal,
      smiVramUsed: smi?.usedMiB != null ? smi.usedMiB * 1024 * 1024 : undefined,
      smiVramTotal:
        smi?.totalMiB != null ? smi.totalMiB * 1024 * 1024 : undefined,
      ramUsed: ramTotal > 0 ? Math.max(0, ramTotal - ramFree) : 0,
      ramTotal,
    };
  } catch {
    return null;
  }
}
