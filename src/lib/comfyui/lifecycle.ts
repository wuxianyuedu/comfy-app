// ComfyUI 生命周期管理：探测、按配置路径启动、等待就绪。
//
// 背景：任务只有在本进程与 ComfyUI 的 WS 连上后才会出队
// （processQueue 在 WS 未 OPEN 时直接 return），ComfyUI 不在运行时任务会
// 在队列里挂 30 秒后被 reaper 判死。此前用户只能自己去手动启动 ComfyUI。
//
// 本模块提供：
//   - probeComfyUi()      HTTP 探测是否可达（按次探测，不写会话缓存）
//   - ensureComfyUiReady() 未运行且已配置 comfyuiPath 时拉起进程并等待就绪
//   - stopComfyUiProcess() 杀掉 ComfyUI 进程树（设置页「关闭」按钮用）
//   - openComfyUi()        用系统默认浏览器打开运行中的 ComfyUI 网页界面
//   - isComfyStarting()   reaper 用：启动窗口期内不回收 QUEUED 任务
//   - getComfyUiStatus()  设置页状态/按钮用
//
// HMR 安全：启动单飞锁与子进程句柄挂在 globalThis 上，模块重载不会重复拉起。

import "server-only";
import type { spawn } from "child_process";
import fs from "fs";
import { getSettingsSync } from "../app-settings/app-settings.server";
import { probeComfyBase, probeComfyAtPort } from "./client";
import { logger } from "~/lib/core/logger";
import { killProcessTree } from "../kill-process-tree";
import { runEnsureLaunch } from "./lifecycle-launch";
import { resolveComfyLaunchPlan } from "./launch-path";
import { findPidForMainPy } from "./proc-detect";
import {
  getComfyRuntimeSnapshot,
  resetComfyRuntimeSnapshot,
  type ComfyRuntimeSnapshot,
} from "./status";
import { openUrlInBrowser } from "~/lib/open-in-browser";
import { COMFYUI_RUNTIME_LOG, SERVICES_LOG_DIR } from "~/lib/log-paths";
import { appendSessionBanner as appendSessionBannerToFile } from "~/lib/session-banner.server";
import {
  decideEnsureLaunch,
  decideStop,
  decideStopOutcome,
  deriveComfyUiStatus,
  isWithinStoppingWindow,
  isWithinWindow,
  shouldClearStoppingOnStopMiss,
} from "./lifecycle-derive";

export type ComfyUiStatus = {
  up: boolean;
  base: string | null;
  starting: boolean;
  /** 用户点了「关闭 ComfyUI」且进程树尚未确认退出：设置页据此保持「关闭中…」。 */
  stopping: boolean;
  /** 本次判定的探测是否仍在进行：UI 据此显示「检测中…」而不是先报「未运行」
   *  再跳「运行中」（外部已启动 ComfyUI 时尤其明显，ISSUE #339）。 */
  probing: boolean;
  pid?: number;
  /** 进程级快照定位到的端口（HTTP 未就绪时也可能有值，供「正在启动」提示）。 */
  port?: number | null;
  /** 该实例是用什么起的（中文短语，如「配置路径的实例」）——状态行提示用。 */
  via?: string | null;
};

type EnsureResult = { ok: boolean; base: string | null; detail: string };

type LifecycleGlobal = {
  child?: ReturnType<typeof spawn>;
  /** 当前 `child` 是否以 detached 方式拉起（= POSIX 下的进程组组长）。
   *  keepAlive 走 `spawn({detached:true})`，bound 是普通 spawn —— 回收时
   *  「能不能杀进程组」全看这个标记，判错不报错、只静默留孤儿（见
   *  kill-process-tree 的实测对照）。 */
  childDetached?: boolean;
  starting?: Promise<EnsureResult>;
  /** 用户点了「关闭 ComfyUI」：启动等待循环见到它就中止，不再报「秒退」。 */
  stopRequested?: boolean;
  /** 「关闭中」窗口的开始时刻（毫秒）：设置页在窗口内显示关闭进行态，
   *  进程树确认退出后清零。 */
  stoppingAt?: number;
  /** 最近一次「拉起流程进行中」的时刻（毫秒）：设置页状态行在窗口内不落
   *  「未运行」。见 COMFY_STARTING_WINDOW_MS。 */
  startingAt?: number;
  /** 最近一次**探明**「没在跑」的时刻（毫秒）：结论可信度高于任何在途探测，
   *  见 COMFY_NOT_RUNNING_HOLD_MS。 */
  notRunningAt?: number;
  /** 用户手动点了「关闭 ComfyUI」：此后自动启动路径（WS 重连 / 状态轮询触发的
   *  ensureComfyUiReady）不再自动拉起，直到用户手动点「启动 ComfyUI」或
   *  重新开启自动启动。解决「关闭后切个页签 ComfyUI 又被重连循环拉起」的困惑。 */
  manualStop?: boolean;
  /** 一次自动启动以「明确的失败」收尾（保活进程已退出 / 拉起后进程未出现 /
   *  秒退等）：此后自动启动路径不再反复重试，直到用户手动点「启动 ComfyUI」
   *  或重新开启自动启动。解决「启动失败后一直自动重试」——重试只是把同一段
   *  失败日志与同一条错误横幅刷进队列，徒增噪声与无谓的进程拉起。 */
  autoStartFailed?: boolean;
  /** 最近一次自动启动失败的 detail：重试被拦时原样回报，让队列任务仍能看到
   *  「上次为什么失败」，而不是只收到一句泛泛的「已跳过」。 */
  autoStartFailureDetail?: string;
};
const G_KEY = "__comfyLifecycle_v1";
const g = globalThis as unknown as Record<string, LifecycleGlobal | undefined>;
const st: LifecycleGlobal = g[G_KEY] ?? {};
g[G_KEY] = st;

