// 本机 ComfyUI 实例的薄 REST 封装。
// 注意：ComfyUI 的所有接口都挂在 /api/ 下。
//
// base URL 每次调用都从应用设置里现解析（因此设置页改完即时生效），
// 设置缺失时回落 COMFYUI_BASE 环境变量，再回落本机地址。
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

import { clamp } from "~/lib/clamp";
import { getSettingsSync } from "../app-settings/app-settings.server";
import { COMFYUI_DEFAULT_PORT } from "../endpoints";
import { comfyUiBaseUrl, LOOPBACK_HOST } from "../endpoints";
import { baseForLocalPort, queryInstanceByPath } from "./instance-port";
import { probeBaseOnce, probeComfyAtPort } from "./probe";
import { queryNvidiaVram } from "./gpu-vram";
import { logger } from "~/lib/core/logger";

/** 配置端口连不上时，还要额外探测多少个端口 */
const PROBE_RANGE = 5;

/** 探测成功后缓存下来的 base URL（只写一次） */
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
    return { port, url: comfyUiBaseUrl(port) };
  });
  if (!targets.some((t) => t.port === COMFY_WINDOW_PORT)) {
    targets.push({
      port: COMFY_WINDOW_PORT,
      url: comfyUiBaseUrl(COMFY_WINDOW_PORT),
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
type SilentProbeGlobal = { key?: string; lastAt?: number };

declare global {
  var __comfySilentProbeV1: SilentProbeGlobal | undefined;
}

const probeLog: SilentProbeGlobal = (globalThis.__comfySilentProbeV1 ??= {});

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
 * Node 的 undici `fetch` 会把主机名 `localhost` 优先解析成 IPv6 的 `::1`。
 * ComfyUI 默认只监听 IPv4（0.0.0.0），在 `::1` 上从不应答，于是服务端每次请求
 * `http://localhost:8188` 都 ECONNREFUSED —— 而直接用 `curl localhost:8188`
 * 却一切正常，故障现场因此极难理解。
 * 这里把环回强制成 127.0.0.1，让流量留在 IPv4。真正跑在局域网 IP 或自定义
 * 主机名上的 ComfyUI 不受影响。
 */
function forceIpv4Host(raw: string): string {
  try {
    const url = new URL(raw);

    if (url.hostname === "localhost") url.hostname = LOOPBACK_HOST;

    return url.toString().replace(/\/$/, "");
  } catch {
    return raw;
  }
}

/** 探单个端口 —— ComfyUI 应答即返回 true。
 *
 * 判据走 `probe.ts` 的 `probeBaseOnce` 唯一口径（**连上即存活**，含 GPU OOM
 * 的 500 应答，#685）——此前这里自己 `return res.ok`，同一实例会「单点探测
 * 判活、端口扫描判死」，正是 #685 修完又被绕过的形态。
 *
 * 超时按环回地址给 300ms：真实监听中的 ComfyUI 应答 /system_stats 是毫秒级，
 * 800ms 只会拉长「未运行」场景的空扫（配置端口 +1..+5 共 6 次探测，
 * ComfyUI 未运行时 resolveComfyBase 每次都要付完全部超时）。 */
async function probePort(_host: string, port: number): Promise<boolean> {
  return (await probeBaseOnce(comfyUiBaseUrl(port), 300)) !== null;
}

/**
 * 解析 ComfyUI 的实际 base URL，带端口自动探测。
 * 依次试：配置端口 → +1 … 到 +PROBE_RANGE。结果缓存到进程生命周期结束。
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
        comfyUiBaseUrl(
          settings.comfyuiPort && settings.comfyuiPort > 0
            ? settings.comfyuiPort
            : COMFYUI_DEFAULT_PORT,
        ),
    );
  } catch {
    url = new URL(comfyUiBaseUrl(COMFYUI_DEFAULT_PORT));
  }
  const host = url.hostname === "localhost" ? LOOPBACK_HOST : url.hostname;
  const configuredPort =
    settings.comfyuiPort && settings.comfyuiPort > 0
      ? settings.comfyuiPort
      : Number.parseInt(url.port, 10) || COMFYUI_DEFAULT_PORT;

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
      return comfyUiBaseUrl(configuredPort);
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
    _resolvedBase =
      host === LOOPBACK_HOST
        ? comfyUiBaseUrl(configuredPort)
        : `http://${host}:${configuredPort}`;
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
  return comfyUiBaseUrl(configuredPort);
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
/* 既有导入路径的兼容出口：`probeComfyAtPort` 曾在本模块定义，
 * 已下沉到零依赖叶子（断环所需），名字与签名逐字不变。 */
export { probeComfyAtPort };

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

/**
 * 同步版本 —— 返回缓存值或原始配置（不探测端口）。
 * 适用于「延迟比准确更重要」的非关键读取。
 * 会改变状态的调用（上传 / 提交 prompt）请用 resolveComfyBase()。
 */
export function comfyBase(): string {
  if (_resolvedBase) return forceIpv4Host(_resolvedBase);
  const settings = getSettingsSync();
  const port =
    settings.comfyuiPort && settings.comfyuiPort > 0
      ? settings.comfyuiPort
      : COMFYUI_DEFAULT_PORT;
  const raw = process.env.COMFYUI_BASE ?? comfyUiBaseUrl(port);
  return forceIpv4Host(raw);
}

/**
 * 丢掉缓存的探测结果，让下一次 resolveComfyBase() 重新探测。
 *
 * 必需的原因：ComfyUI 重启后可能落在**另一个**端口（配置端口被占用时它会自己 +1）。
 * 不清缓存就会在整个进程生命周期里钉死在一个已经死掉的端口上。执行器在
 * WebSocket 断开时都会调它，因此每次重连都会重新发现活着的是哪个端口。
 */
export function resetComfyBase(): void {
  _resolvedBase = null;
}

/** `http(s)://host:port` → `ws(s)://host:port`（ComfyUI 的 /api/ws 挂在那个地址下）。 */
export function toWsBase(httpBase: string): string {
  return httpBase.replace(/^http(s?):\/\//i, (_m, s) => `ws${s}://`);
}

export async function getHistory(
  promptId: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${comfyBase()}/api/history/${promptId}`, {
    // 本地 ComfyUI 正常秒回；此超时只兜「连上却不返回」的病态挂死，给足余量。
    signal: AbortSignal.timeout(15_000),
  });
  return (await res.json()) as Record<string, unknown>;
}

/** `getView` 的失败带着 ComfyUI 回的状态码。
 *
 *  为什么要有这个类：调用方得分清「文件不存在」（该回 404）与「上游答了别的东西」
 *  （该回 502）、「连不上」（该回 503 + 可分支的 hint），而这三件事在只有一个
 *  `Error("getView failed: 404")` 的时候只能靠**读消息**猜 —— 消息改了，判决就错。
 *  消息本身保持原样，`executor-finalize` 那类只管「拿不到就抛」的调用方零感知。 */
export class ComfyViewError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ComfyViewError";
    this.status = status;
  }
}

export async function getView(
  filename: string,
  subfolder: string,
  type: string,
): Promise<Buffer> {
  const url = new URL(`${comfyBase()}/api/view`);

  url.searchParams.set("filename", filename);

  url.searchParams.set("subfolder", subfolder ?? "");

  url.searchParams.set("type", type ?? "");

  const res = await fetch(url.toString(), {
    // 取图/视频字节，大图或视频可能慢；给足余量，只挡真正的无限悬挂。
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok)
    throw new ComfyViewError(res.status, `getView failed: ${res.status}`);

  return Buffer.from(await res.arrayBuffer());
}

// 返回某个模型目录在磁盘上的真实文件名列表。
export async function listModels(folder: string): Promise<string[]> {
  try {
    const res = await fetch(
      `${comfyBase()}/api/models/${encodeURIComponent(folder)}`,
      { signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as string[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * ComfyUI 自己认得的模型目录清单（`GET /api/models`）。
 *
 * 这是「模型按什么规则被发现」的权威答案：一套在跑的安装会暴露约 86 个目录
 * （checkpoints、loras、ultralytics_bbox、sams、gguf …）。模型库配置界面列出
 * 它们，用户从真实目录里挑，而不是自己猜目录名。
 *
 * ComfyUI 连不上时返回 `[]` —— 调用方据此显示空目录列表（只允许从真实目录配置）。
 */
export async function listModelFolders(): Promise<string[]> {
  try {
    const res = await fetch(`${comfyBase()}/api/models`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as string[];
    return Array.isArray(data)
      ? data.filter((datum) => typeof datum === "string" && datum.length > 0)
      : [];
  } catch {
    return [];
  }
}

export async function uploadImage(
  buffer: Buffer,
  filename: string,
  type = "input",
): Promise<{ name?: string }> {
  const base = await resolveComfyBase();
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(buffer)]), filename);
  form.append("type", type);
  const res = await fetch(`${base}/api/upload/image`, {
    method: "POST",
    body: form,
    // 上传参考图/大文件到本地 ComfyUI，给足余量，只挡病态挂死。
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    throw new Error(
      `ComfyUI 上传失败 (${res.status}): ${await res.text().catch(() => "")}`,
    );
  }
  return (await res.json()) as { name?: string };
}

/** 让 ComfyUI 中断**当前正在执行的这一轮**（全局停、不带 prompt 参数——所以
 *  「该不该发」的判据在调用方：只有握着该任务在飞执行的那一侧才发，见
 *  `enqueue.cancelTask` 与 `executor-host.mjs` 的 `reconcileCancelled`）。
 *  非 2xx 必须抛：调用方要靠它区分「中断请求发出去了」与「ComfyUI 没接」，
 *  静默成功会让取消继续出图时没有任何可查的痕迹（规范硬规则 4）。 */
export async function interrupt(): Promise<void> {
  const base = await resolveComfyBase();
  const res = await fetch(`${base}/api/interrupt`, {
    method: "POST",
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) {
    throw new Error(`POST /api/interrupt -> ${res.status}`);
  }
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
    const vramFree = clamp(dev?.vram_free ?? vramTotal, 0, vramTotal);
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

/** 拉取 ComfyUI `/queue` 的**原始快照**（`queue_running` / `queue_pending`）。
 *
 *  与 `getSystemStats` 同口径：服务不可达时返回 null，由调用方降级展示。
 *
 *  **不在这里解析**：`/queue` 条目的形态随版本变（元组 `[n, prompt_id, …]` 或
 *  第三方构建的 `{prompt_id}` 对象），解析只写了一处 ——
 *  `~/lib/comfyui/trace` 的 `queueTraceSummary`（reaper 的对账用的就是它）。
 *  两处各解一遍必然分叉，而「队列里有几个任务」正是状态栏要报的数。 */
export async function getComfyQueue(): Promise<unknown> {
  try {
    const res = await fetch(`${comfyBase()}/queue`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
