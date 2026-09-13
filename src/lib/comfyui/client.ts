// Thin REST wrapper around the local ComfyUI instance.
// IMPORTANT: all ComfyUI endpoints are under /api/.
//
// The base URL is resolved per-call from app settings (so it can be changed
// from the Settings page), falling back to COMFYUI_BASE env then localhost.
//
// 地址解析顺序（ISSUE #449）：
//   ① 配置了 comfyuiPath → **先问进程事实**：按路径找到实例进程，读它实际
//      监听的端口（见 `instance-port.ts`）。端口是「进程监听出来的」，不是
//      「逐个试出来的」——这一跳同时回答「在不在跑」与「在哪个端口」。
//   ② 拿不到进程事实（没配路径 / 没命中 / 查询失败）→ 才退回端口探测：
//      配置端口 → 就近偏移 +1..+PROBE_RANGE（ComfyUI 端口被占时会自增）→
//      ComfyUI 窗口端口，取第一个应答的。
//   ③ 命中即缓存（会话粘性）；没命中**不缓存**（实例随时可能起来）。
//
// 日志口径：探测全落空**不是**「ComfyUI 没在运行」的结论——本模块只认识
// 「配置地址 + 就近偏移 + 窗口地址」这一批地址，实例落在别的端口时同样落空
// （真正的运行判据是 `comfyui/status.ts` 的进程级快照）。因此这种情况记一条
// **warn** 汇总（含问过哪些地址），并按地址清单静默一段时间，避免运行期
// 每次提交 / 上传都把同一句话刷进面板。
//
// 多实例场景：comfyuiPath 配置了实例根目录后，resolveComfyBase 会先在 OS
// 进程列表确认「该路径的实例进程是否真的在运行」，再通过 PID→监听端口
// 定位实际端口。端口上有别的 ComfyUI 响应 ≠ 配置路径的实例在运行。

import { getSettingsSync } from "../app-settings";
import { baseForLocalPort, queryInstanceByPath } from "./instance-port";
import { queryNvidiaVram } from "./gpu-vram";
import { logger } from "~/server/lib/logger";

/** How many extra ports to probe when the configured one is unreachable */
const PROBE_RANGE = 5;

/** Cached resolved base URL (set once after successful probe) */
let _resolvedBase: string | null = null;

/** ComfyUI 的窗口地址（桌面版「打开查看」用的那个）。它作为实例清单的兜底项，
 *  而不是「服务端点」的等价物：窗口地址上跑的是 ComfyUI Desktop 的 Web UI，
 *  未必是我们配置的那个实例。 */
const COMFY_WINDOW_PORT = 8000;

/** 端口探测的候选清单：端口与地址成对给出。
 *
 *  偏移 0 = 配置地址（我们拉起的实例照此监听，除非端口被占时 ComfyUI 自己 +1）；
 *  偏移 1..N = 就近偏移；末尾补一条窗口地址，只在前面全部落空时才轮得到。 */
function probeTargets(configuredPort: number): { port: number; url: string }[] {
  const targets = Array.from({ length: PROBE_RANGE + 1 }, (_, offset) => {
    const port = configuredPort + offset;
    return { port, url: `http://127.0.0.1:${port}` };
  });
  if (!targets.some((t) => t.port === COMFY_WINDOW_PORT)) {
    targets.push({
      port: COMFY_WINDOW_PORT,
      url: `http://127.0.0.1:${COMFY_WINDOW_PORT}`,
    });
  }
  return targets;
}

/** 「探测全落空」汇总行的静默期。 */
export const COMFY_PROBE_LOG_REPEAT_MS = 60_000;