/** 任务自动启动路径的等待上限：到点后放弃本次等待，WS 层稍后重试时会
 *  重新拉起（单飞锁已释放）。设置页手动启动不设上限（见 ensureComfyUiReady）。 */
export const COMFYUI_AUTOSTART_TIMEOUT_MS = 420_000;

/** 「关闭中」标记的兜底时限：正常关闭在 2.5s 内出结果（stopComfyUiProcess
 *  最多等 5×500ms），窗口拉到 30s 只为兜住「命令已发出但进程僵住」的长尾。
 *  过窗后状态回到探测结果驱动，不会永久卡在「关闭中…」（React 状态不可
 *  跨挂载存活，刷新后丢失——见 ISSUE #103）。 */
export const COMFY_STOPPING_WINDOW_MS = 30_000;

/** 「启动进行中」窗口：与 `st.starting`（进程内单飞锁）互补的**计时**判据。
 *
 *  单飞锁只在「本进程发出的那次拉起」期间为真。而设置页的启动流程在拉起前
 *  还要先保存配置、拉起后要探测确认，`comfyStatus` 的 5s 轮询会在这个空窗里
 *  问出一次「进程表没命中、HTTP 也没通」的**瞬时**结论——用户看到的就是
 *  「刚起来又变回未运行，几秒后才变运行中」（ISSUE #442）。
 *
 *  窗口长度取启动确认的合理上限（拉起后到端口绑定通常几秒内，12s 覆盖
 *  「拉起 → 等 HTTP 就绪」这整段），期间状态行不落「未运行」。 */
export const COMFY_STARTING_WINDOW_MS = 12_000;

/** 「探明没在跑」的结论黏滞时长。
 *
 *  为什么需要：`comfyStatus` 每 5s 轮询一次，而每次判定的成本是
 *  「PowerShell 进程表查询（冷启动高负载时 ~2.5s、超时上限 10s）+ HTTP 探测」。
 *  一次刚起来、还在加载模型的实例上，进程表查询经常超时 → 快照 `unverified`
 *  → 结论落「检测中…」；下一轮查询**恰好成功但没命中**（实例由 uv 起、命令行
 *  里没有 main.py，见 status.ts 的判据链）→ 结论落「未运行」。于是状态行在
 *  探针抖动里闪回「未运行」，即便进程与端口始终活着（ISSUE #442 的后半段）。
 *
 *  10s 正好覆盖「一次慢探测 + 一次轮询间隔」：一处坐实，状态行不再被下一轮
 *  的抖动打回。 */
export const COMFY_NOT_RUNNING_HOLD_MS = 10_000;

/** 本地时间戳（YYYY-MM-DD HH:mm:ss）：runtime 日志是给本机用户看的，
 *  toISOString 的 UTC 在 +8 时区会凭空差出 8 小时。 */
function localTimestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 探测 ComfyUI 是否可达；成功返回实际可用的 base（可能带端口偏移）。
 *
 * 走 `probeComfyBase()`（按次探测）而不是 `resolveComfyBase()`：后者是带会话
 * 粘性的结论，一次「进程在、端口还没绑定」的探测会把配置地址缓存住，
 * ComfyUI 随后就绪时这里仍然返回 null —— 设置页的状态行就永远停在「正在启动…」
 * 翻不成「运行中」（ISSUE #344）。本函数只回答「此刻能不能用」，不该改会话结论。
 *
 * 超时统一由 `probeComfyBase()` 的 1.5s 决定（环回地址上真实监听的 ComfyUI
 * 应答是毫秒级，够用且能压住「未运行」时反复空扫的开销）；调用方传的
 * `timeoutMs` 保留在签名里只因多处按「探测预算」语义在传，不再单独生效。 */
export async function probeComfyUi(_timeoutMs = 2500): Promise<string | null> {
  return probeComfyBase();
}

