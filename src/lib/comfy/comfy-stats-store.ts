"use client";

// ── 系统指标（显存 / 内存）轮询的全页单点持有者 ──────────────────────
//
// 为什么收成 store 而不是各组件各拉一份：状态栏那格已经每 4s 拉一次 `/api/comfy/stats`
// （`useComfyStats` 原来是**每实例各自**的 `useState` + `useInterval`）。首页的算力
// 总览要用同一份读数，如果它再挂一个 hook，请求就变成两条独立轮询 —— 服务端是同一个
// 代理接口、两倍的 `/system_stats` 压力，而且两份「前台/后台暂停」各走各的，切回
// 前台时还会同时打两下。这类「谁都在读、谁都不认账」的重复正是规范 §12.12 要拦的。
//
// 于是：**观测收在这里一份**，组件侧一律经 `useComfyStats()` 用 `useSyncExternalStore`
// 订阅同一份快照。轮询只在「至少有一个订阅者」时存在，最后一个订阅者退订即停表。
//
// 语义与原 hook 逐条对齐（不改判据）：
//   · 4s 一轮、挂载即先跑一次、后台暂停、回前台补跑 —— 全部走 `~/lib/poll-timer`
//    （与 `useInterval` 同一实现，见规范 16 §16.2.4.15）；
//   · 连续失败迟滞走 `~/lib/offline-gate`（与队列通道同一判据，各持一台计数机）；
//   · **进程级判活**：回包 `online:false` 但 `processAlive:true`（进程在跑、只是这一拍
//     HTTP 没应答）不算「掉线」观测——清零连续失败计数、保留旧数据并置 stale，
//     在线结论保持；从未读到过数据时也按「在线（连接中）」渲染，顶栏不闪「未运行」。
//     口径与 `/api/comfy/queue` 同源（queue-status.server.ts 的快照回落）；
//   · 背压：只认最新一次请求的回包，迟到的旧回包丢弃（`useInterval` 明确不挡重叠，
//    这条由本文件负责，与原 hook 一致）。
//
// 「事件为主、轮询兜底」（ISSUE #1351）之后又多三件事，都在本文件：
//   · **轮询间隔按阶段给**（`~/lib/comfyui/liveness`）：启动等待 400ms、空闲 15s、
//     出图 30s、隐藏 60s。此前恒为 4s —— `/system_stats` 内部会调
//     `torch.cuda.mem_get_info`，出图高峰高频打它等于往已经排队的 aiohttp 里
//     插请求，既拖慢出图又更容易触发超时假阳性；
//   · **事件驱动复核**：订阅 `/api/comfy/liveness` 的进程退出事件，收到就**立刻**
//     探一次（`verifying` 档，间隔 0），不等下一拍。崩溃发现的延迟因此从「最多
//     一个轮询间隔」变成「一次 HTTP 往返」；
//   · **连续 3 次失败才判 crash**（`createCrashLatch`）：单次失败只累加、成功即清零。
//     出图高峰期单次超时太常见，一次失败就当崩了会把用户跑到一半的图杀掉。
//     它与 `observeOnline`（离线迟滞）是**两台独立的计数机**：那台管「这一格读数
//     还该不该按在线渲染」，这台管「进程是不是崩了」，共用一台会让先跑的那条把
//     另一条的失败清零。

import { fireAndForget } from "~/lib/async-action";
import { createOfflineGate } from "~/lib/offline-gate";
import { startPollTimer } from "~/lib/poll-timer";
import {
  classifyLivenessPhase,
  createCrashLatch,
  livenessIntervalMs,
  type CrashVerdict,
} from "~/lib/comfyui/liveness";

import { getComfyBusy } from "./comfy-busy-store";
import { subscribeComfyCrashes } from "./comfy-liveness-client";
import { fetchComfyStats, type ComfyStatsPayload } from "./comfy-stats-client";