/** 上一批「探测全落空」的地址清单与写入时刻：抑制同一批地址的反复刷屏。
 *
 *  背景：`resolveComfyBase()` 只在**探到实例**时才把结论写进 `_resolvedBase`；
 *  「谁都没应答」不缓存（这是对的——实例随时可能起来，缓存会把会话钉死在一个
 *  连不上的地址上）。代价是运行期每一次提交 / 上传 / 状态轮询都会重扫一遍候选
 *  地址，也就都会写出一条内容**完全相同**的日志：面板里同一句话被刷成几百行，
 *  真正的现场信息反而被挤出视野（规范 07 §7.14：周期性的重复输出要先聚合）。
 *
 *  这不是状态结论、不参与任何判定（运行与否由 `comfyui/status.ts` 的快照回答），
 *  只是一个防刷屏的写入开关：地址清单一变（用户改了端口）就重新允许写第一条。 */
const SILENT_PROBE_KEY = "__comfySilentProbeV1";
type SilentProbeGlobal = { key?: string; lastAt?: number };
const probeLogStore = globalThis as unknown as Record<
  string,
  SilentProbeGlobal | undefined
>;
const probeLog: SilentProbeGlobal = probeLogStore[SILENT_PROBE_KEY] ?? {};
probeLogStore[SILENT_PROBE_KEY] = probeLog;

/** 探测链路的会话标识：只有**同一会话 + 同一批地址**才算「重复」。 */
const SESSION_ID = Math.random().toString(36).slice(2, 10);

/** 本次「探测全落空」是否值得再写一条日志（同一批地址、同一静默期内不重复写）。
 *  导出供回归测试直接断言节流判据。 */
export function shouldLogProbeMiss(
  key: string,
  now: number = Date.now(),
): boolean {
  const repeat =
    probeLog.key === key &&
    probeLog.lastAt !== undefined &&
    now - probeLog.lastAt < COMFY_PROBE_LOG_REPEAT_MS;
  if (repeat) return false;
  probeLog.key = key;
  probeLog.lastAt = now;
  return true;
}