/**
 * 关闭 ComfyUI：杀整棵进程树。
 * Windows 走 `taskkill /PID <pid> /T /F`（cmd 外壳死了不杀子进程会留下
 * python 孤儿锁住端口与日志文件）；POSIX 由 `killProcessTree` 向进程组
 * 发信号（拿不到组时单杀兜底），两条路径都收在 `~/lib/kill-process-tree`。
 *
 * 两种来源都能关：
 *   - bound（默认）：本进程持着子进程句柄 st.child，直接以其 PID 杀树；
 *   - keepAlive / 重启后接管：本进程没有 st.child（保活实例是 Start-Process
 *     中介拉起的孙进程 / 上一会话遗留的孤儿），改按配置路径的 main.py 在
 *     OS 进程表里定位 PID 再杀树——否则用户点「关闭」只会得到
 *     「不是本应用启动的」而永远关不掉上一会话保活下来的 ComfyUI（ISSUE #100）。
 */
export async function stopComfyUiProcess(): Promise<{
  ok: boolean;
  detail: string;
}> {
  // 无论有没有本应用拉起的子进程，都先落「用户要求停止」标记：若此刻正有
  // 一个启动等待在跑，等待循环会以「已手动关闭」收尾，而不是误报「进程秒退」。
  st.stopRequested = true;
  /* 关闭是比「启动中」更强的意图：立刻取消启动窗口。否则刚启动完就让状态行
   * 显示「未运行」的用户会先看到一段「启动中…」（窗口期语义），与他的动作不符。 */
  st.startingAt = undefined;
  // 手动关闭是一次明确的用户意图：落「手动关闭后不自动启动」闩锁，杜绝
  // WS 重连循环 / 状态轮询在用户切页签时又把 ComfyUI 悄悄拉起（见 ISSUE #290）。
  st.manualStop = true;

  // 解析出本应用应负责的 main.py 路径：bound / keepAlive / 重启后接管，
  // 「该关哪个进程」统一由配置路径决定，不依赖是否还握着子进程句柄。
  const settings = getSettingsSync();
  const plan = settings.comfyuiPath
    ? resolveComfyLaunchPlan(settings.comfyuiPath)
    : { error: "未配置 comfyuiPath" };

  // 1) 握着 bound 子进程句柄 → 以其 PID 为准（最可靠，不猜）。
  // 2) 没握句柄但 ComfyUI 仍在跑 → 到 OS 进程表按 main.py 定位 PID，
  //    覆盖 keepAlive（保活实例无 st.child）与「应用退出重启后接管上一会话
  //    保活实例」两种场景（globalThis 状态已被新进程清空）。
  let child = st.child;
  // findPidForMainPy 以 null 表示「未找到」，与 child?.pid 的 undefined 归一
  let pid: number | null = child?.pid ?? null;
  const stillUp = await probeComfyUi(1500);
  if (!pid && stillUp && !("error" in plan)) {
    pid = await findPidForMainPy(plan.mainPy);
    if (pid) child = undefined; // 无句柄，仅用定位到的 PID
  }
  const stopDecision = decideStop({
    hasChild: !!child,
    pid,
    stillUp: !!stillUp,
  });
  if (stopDecision.kind !== "kill") {
    // 目标已经不在了：立刻清「关闭中」标记，不留无意义的进行态窗口。
    if (
      shouldClearStoppingOnStopMiss({
        stillUp: !!stillUp,
        starting: isComfyStarting(),
      })
    ) {
      st.stoppingAt = undefined;
    }
    if (stopDecision.kind !== "foreign-running") markComfyNotRunningProven();
    return stopDecision.kind === "foreign-running"
      ? {
          ok: false,
          detail:
            "ComfyUI 在运行但不是本应用（配置路径）启动的，请在 ComfyUI 自己的窗口/终端中手动关闭",
        }
      : { ok: true, detail: "ComfyUI 未在运行" };
  }
  pid = stopDecision.pid;

  const kind = stopDecision.kindLabel;
  appendRuntimeLog(`[stop] 用户要求关闭 ComfyUI，目标：${kind}（pid=${pid}）`);
  // 回收整棵进程树（AGENTS 硬规则 3）：Windows taskkill /T /F，POSIX 杀进程组。
  // 平台判据集中在 kill-process-tree，这里不再自己摸 process.platform —— 旧实现
  // 的 POSIX 分支只单杀 leader，python 子进程会残留成孤儿锁端口（实测复现）。
  // detached 取实际拉起方式：bound（本进程 spawn）为 false；keepAlive 的 POSIX
  // 分支是 `spawn({detached:true})`（组长），无句柄的接管场景也按 guard 时的
  // 标记传 —— 只有传对它才能命中 `kill(-pid)` 的进程组路径。
  const kill = await killProcessTree({ pid, detached: st.childDetached === true });
  appendRuntimeLog(`[stop] 回收进程树：${kill.via}`);
  if (st.child === child) {
    st.child = undefined;
    st.childDetached = undefined;
  }
  // 给进程一点退出时间，再探测确认。每轮结果都收集起来，由纯函数给出结论
  // （«最后一轮是否仍可达» 即「关了没有」），避免把判据散在循环与收尾两处。
  const stopProbes: (string | null)[] = [];
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const probe = await probeComfyUi(800);
    stopProbes.push(probe);
    if (!probe) break;
  }
  const outcome = decideStopOutcome(stopProbes);
  // 进程树刚被改动过：快照必须失效，否则状态行会继续沿用关闭前的结论。
  resetComfyRuntimeSnapshot();
  resetComfyUiStatus();
  if (outcome.ok) {
    appendRuntimeLog("[stop] ComfyUI 已关闭");
    markComfyNotRunningProven();
    // 非 bound（keepAlive / 接管场景）没有 child.on("exit") 会落会话结束
    // 横幅——这里补一条，保持「每次会话都有 start/end 分隔」的一致性。
    if (!child) appendSessionBanner("end", "■ ComfyUI 已手动关闭");
    clearComfyStopping();
    return outcome;
  }
  appendRuntimeLog("[stop] 关闭命令已发送，但 ComfyUI 仍在响应");
  return outcome;
}