/** 空闲档的轮询节奏（4s）：显存占用在跑图时每秒级变化，4s 足够反映趋势又不刷屏。
 *
 *  这是**指标展示**的节奏，不是存活判断的节奏 —— 存活现在由事件驱动 + 分阶段表
 *  负责（`~/lib/comfyui/liveness`）。两者拆开正是 ISSUE #1351 第四节要的那件事
 *  （「很多人说要 2s 刷新，其实想要的是 UI 上的数字动起来，这是指标展示需求」）。
 *
 *  为什么还留着这个导出：`use-comfy-stats` 把它透给「多久算一轮」的既有消费方，
 *  且有用例锚着它。存活那一档另有名字（`LIVENESS_*`），别混。 */
export const COMFY_STATS_POLL_MS = 4000;

/** 一份对外读数：视图层只读这三个字段，不自己发请求（规范 17 §17.2 第②层）。 */
export interface ComfyStatsSnapshot {
  /** 最近一次读到的指标；尚未返回时为 null。 */
  stats: ComfyStatsPayload | null;
  /** ComfyUI 是否在线：读到过好数据，或最近一次观测确认进程还活着（数据可能暂时读不到）。 */
  online: boolean;
  /** 处于迟滞容忍期内、显示的是上一次好数据（不闪离线，但需弱化提示）。 */
  stale: boolean;
  /**
   * 进程级判活的**结论**：此刻算不算「崩了」。
   *
   * 由 `createCrashLatch` 判定（连续 3 次失败才为真），与 `online` 是两件事：
   * `online` 是这一格读数能不能按在线渲染的 UI 结论，本字段是「进程还在不在」
   * 的存活结论。视图当前只读 `online`/`stale`，本字段留给后续的崩溃提示与
   * 自动重启（有了它才不必再从「连续三次读数都没数据」反推）。
   */
  crashed: boolean;
}

const OFFLINE_STATS: ComfyStatsPayload = {
  online: false,
  vramUsed: 0,
  vramFree: 0,
  vramTotal: 0,
  ramUsed: 0,
  ramTotal: 0,
};

let snapshot: ComfyStatsSnapshot = {
  stats: null,
  online: false,
  stale: false,
  crashed: false,
};

/**
 * 订阅者集合。**每次订阅放一个独立包装对象**，而不是直接把回调塞进 Set：
 * 同一个回调函数订阅两次时，`Set` 只会有一条记录，而订阅计数会加到 2 ——
 * 第一次退订就把这条回调删掉，另一个订阅者从此收不到通知（静默失效）。
 */
interface Subscription {
  onChange: () => void;
}

const subscriptions = new Set<Subscription>();

/** 订阅者计数为 0 时停表；>0 时保证有一条轮询在跑。 */
let subscriberCount = 0;
let stopPolling: (() => void) | null = null;

/* 本通道独占一台计数机（与队列通道各自去抖，互不污染）。用 let 是为了用例能复位
   —— 计数机是有状态的，不复位会让上一条用例攒下的连续失败污染下一条。 */
let observeOnline = createOfflineGate();

/* 进程级判活**不在这里存副本**：判活的来源是每一轮回包自己的 `processAlive`
   （路由经进程快照给出），读它就地的 `next.processAlive` 即可。此前这里挂过一个
   模块级 `let processAlive`，但三个写点之后没有任何读点（唯一的读点是那句
   `processAlive || …` 的左操作数，而它自己被上一行赋成了 true，右边永不可达）——
   写而不读的状态比没有状态更坏：它会在下一次重构里被当成「有语义的标志」保留下来。 */

/** 背压：`useInterval` 不挡重叠，只认最新一次的观测。 */
let requestId = 0;