/** 测试注入点：清掉防刷屏状态（用例之间互不污染）。 */
export function resetProbeMissLog(): void {
  probeLog.key = undefined;
  probeLog.lastAt = undefined;
}

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

  /* comfyuiPath 已配置：**先问进程事实**，再谈探测（ISSUE #449）。
   *
   * 顺序很关键：实例的端口是「进程监听出来的」而不是「试出来的」。直接从配置
   * 路径把进程找出来、顺手读它监听的端口（一次进程表查询 + 一次端口查询），
   * 就能同时回答「在不在跑」与「在哪个端口」——不必先探 :8188 再依次试
   * 8189..8193，等到全落空还只能写一句「连不上」。Comfy Desktop 的实例常见
   * 「桌面里正在跑、但端口与设置里的不一致」：旧流程会一路探偏移端口全落空，
   * 新流程第一跳就拿到那个真实端口。
   *
   * 判据链本身收在 `instance-port.ts`（与 status.ts 同口径：main.py → 启动器
   * 候选 → 环境反查），这里只管把结论翻成地址。 */
  const comfyuiPath = settings.comfyuiPath?.trim();
  if (comfyuiPath) {
    const found = await queryInstanceByPath(comfyuiPath);
    const portBase = baseForLocalPort(found.port);
    if (found.port != null && portBase) {
      _resolvedBase = portBase;
      logger.info(
        `[comfyui] Connected to configured instance on :${found.port} (pid=${found.pid}, via=${found.via})`,
      );
      return _resolvedBase;
    }
    if (found.running) {
      /* 进程在但端口未绑定（仍在加载）——先按配置地址返回给调用方试一次；
       * 不要把这次「还在启动」的结论缓存住，否则 ComfyUI 稍后绑定端口 / 落在
       * 偏移端口上时，本进程会一直沿用这个连不上的地址（见 probeComfyUi 的
       * 按次探测口径）。 */
      logger.info(
        `[comfyui] Configured instance (pid=${found.pid}, via=${found.via}) starting, port not bound yet`,
      );
      return `http://${host}:${configuredPort}`;
    }
    /* 没命中的两种含义必须分清（都是「不抛错」的老结论，见 ISSUE #344）：
     *   · unverified（进程表查询超时 / 高负载）→ 结果不可信，正在运行的实例
     *     绝不能因此被判「没在跑」，退回端口探测（下方公共路径）；
     *   · 查询成功但一条候选都没命中（Comfy Desktop 实例由 standalone-env /
     *     uv 起、命令行里未必有 main.py）→ 同样退回端口探测，由 HTTP 事实说话。
     * 「实例在不在」由 status.ts 的进程级快照负责，本函数只回答「连得上哪个
     * 地址」，不越权下「没在跑」的结论。 */
    logger.warn(
      found.unverified
        ? `[comfyui] Process lookup failed (timeout/busy?) for ${comfyuiPath}, falling back to port probe`
        : `[comfyui] No running instance process found for ${comfyuiPath}, falling back to port probe`,
    );
  }

  /* 公共探测路径（拿不到进程事实时的兜底）：配置端口 → 就近偏移 → 窗口地址。
   * 走到这里的前提是「问不到实例进程」——要么没配 comfyuiPath，要么按路径没
   * 命中（含查询失败/不可信），要么实例确实不是这个路径起的。 */
  if (await probePort(host, configuredPort)) {
    _resolvedBase = `http://${host}:${configuredPort}`;
    logger.info(`[comfyui] Connected on configured port :${configuredPort}`);
    return _resolvedBase;
  }

  /* 端口探测：配置地址先试，再试就近偏移（ComfyUI 端口被占时会 +1），最后才是
   * 窗口地址。命中偏移端口要记一条 warn——但只在**第一次**发现时记：探到之后
   * `_resolvedBase` 就记住了，本函数不会再走到这里。 */
  const targets = probeTargets(configuredPort);
  for (const target of targets.slice(1)) {
    if (!(await probePort(host, target.port))) continue;
    _resolvedBase = target.url;
    if (target.port === COMFY_WINDOW_PORT) {
      logger.warn(
        `[comfyui] Configured port :${configuredPort} unreachable, falling back to the ComfyUI window at :${COMFY_WINDOW_PORT}`,
      );
    } else {
      logger.warn(
        `[comfyui] Configured port :${configuredPort} unreachable, auto-discovered ComfyUI on :${target.port}`,
      );
    }
    return _resolvedBase;
  }

  /* 全落空——注意这**不等于**「ComfyUI 没在运行」：这条链路只认识「配置地址 +
   * 就近偏移 + 窗口地址」，实例落在别的端口（用户在 ComfyUI 侧自定义端口、
   * 或另一套启动方式占了别的端口）时同样走到这里。运行判据是
   * `comfyui/status.ts` 的进程级快照，它认得外部实例与解释器反查出来的实例；
   * 本函数只回答「这一批地址里哪个能连」。
   *
   * 因此这里记 warn 而不是 error：此前用 error，用户读到「ComfyUI 明明在跑却报
   * error」的第一反应就是「这里有故障」，而多数情况下实例只是不在这批地址上。
   * 汇总行写清问过哪些地址，并按地址清单静默，避免运行期反复刷同一条。
   *
   * 配置了 comfyuiPath 时这条 warn 前面还会有一条「No running instance process
   * found / Process lookup failed」（见上）——两者合起来才是完整现场：
   * 「按这条路径没找到实例进程」+「这一批地址也都没人应答」。 */
  const scope = targets.map((t) => `:${t.port}`).join(" / ");
  if (shouldLogProbeMiss(`${SESSION_ID}|${host}|${scope}`)) {
    logger.warn(
      `[comfyui] Cannot reach ComfyUI on ${scope} (probed ${targets.length} addresses, ${COMFY_PROBE_LOG_REPEAT_MS / 1000}s 内不再重复)` +
        `；这不代表实例没在运行——若实例落在其它端口，请在 设置 → 创作后端 改「端口」`,
    );
  }
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