export function isComfyStarting(): boolean {
  return !!st.starting;
}

/** 自动启动是否已被闩锁抑制（用户手动关闭过 / 上次自动启动已失败）。
 *  WS 层据此决定「还要不要继续安排重连」——被抑制时重连只是空转
 *  （每轮都是探测失败 → 讨要启动 → 被拦下），徒增日志与请求（ISSUE #335）。 */
export function isComfyAutoStartSuppressed(): boolean {
  return !!st.manualStop || !!st.autoStartFailed;
}

/** 「启动流程进行中」窗口是否仍然生效（见 COMFY_STARTING_WINDOW_MS）。 */
function isComfyStartingWindow(): boolean {
  return isWithinWindow({
    at: st.startingAt,
    nowMs: Date.now(),
    windowMs: COMFY_STARTING_WINDOW_MS,
  });
}

/** 「探明没在跑」的结论是否仍在黏滞期内（见 COMFY_NOT_RUNNING_HOLD_MS）。 */
function isComfyNotRunningHeld(): boolean {
  return isWithinWindow({
    at: st.notRunningAt,
    nowMs: Date.now(),
    windowMs: COMFY_NOT_RUNNING_HOLD_MS,
  });
}

/** 记下「拉起流程刚刚发生」：设置页状态行在窗口内不落「未运行」。 */
function markComfyStarting(): void {
  st.startingAt = Date.now();
}

/** 记下「刚刚探明没在跑」：此刻的「未运行」结论可信，值得黏滞住。 */
function markComfyNotRunningProven(): void {
  st.notRunningAt = Date.now();
}

/** 事实已经/即将变化（启动、关闭、外部实例刚被认出）：两把「未运行」黏滞
 *  标记都作废，结论立刻回到探测驱动。 */
function clearComfyDownLatch(): void {
  st.startingAt = undefined;
  st.notRunningAt = undefined;
}

/** 「关闭中」窗口是否仍然生效（见 COMFY_STOPPING_WINDOW_MS）。 */
export function isComfyStopping(): boolean {
  return isWithinStoppingWindow({
    stoppingAt: st.stoppingAt,
    nowMs: Date.now(),
    windowMs: COMFY_STOPPING_WINDOW_MS,
  });
}

/** 清掉「关闭中」标记：进程树已确认退出 / 用户重新点了启动。 */
function clearComfyStopping(): void {
  st.stoppingAt = undefined;
}

/** 清掉「自动启动抑制」闩锁：用户重新开启了自动启动（设置保存）时调用，
 *  让自动启动恢复生效。两把闩锁同清——「手动关闭」与「启动失败」都属
 *  「自动路径先不要再动」的用户/环境信号，重新开启自动启动即等于重新授权。 */
export function clearComfyManualStop(): void {
  st.manualStop = false;
  clearComfyAutoStartFailure();
}

/** 清掉「自动启动失败后不重试」闩锁：用户手动点「启动 ComfyUI」时调用，
 *  让自动启动路径重新获得重试机会（用户明确要求拉起 = 重新授权）。 */
export function clearComfyAutoStartFailure(): void {
  st.autoStartFailed = false;
  st.autoStartFailureDetail = undefined;
}

/** 该次 ensureComfyUiReady 是否属于「值得拦下后续重试」的明确失败：
 *  环境/路径/配置/进程秒退这类失败重试无意义，只会在日志里刷同样的错。 */
function isTerminalAutoStartFailure(detail: string): boolean {
  return /启动失败|立即退出|未配置|未开启自动启动|手动关闭/.test(detail);
}