/* ── 存活侧的状态（与「这一格读数」的状态分开记账）──────────────────────
 *
 * 三者都不是「当前读数」，而是**判活所需的上下文**：
 *   · `crashLatch` —— 连续 3 次失败才判 crash 的计数机（与 `observeOnline`
 *     那台刻意分开：那台判 UI 迟滞，这台判进程死活，共用会互相清零）；
 *   · `startingSince` —— 「进程在跑、HTTP 未就绪」这一档从何时开始，用于
 *     「启动等待 400ms → 10s 后降到 1s」的快慢档切换；
 *   · `verifying` —— 刚收到进程退出事件、正在做那次单次复核：此时阶段是
 *     `verifying`（间隔 0），复核完立刻翻回。
 *
 * `crashed` 只在**判据翻转时**写，并随 `publish` 出去；它是「进程崩了」这件事
 * 的**结论**，不是「最后一拍失败了」——后者由计数机内部的 `fails` 表示。 */
let crashLatch = createCrashLatch();
let startingSince: number | null = null;
let verifying = false;
let crashed = false;

function publish(next: ComfyStatsSnapshot): void {
  /* 快照身份要稳定：`useSyncExternalStore` 按 `Object.is` 判等，每次新建对象会让
     订阅组件无限重渲染。三个字段都没变时直接复用旧快照。 */
  const previous = snapshot;
  if (
    previous.stats === next.stats &&
    previous.online === next.online &&
    previous.stale === next.stale &&
    previous.crashed === next.crashed
  ) {
    return;
  }
  snapshot = next;
  for (const subscription of subscriptions) subscription.onChange();
}

/**
 * 一次「本轮没观测到」：容忍期内保留上一次好数据、只打 stale 标记（不闪「未运行」）；
 * 连续失败达阈值才真正翻离线。
 *
 * 离线回包与**动作抛错**都走这里。抛错不单开日志通道有两个理由：本文件在
 * `src/lib`，那里不许直接 `console.*`（判据「日志实现只有一处」）；而一次抛错
 * 对读数的语义就等同「这一轮没观测到」—— 迟滞本来就为这种事存在。
 * （网络失败本身已在 `fetchComfyStats` 里转成 `online:false`，到不了抛错这条。）
 */
function recordMissedObservation(): void {
  /* 存活判决走自己的计数机（连续 3 次失败）。**注意它在 `observeOnline` 的
     容忍分支之前也要喂** ——否则「读数还愿意按在线渲染」会把「进程可能崩了」
     这件事一起按下去，两条判据绑死成一条。 */
  feedLiveness(false);
  if (observeOnline(false)) {
    publish({
      stats: snapshot.stats,
      online: snapshot.stats?.online === true,
      stale: true,
      crashed,
    });
    return;
  }
  publish({ stats: OFFLINE_STATS, online: false, stale: false, crashed });
}

/** 把判活判决折算进 `crashed`（只在翻转时改，避免每拍都新建快照）。 */
function applyLiveness(verdict: CrashVerdict): void {
  crashed = verdict === "crashed";
}

/** 这一拍的「进程在不在」事实 → 喂计数机。
 *
 * 判据口径与路由侧同源（`/api/comfy/stats` 的降级包）：
 *   · `online:true`（HTTP 通了，含 CUDA OOM 的 500，见 probe.ts）→ 活着；
 *   · `processAlive:true`（进程表/端口判活）→ 活着（HTTP 只是这一拍读不到）；
 *   · 两者皆假 → 这一拍**没观测到**（可能是真崩，也可能是进程表查询失败）。
 *     后者交给连续失败阈值 —— 单次「查不到」不足以判死。
 *
 * **每拍只喂一次**：`recordMissedObservation` 那条路自己会喂 `false`（它也是
 * 轮询动作抛错时的通道，那时 `pollOnce` 根本没跑），所以三个分支各自喂、
 * 不在 `pollOnce` 顶部统一喂 —— 统一喂会让「一次失败」数成两次，阈值 3 实际
 * 变成 1.5。
 */
function feedLiveness(ok: boolean): void {
  applyLiveness(crashLatch(ok));
}

