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

import { createOfflineGate } from "~/lib/offline-gate";
import { startPollTimer } from "~/lib/poll-timer";

import { fetchComfyStats, type ComfyStatsPayload } from "./comfy-stats-client";

/** 轮询节奏：显存占用在跑图时每秒级变化，4s 足够反映趋势又不刷屏。 */
export const COMFY_STATS_POLL_MS = 4000;

/** 一份对外读数：视图层只读这三个字段，不自己发请求（规范 17 §17.2 第②层）。 */
export interface ComfyStatsSnapshot {
  /** 最近一次读到的指标；尚未返回时为 null。 */
  stats: ComfyStatsPayload | null;
  /** ComfyUI 是否在线：读到过好数据，或最近一次观测确认进程还活着（数据可能暂时读不到）。 */
  online: boolean;
  /** 处于迟滞容忍期内、显示的是上一次好数据（不闪离线，但需弱化提示）。 */
  stale: boolean;
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

function publish(next: ComfyStatsSnapshot): void {
  /* 快照身份要稳定：`useSyncExternalStore` 按 `Object.is` 判等，每次新建对象会让
     订阅组件无限重渲染。三个字段都没变时直接复用旧快照。 */
  const previous = snapshot;
  if (
    previous.stats === next.stats &&
    previous.online === next.online &&
    previous.stale === next.stale
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
  if (observeOnline(false)) {
    publish({
      stats: snapshot.stats,
      online: snapshot.stats?.online === true,
      stale: true,
    });
    return;
  }
  publish({ stats: OFFLINE_STATS, online: false, stale: false });
}

async function pollOnce(): Promise<void> {
  const myRequest = ++requestId;
  const next = await fetchComfyStats();
  if (myRequest !== requestId) return; // 已有更新的请求在跑，丢弃本次迟到回包
  if (next.online) {
    observeOnline(true);
    publish({ stats: next, online: true, stale: false });
    return;
  }
  /* 进程活着、只是这一拍没应答（跑图满载）：这不是「掉线」观测——不计入连续失败
     （反而清零），数据保留旧值并置 stale，在线结论保持。 */
  if (next.processAlive) {
    observeOnline(true);
    publish({
      stats: snapshot.stats,
      /* 「在线结论保持」= 直接写 `true`。此前这里是 `processAlive || …`，而上一行
         刚把那个模块级标志置真，右操作数永远求不到 —— 一个永不可达的分支把这条
         门槛挂在死式上（v8 实测这一支分支覆盖 95.23%，空缺就是它）。 */
      online: true,
      stale: snapshot.stats !== null,
    });
    return;
  }
  recordMissedObservation();
}

function ensurePolling(): void {
  if (stopPolling !== null) return;
  stopPolling = startPollTimer(() => pollOnce(), {
    ms: COMFY_STATS_POLL_MS,
    onError: recordMissedObservation,
  });
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

/** 只给用例：把模块级状态复位（含那台有状态的迟滞计数机），避免用例之间互相污染。 */
export function resetComfyStatsStoreForTest(): void {
  subscriptions.clear();
  subscriberCount = 0;
  stopPolling?.();
  stopPolling = null;
  requestId = 0;
  observeOnline = createOfflineGate();
  snapshot = { stats: null, online: false, stale: false };
}