/** 状态结论的缓存时长：探测本身是秒级的（进程表查询 10s 上限 + HTTP 1.5s），
 *  比轮询间隔还长；缓存只为吸收「轮询 / 连点」的重复探测，不做长 TTL——
 *  外部实例刚起来时最多等这么久被认出来。 */
export const COMFY_STATUS_TTL_MS = 10_000;

type StatusCacheGlobal = {
  entry?: { at: number; status: ComfyUiStatus };
  inflight?: Promise<ComfyUiStatus>;
};

const STATUS_CACHE_KEY = "__comfyUiStatusCache_v1";

function statusCache(): StatusCacheGlobal {
  const g = globalThis as unknown as Record<
    string,
    StatusCacheGlobal | undefined
  >;
  const st = g[STATUS_CACHE_KEY] ?? {};
  g[STATUS_CACHE_KEY] = st;
  return st;
}

/** 丢掉状态结论缓存：进程树刚被启动 / 关闭动作改动过，下一问必须重取事实。
 *
 *  两把「结论黏滞」标记（启动窗口 / 探明没在跑）同清：它们的存在只为吸收
 *  「同一台实例被相邻两次判定给出相反答案」，而显式失效恰恰说明事实已经
 *  变了（启动 / 关闭动作刚落位），此时再拿旧结论挡新事实就是把状态行按在
 *  错的答案上（ISSUE #344：ComfyUI 已经起来，设置页还压着「启动中…」）。 */
export function resetComfyUiStatus(): void {
  const cs = statusCache();
  cs.entry = undefined;
  cs.inflight = undefined;
  clearComfyDownLatch();
}

/**
 * 设置页状态：进程级快照（优先）+ HTTP 探测（判定「能不能立刻用」）合并成一条结论。
 *
 * 判定顺序（每一条都能单独解释一次真实误报，见 ISSUE #339）：
 *   1. `probeComfyUi()` 通了 → 运行中，用它返回的真实 base（可能带端口偏移）；
 *   2. 没通但有活着且已绑定端口的 ComfyUI 进程 → 运行中，base 用进程实际监听
 *      端口拼出来（ComfyUI 起来后 `/system_stats` 短暂不可用也不该报「未运行」）；
 *   3. 没通、进程在但端口未绑定 → 「启动中」：外部实例正在加载模型时如实显示；
 *   4. 都没有 → 未运行。
 *
 * 探测失败（`unverified`，如 PowerShell 超时）且 HTTP 也没通时**不**直接下
 * 「未运行」的结论，而是把 `probing` 置真：宁可多显示一次「检测中…」，也不要
 * 把正在启动的实例误报成未运行（这正是用户看到的状态来回跳）。
 */
export async function getComfyUiStatus(
  opts: { force?: boolean } = {},
): Promise<ComfyUiStatus> {
  /* TTL 缓存 + 在途去重：状态行按秒轮询，每次轮询都重付一遍
   * 「PowerShell 进程表查询 + HTTP 探测」在本机要十几秒（ISSUE #346 的
   * `setting.comfyStatus 10457ms` 就是它），既让状态行刷新慢到看不出变化，
   * 也让每次慢查询都在日志面板留一条 warn 刷屏。
   *
   * 缓存的是**合并后的结论**而不是某一路事实：状态行显示的就是这条结论，
   * 缓存它就等于「同一个 TTL 窗口内只做一次判定」。
   * 启动 / 关闭 / 手动刷新等「事实即将或已经变化」的动作会先
   * `resetComfyUiStatus()`，不会读到旧结论。 */
  const cs = statusCache();
  const cached = cs.entry;
  if (!opts.force && cached && Date.now() - cached.at < COMFY_STATUS_TTL_MS) {
    /* `starting` / `stopping` **不缓存**：它们是进程内计时器（启动单飞锁、
     * 关闭窗口）驱动的**瞬时**态，会独立于探测结果变化。把「启动中」缓存
     * 十几秒，设置页会在 ComfyUI 已经起来之后仍显示「启动中…」——这正是
     * ISSUE #344 的现象。缓存只覆盖探测出来的那部分事实。 */
    return withTransientFlags(cached.status);
  }
  /* 在途去重：并发查询（tRPC 批处理 / 连点刷新）共享同一次判定，
   * force 也一样——「强制」的语义是「不吃已有结论」，不是「再起一次重复探测」。 */
  if (cs.inflight) return cs.inflight;
  const task = computeComfyUiStatus().then((status) => {
    cs.entry = { at: Date.now(), status };
    cs.inflight = undefined;
    return status;
  });
  cs.inflight = task;
  return task;
}

/** 把瞬时态（starting / stopping）换成「此刻」的值，其余沿用缓存的探测结论。 */
function withTransientFlags(status: ComfyUiStatus): ComfyUiStatus {
  const starting = isComfyStarting();
  const stopping = isComfyStopping();
  if (status.starting === starting && status.stopping === stopping)
    return status;
  return { ...status, starting, stopping };
}