async function pollOnce(): Promise<void> {
  const myRequest = ++requestId;
  const next = await fetchComfyStats();
  if (myRequest !== requestId) return; // 已有更新的请求在跑，丢弃本次迟到回包
  /* 启动等待的起点与终点：进程在跑但 HTTP 未就绪时记下「从何时开始等」，
   * 就绪后清掉（下一轮若又没就绪会重新计）。这决定了 400ms → 1s 的换档。 */
  if (!next.online && next.processAlive === true) {
    startingSince ??= Date.now();
  } else {
    startingSince = null;
  }
  if (next.online) {
    feedLiveness(true);
    observeOnline(true);
    publish({ stats: next, online: true, stale: false, crashed });
    return;
  }
  /* 进程活着、只是这一拍没应答（跑图满载）：这不是「掉线」观测——不计入连续失败
     （反而清零），数据保留旧值并置 stale，在线结论保持。 */
  if (next.processAlive) {
    feedLiveness(true);
    observeOnline(true);
    publish({
      stats: snapshot.stats,
      /* 「在线结论保持」= 直接写 `true`。此前这里是 `processAlive || …`，而上一行
         刚把那个模块级标志置真，右操作数永远求不到 —— 一个永不可达的分支把这条
         门槛挂在死式上（v8 实测这一支分支覆盖 95.23%，空缺就是它）。 */
      online: true,
      stale: snapshot.stats !== null,
      crashed,
    });
    return;
  }
  recordMissedObservation();
}

/**
 * 事件驱动的那一次复核（ISSUE #1351 的主力）。
 *
 * 收到「服务端子进程退出」的信号后立刻探一次 —— **不等下一拍**。这就是
 * 「崩溃 detection 延迟从最多 2s 变成几十毫秒」的落点：信号本身是毫秒级的
 * （`child.on("exit")`），复核只付一次 HTTP 往返。
 *
 * 「收到信号就当场切状态」是错的：信号只说**那个子进程**退了，而这一拍 HTTP
 * 仍可能通（端口被另一个实例接管、或退出的是被顶掉的那个）。所以先复核、
 * 再让连续失败阈值说话 —— 复核通过就说明还活着，计数机也会顺势清零。
 */
function verifyOnce(): void {
  verifying = true;
  /* 复核期间按 `verifying` 档给频率（间隔 0）：即便这次复核发起的请求被打断，
   * 下一拍也会立刻再发，而不是退回 15s 的空闲档。 */
  fireAndForget(
    pollOnce().finally(() => {
      verifying = false;
      /* 复核结束即重新装表：让「下一拍等多久」按**复核之后**的阶段来决定
       * （崩了就是空闲档的保险探测，活着就回到收信号前的档位）。 */
      reschedule();
    }),
    recordMissedObservation,
  );
}

/** 此刻的阶段（存活判据侧）。 */
function currentPhase(): ReturnType<typeof classifyLivenessPhase> {
  return classifyLivenessPhase({
    up: snapshot.online,
    starting: startingSince !== null,
    busy: getComfyBusy(),
    hidden:
      typeof document !== "undefined" && document.visibilityState !== "visible",
    verifying,
  });
}

/** 下一拍等多久（毫秒）。`~/lib/comfyui/liveness` 是这张表的唯一出处。 */
function nextIntervalMs(): number {
  const phase = currentPhase();
  if (phase === "idle" && snapshot.stats === null) {
    /* 从未量到过数据（页面刚打开 / 冷启动）：用**空闲档**而不是 15s——第一格
     * 读数不该让用户等 15 秒才出现（「连接中」的观感比「离线」还坏）。 */
    return COMFY_STATS_POLL_MS;
  }
  return livenessIntervalMs(
    phase,
    startingSince === null ? 0 : Date.now() - startingSince,
  );
}

