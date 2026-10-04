import { useSyncExternalStore } from "react";

import {
  NAV_AUTO_COLLAPSE_MAX_PX,
  NAV_AUTO_COLLAPSE_QUERY,
} from "~/lib/layout-budget";

/** 窄窗判据 + 「跨越过阈值的次数」。 */
export type NarrowNavState = { narrow: boolean; crossings: number };

/* 已建立的订阅者。通知不发给自己，而是发给这张表 —— 于是「补一次通知」不再
   绑在某一次订阅的生命周期上（见下方 `scheduleInitialSync` 的说明）。 */
const listeners = new Set<() => void>();

/* 首帧对账的定时器句柄。模块级、**不受任何一次订阅的退订影响**。 */
let initialSyncTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 安排「进页面后补一次通知」—— 这是首帧对账的唯一触发者。
 *
 * 为什么需要它：`useSyncExternalStore` 的首帧读的是 `getServerSnapshot`（服务端
 * 按非窄窗渲染的那一份）。此后只有 store 通知才会让它重读快照，而「进页面时窗口
 * 就已经是窄窗」这种情况媒体查询**不会再 change** —— 不主动通知一次，`data-state`
 * 就停在服务端那份「展开」上。
 *
 * ⚠️ 两个都不能省的前提：
 *
 * 1. **定时器不能挂在订阅的清理函数上**。React 开发态会把 effect 跑两遍
 *    （挂载 → 卸载 → 再挂载），清理函数里的 `clearTimeout` 会把刚排的通知取消。
 *    实测（`innerWidth=1100` 首屏）：`setTimeout(0)` 排 5 次、被 `clearTimeout` 取消
 *    **2** 次，其中第二次正是 store 自己排的通知 —— 于是它**一次都没跑到**，
 *    `data-state` 只能等某个无关的重渲染（实测是 `model.configList` 的 tRPC 响应）
 *    顺带读一次快照才纠正。并发跑 E2E 时那次重渲染可以晚到 5s 之后
 *    ⇒ `nav-auto-collapse` 两条在默认并发下必红。提到模块级后，任何退订都不撤销它。
 *
 * 2. **回调里通知不到人就重新排**。双挂载期间那一刻 `listeners` 可能是空的：通知
 *    发给空气等于没发，而「排过了」的标记若照旧置真就再也不会补 —— 于是又回到
 *    「靠顺带的重渲染」。所以只有**真的通知到了订阅者**才算完，否则重排一次
 *    （`initialSyncTimer` 在此兼作「已排/未排」标记）。
 *
 * 为什么要等一个宏任务：微任务排在 React 提交完成之前，那次通知会被吞掉
 * （实测：首屏窄窗仍不收起，而 resize 之后能收起）。宏任务（下一个任务）才落在
 * 提交之后。
 */
function scheduleInitialSync(): void {
  if (initialSyncTimer !== null) return;
  initialSyncTimer = setTimeout(() => {
    /* 惰性取值顺手把 `crossings` 推到正确档位，再通知订阅者重读。 */
    getSnapshot();
    const delivered = listeners.size > 0;
    /* 先清句柄再决定是否重排：重排走的是同一个入口。 */
    initialSyncTimer = null;
    for (const listener of listeners) listener();
    if (!delivered) scheduleInitialSync();
  }, 0);
}

/** 订阅媒体查询变化 + 登记进 `listeners`（补一次通知走模块级调度）。 */
function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(NAV_AUTO_COLLAPSE_QUERY);
  /* 回调只负责通知；跨越次数在取值时推进（见 `getSnapshot`）—— 放在这里会漏掉
     「订阅建立之前发生的窗宽变化」，那条跨越就不该算。 */
  const handler = (): void => onChange();
  mql.addEventListener("change", handler);
  listeners.add(onChange);
  scheduleInitialSync();
  return () => {
    listeners.delete(onChange);
    mql.removeEventListener("change", handler);
  };
}

/* 判据用 `innerWidth` 而不是 `mql.matches`：两者同源，但前者与 `NAV_AUTO_COLLAPSE_MAX_PX`
   是同一个数，只有一处要维护。 */
function isNarrowNow(): boolean {
  return typeof window !== "undefined"
    ? window.innerWidth <= NAV_AUTO_COLLAPSE_MAX_PX
    : false;
}

let snapshot: NarrowNavState = { narrow: isNarrowNow(), crossings: 0 };

/* 取值时惰性推进：窗宽档真的变了才 +1 并**换快照身份**（`useSyncExternalStore`
   按身份判等，身份不变就不会重复渲染）。provider 拿这个次数判断「这条表态是不是
   跨越之前留下的」，因此不需要任何 effect 去清标记。 */
function getSnapshot(): NarrowNavState {
  const narrow = isNarrowNow();
  if (narrow !== snapshot.narrow) {
    snapshot = { narrow, crossings: snapshot.crossings + 1 };
  }
  return snapshot;
}

/* 首屏按「非窄窗」渲染（桌面壳与浏览器桌面尺寸一致），不把「还没量过」当成
   第三种状态往外传 —— 与 `useIsMobile` 同一口径。
   ⚠️ 必须是**同一个对象**：每次新建会让 hydration 后的快照比较失去意义，
   窄窗首屏就停在服务端那份「展开」上（实测 innerWidth 1100 且查询命中，
   `data-state` 仍是 expanded）。身份稳定，值变了才认。 */
const SERVER_SNAPSHOT: NarrowNavState = { narrow: false, crossings: 0 };

function getServerSnapshot(): NarrowNavState {
  return SERVER_SNAPSHOT;
}

/**
 * 「窗口窄到装不下展开态这一笔账」+ 跨越阈值的次数。
 *
 * 与 `useIsMobile()`（768px 那条）**不是一条线**：那条切形态（固定栏 ↔ 浮层），
 * 这条切宽度让位纪律（展开 ↔ 图标），窄窗里两条同时成立。阈值与算式的唯一出处在
 * `~/lib/layout-budget`。
 *
 * 为什么要带 `crossings`：用户「在窄窗里点开展开」是一次表态，但窗口放大再缩回来
 * 已经跨越过阈值两次 —— 那次表态不该继续否决纪律。用「表态时的跨越次数」比对现在
 * 的次数就能纯推导地判过期，不用 effect、也不用 ref。
 */
export function useNarrowNavState(): NarrowNavState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