/* 状态判定 = 快照（进程在不在）+ HTTP 探测（接口通不通），但**先快照后探测**，
 * 且快照命中端口时不再走那条「重问一遍进程表」的通用探测。
 *
 * 为什么这个顺序是关键的（ISSUE #339 的残留延迟）：`probeComfyUi()` 底下要
 * `resolveComfyBase()`，而后者在配置了路径时会**再查一遍进程表**才决定探哪个
 * 地址——它不认快照刚拿到的事实，于是同一件事被问两遍，第二遍还是最贵的那个
 * （PowerShell 枚举 `Win32_Process`，本机 ~2.5s，超时 10s）。串起来就是
 * 「ComfyUI 明明已经在跑，打开设置页还要等一会才显示运行中」。
 *
 * 现在的路径：
 *   · 快照命中「进程 + 端口」→ 直接探那个端口（一条 HTTP，毫秒级）。
 *     这是「外部已经启动 ComfyUI」的主场景，也是用户抱怨的那条。
 *   · 快照拿不到端口（进程没找到 / 端口未绑定 / 只有 bound 判定）→ 才退回
 *     通用探测；那条路要负责「配置端口 / 环境变量 / 偏移端口」的发现，是
 *     快照覆盖不到的场景。
 *
 * 不把通用探测与快照**强行并发**：它自己也要查进程表，与快照的候选查询并发
 * 会在冷启动高负载的机器上同时拉起更多 PowerShell 枚举——那正是当初「进程表
 * 查询超时」的成因。快照内部已经把「同一件事的几种问法」并发了（见 status.ts），
 * 那批并发是必要且有界的，这里不再叠一层。 */
async function computeComfyUiStatus(): Promise<ComfyUiStatus> {
  /* 「启动中」窗口与「探明没在跑」的黏滞标记都在判定结束时按结论落位
   * （见 deriveAndLatch），所以判定入口**先采样**、不能等 await 回来再读。 */
  const starting = isComfyStarting();
  const stopping = isComfyStopping();
  const startingWindow = isComfyStartingWindow();
  const notRunningHeld = isComfyNotRunningHeld();
  const snap = await getComfyRuntimeSnapshot();
  /* 快照已定位到实例的监听端口 → 直连它，不再绕 `resolveComfyBase()`。
   * 探不通（实例刚起、/system_stats 还没就绪）时退回通用探测的结论——那可能
   * 从「配置端口 / 偏移端口」上发现同一个实例（快照的端口是 PID 的监听端口，
   * 正常情况下两者一致，退回只是兜底）。 */
  const probe =
    snap.running && snap.port
      ? ((await probeComfyAtPort(snap.port)) ?? (await probeComfyUi(1500)))
      : await probeComfyUi(1500);
  /* 「启动中」是唯一会自动翻页的结论（进程在、端口还没绑定 → 下一秒端口就出来了），
   * 所以它是唯一必须**当场复核**的结论：拿到的快照说还在启动、HTTP 也没通时，
   * 丢掉这份（可能刚过期的）快照重新取一次事实再判，避免把 5s 轮询里的两次
   * 采样都押在同一份陈旧快照上、让状态行停在「ComfyUI 正在启动…」（ISSUE #344）。 */
  if (!probe && snap.running && snap.port === null) {
    const [refreshed, reprobe] = await Promise.all([
      getComfyRuntimeSnapshot({ force: true }),
      probeComfyUi(1500),
    ]);
    return deriveAndLatch({
      starting,
      stopping,
      startingWindow,
      notRunningHeld,
      snap: refreshed,
      probe: reprobe,
    });
  }
  return deriveAndLatch({
    starting,
    stopping,
    startingWindow,
    notRunningHeld,
    snap,
    probe,
  });
}

/** 判定一条状态结论，并按结论维护两把「结论黏滞」标记。
 *
 *  为什么黏滞要挂在**状态判定**这层、而不是各自散在调用方：状态行就是这条
 *  结论的出口，结论跳变来自「同一台实例被相邻两次判定给出相反答案」，
 *  只有判定层知道上一句说了什么（ISSUE #442 的来回跳）。
 *
 *  两条标记的落位规则：
 *    · 结论是「未运行」且**这次真的查过进程表、且没有任何查询失败**（探明，
 *      不是探针抖动）→ 记一笔，接下来 COMFY_NOT_RUNNING_HOLD_MS 内不因更弱的
 *      证据改口；
 *    · 结论是「运行中」→ 一切都已确认活着，两把标记都清掉；
 *    · 「进程在、端口未绑定」（正在启动）→ 启动窗口继续生效，但不动「未运行」
 *      标记。 */