function ensurePolling(): void {
  if (stopPolling !== null) return;
  stopPolling = startPollTimer(() => pollOnce(), {
    /* 函数形态：每拍跑完重新问一次「下一拍等多久」——档位在运行中会变
     * （用户点了生成 / 切走了窗口 / 刚收到崩溃信号），一个定死的数字表达不了。 */
    ms: nextIntervalMs,
    onError: recordMissedObservation,
  });
  ensureCrashSubscription();
}

/** 重新装表（换档）：先把旧表停掉，下一条订阅或 `verifyOnce` 的收尾会拉起新的。
 *
 *  只停不启是有意的：`startPollTimer` 在函数形态下**不会**因为间隔变化而自己
 *  重排（它只在每拍之后问一次），所以换档要靠重建。重建的一次「立刻先跑」不是
 *  白跑 —— 换档的两种触发（收到崩溃信号、复核结束）本来就是「该马上看一次」
 *  的时刻。 */
function reschedule(): void {
  if (stopPolling === null) return;
  stopPolling();
  stopPolling = null;
  ensurePolling();
}

/** 进程退出事件 → 立刻复核。**这是「事件为主」的主力的接线处**。 */
let stopCrashSubscription: (() => void) | null = null;
function ensureCrashSubscription(): void {
  if (stopCrashSubscription !== null) return;
  stopCrashSubscription = subscribeComfyCrashes(() => verifyOnce());
}

/**
 * 订阅系统指标读数；返回退订函数。**这是本文件唯一的启动入口** —— 没有订阅者时
 * 不存在轮询（不会有「没人看还在打服务端」的白拉）。
 */
export function subscribeComfyStats(onChange: () => void): () => void {
  const subscription: Subscription = { onChange };
  subscriptions.add(subscription);
  subscriberCount += 1;
  ensurePolling();
  return () => {
    subscriptions.delete(subscription);
    subscriberCount -= 1;
    if (subscriberCount === 0 && stopPolling !== null) {
      stopPolling();
      stopPolling = null;
      /* 没人看了就连 SSE 一起断：留一条常连的 push 通道在后台空转，等于
       * 「没人看还在打服务端」的白拉又换了个形态。 */
      stopCrashSubscription?.();
      stopCrashSubscription = null;
    }
  };
}

/** 当前快照（身份稳定，可直接给 `useSyncExternalStore`）。 */
export function getComfyStatsSnapshot(): ComfyStatsSnapshot {
  return snapshot;
}

/** 服务端快照：与首帧「还没量过」一致，按「无数据」渲染，不制造第三种状态。 */
export function getComfyStatsServerSnapshot(): ComfyStatsSnapshot {
  return snapshot;
}

/** 主动补一次（如页面回前台、用户点刷新）。 */
export function refreshComfyStats(): Promise<void> {
  return pollOnce();
}

/** 只给用例：把模块级状态复位（含那两台有状态的计数机），避免用例之间互相污染。 */
export function resetComfyStatsStoreForTest(): void {
  subscriptions.clear();
  subscriberCount = 0;
  stopPolling?.();
  stopPolling = null;
  stopCrashSubscription?.();
  stopCrashSubscription = null;
  requestId = 0;
  observeOnline = createOfflineGate();
  crashLatch = createCrashLatch();
  startingSince = null;
  verifying = false;
  crashed = false;
  snapshot = { stats: null, online: false, stale: false, crashed: false };
}

/** 此刻的阶段与下一拍间隔（只给用例：把「按阶段给频率」这张表钉在用例里）。
 *
 *  导出成函数而不是常量：阶段是**运行中**变的，常量只能表达「创建时那一档」，
 *  而那正是本次要修掉的东西。 */
export function getComfyLivenessForTest(): {
  phase: ReturnType<typeof classifyLivenessPhase>;
  intervalMs: number;
  crashed: boolean;
} {
  return { phase: currentPhase(), intervalMs: nextIntervalMs(), crashed };
}