function deriveAndLatch(facts: {
  starting: boolean;
  stopping: boolean;
  startingWindow: boolean;
  notRunningHeld: boolean;
  snap: ComfyRuntimeSnapshot;
  probe: string | null;
}): ComfyUiStatus {
  const { snap, probe } = facts;
  const status = deriveComfyUiStatus({
    starting: facts.starting,
    stopping: facts.stopping,
    probe,
    snap,
    startingWindow: facts.startingWindow,
    notRunningHeld: facts.notRunningHeld,
  });
  if (status.up) clearComfyDownLatch();
  else if (status.probing) {
    /* 「检测中…」= 事实不可信：既不能坐实「未运行」，也不该让上一笔「探明没在跑」
     * 提前过期（那正是相邻两轮结论相反的来源）。 */
  } else if (status.starting) st.startingAt = Date.now();
  else if (snap.didQueryProcTable && !snap.unverified)
    markComfyNotRunningProven();
  return status;
}

function appendRuntimeLog(line: string): void {
  try {
    fs.mkdirSync(SERVICES_LOG_DIR, { recursive: true });
    fs.appendFileSync(
      COMFYUI_RUNTIME_LOG,
      `${localTimestamp()} ${line}\n`,
      "utf-8",
    );
  } catch {
    /* 日志失败不影响主流程 */
  }
}

/**
 * 在 comfyui-runtime.log 写一条会话边界横幅。
 * comfyui-runtime.log 是追加不轮转的，多次启动的日志会一直累积——新一次
 * 启动的 `[spawn]`/`[out]` 行接在上次启动结尾后面，日志面板里难以分辨
 * 会话边界。横幅用 box 字符 + ANSI 亮色（面板解析后渲染成高亮）划出清晰的
 * 分隔线，**两侧各留一个空行**，因此直接看文件的用户也能一眼分出「本次从哪
 * 开始」（唯一实现见 `src/lib/session-banner.server.ts`）。
 *
 * 横幅正文**不带时刻**：时刻只留在每条行首（`appendRuntimeLog` 的统一口径），
 * 横幅里再写一遍会与紧随其后的行首时刻只差 1 秒，用户把两条读成一个，于是
 * 「ComfyUI 明明起来并写了新行，看着却像没有新增」（ISSUE #346 的同源困惑）。
 * @param kind start（绿）= 新会话开始；end（黄）= 会话结束
 * @param title 横幅中间的信息行（会话说明 / exit code 等，不含时刻）
 */
function appendSessionBanner(kind: "start" | "end", title: string): void {
  appendSessionBannerToFile(COMFYUI_RUNTIME_LOG, kind, title);
}


/**
 * 确保 ComfyUI 可用：可达则直接返回；不可达且配置了路径 + 自动启动时，
 * 拉起进程并轮询等待就绪。单飞锁保证并发任务/WS 重连只触发一次启动。
 *
 * 等待时长：`opts.timeoutMs` 缺省（undefined / null）= **不设硬超时**，一直
 * 等到就绪或进程退出——冷加载（重安装 / CUDA 初始化）慢起来没有准数，固定
 * 上限会在 ComfyUI 随后就绪时误报「启动超时」。设置页手动启动走无限等待
 * （实时日志可见、可随时手动关闭中止）；任务自动启动路径必须显式传
 * `COMFYUI_AUTOSTART_TIMEOUT_MS`，否则 reaper 的启动窗口会被无限拉长。
 */
export async function ensureComfyUiReady(
  opts: {
    timeoutMs?: number | null;
    onLog?: (msg: string) => void;
    manual?: boolean;
  } = {},
): Promise<EnsureResult> {
  const note = (msg: string) => {
    logger.info(`[comfyui-lifecycle] ${msg}`);
    opts.onLog?.(msg);
    appendRuntimeLog(msg);
  };

  // 用户明确要求拉起 → 状态快照必然过期（进程树即将变化），先失效，
  // 让紧随其后的状态查询看到启动后的新事实而不是旧结论。
  if (opts.manual) {
    resetComfyRuntimeSnapshot();
    resetComfyUiStatus();
  }

  // 快路径：已经在运行（探测可能有端口偏移，返回真实 base）
  const upBase = await probeComfyUi();
  if (upBase) return { ok: true, base: upBase, detail: "ComfyUI 已在运行" };

  // 单飞：并发调用共享同一次启动
  if (st.starting) {
    note("ComfyUI 正在启动中，等待就绪…");
    return st.starting;
  }

  /* 从这里起就进入「启动流程进行中」：无论这次是不是走 bound/keepAlive 拉起，
   * 事实都已经在变（进程即将/正在出现）。落一笔计时窗口，让设置页的 5s 轮询
   * 在这段空窗里问出的「什么都没探到」不再被渲染成「未运行」（ISSUE #442）。
   *
   * 放在判决表**之前**：判决表可能给出「未开自动启动 / 未配路径」这类直接
   * 返回，那种情况下窗口最多多显示十几秒「启动中…」，比在用户刚点过启动的
   * 当口闪一句「未运行」更可接受。 */
  markComfyStarting();

  // 手动启动＝用户明确要求拉起：先清掉两把「自动路径先别动」闩锁，否则上次
  // 手动关闭 / 上次启动失败的小尾巴会把这次明确启动也拦住。
  if (opts.manual) {
    st.manualStop = false;
    clearComfyAutoStartFailure();
  }

  // 非手动来源在「上一次自动启动已明确失败」后不再自动重试（ISSUE #335）：
  // 路径没配好 / 环境缺依赖 / 保活进程拉起来就退这类失败，重试只会把同一段
  // 错误反复刷进队列与 runtime 日志，并不能自愈。原样回报上次的失败详情，
  // 让用户知道「为什么这次没重试」，并给出可行动的出口（手动启动 / 改配置 /
  // 重新开启自动启动都会清掉闩锁）。
  //
  // 放在判决表之前：这里要的是「原样回报上次的失败详情」，而判决表只认识
  // 「有没有闩锁」——把「上次失败因为保活进程已退出」这类可行动的原因换成
  // 一句泛泛的「未开启自动启动」，用户会对着错误的原因改设置。
  if (!opts.manual && st.autoStartFailed) {
    const last = st.autoStartFailureDetail ?? "未知原因";
    note(`上次自动启动已失败，跳过自动重试：${last}`);
    return { ok: false, base: null, detail: last };
  }

  const settings = getSettingsSync();
  /* 判决表（顺序即优先级）抽在 lifecycle-derive 的 decideEnsureLaunch 里：
   * 已在运行 → 手动启动优先于闩锁 → 自动来源遇闩锁让路（ISSUE #290）→
   * 未开自动启动 / 未配路径给可行动提示。这里只负责把事实喂进去、把结论
   * 翻成用户文案；「上次自动启动已失败」的闩锁在判决表之前单独拦下
   * （ISSUE #335，需要原样回报失败原因），故没有并入判决表。 */
  const decision = decideEnsureLaunch({
    upBase,
    manual: !!opts.manual,
    manualStop: !!st.manualStop,
    autoStart: !!settings.comfyuiAutoStart,
    comfyuiPath: settings.comfyuiPath ?? "",
  });
  if (decision.kind === "already-up") {
    return { ok: true, base: decision.base, detail: "ComfyUI 已在运行" };
  }
  if (decision.kind === "skip-manual-stop") {
    note("ComfyUI 已被用户手动关闭，跳过自动启动");
    return {
      ok: false,
      base: null,
      detail:
        "ComfyUI 已被手动关闭，未自动开始启动——如需启动请到 设置 → 创作后端 点「启动 ComfyUI」",
    };
  }
  if (decision.kind === "skip-autostart-off") {
    return {
      ok: false,
      base: null,
      detail: "ComfyUI 未运行，且未开启自动启动（设置页可开启）",
    };
  }
  if (decision.kind === "skip-no-path") {
    return {
      ok: false,
      base: null,
      detail:
        "ComfyUI 未运行，且未配置安装路径——请到 设置 → 创作后端 填写 ComfyUI 路径",
    };
  }
  st.starting = runEnsureLaunch({
    host: {
      st,
      appendRuntimeLog,
      appendSessionBanner,
      clearComfyStopping,
      localTimestamp,
      probeComfyUi,
    },
    settings,
    timeoutMs: opts.timeoutMs,
    note,
  });

  try {
    const r = await st.starting;
    /* 自动启动失败后落闩锁：后续 WS 重连 / 状态轮询触发的自动启动不再重试，
     * 直到用户手动启动或重新开启自动启动（ISSUE #335）。只对「明确失败」落锁
     * （见 isTerminalAutoStartFailure）——「已经在运行」「未开启自动启动」这类
     * 结果不该把后续重试永久钉死。手动启动自己不算自动启动，不落锁。 */
    if (!opts.manual && !r.ok && isTerminalAutoStartFailure(r.detail)) {
      st.autoStartFailed = true;
      st.autoStartFailureDetail = r.detail;
    }
    return r;
  } finally {
    st.starting = undefined;
  }
}

/**
 * 用系统默认浏览器打开运行中的 ComfyUI 网页界面。
 * 等价于桌面壳里 tauri-plugin-opener 的「拉起系统浏览器」效果，但走 Node
 * 服务端命令（start / open / xdg-open），不需要动 Rust、不需重编壳。
 * 返回 ok=false 时 detail 给出可行动的提示。
 */
export async function openComfyUi(): Promise<{ ok: boolean; detail: string }> {
  const base = await probeComfyUi(2000);
  if (!base) {
    return {
      ok: false,
      detail: "ComfyUI 未在运行，请先点「启动 ComfyUI」再打开查看",
    };
  }
  const r = await openUrlInBrowser(base);
  if (r.ok) {
    return { ok: true, detail: `已用系统默认浏览器打开 ComfyUI（${base}）` };
  }
  return r;
}
