import { useSyncExternalStore } from "react";

import { NAV_AUTO_COLLAPSE_MAX_PX, NAV_AUTO_COLLAPSE_QUERY } from "~/lib/layout-budget";

/** 窄窗判据 + 「跨越过阈值的次数」。 */
export type NarrowNavState = { crossings: number; narrow: boolean };

/* 已建立的订阅者。通知不发给自己，而是发给这张表 —— 于是「补一次通知」不再
   绑在某一次订阅的生命周期上（见下方 `scheduleInitialSync` 的说明）。 */
const listeners = new Set<() => void>();

/* 首帧对账的定时器句柄。模块级、**不受任何一次订阅的退订影响**。 */
let initialSyncTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 安排「进页面后补一次通知」—— 首帧对账的唯一触发者。
 * `useSyncExternalStore` 首帧读 `getServerSnapshot`（服务端按非窄窗渲染）；「进页面时已是窄窗」媒体查询不会再 change，不主动通知 `data-state` 就停在「展开」。
 * 两个前提不能省：① 定时器不能挂在订阅清理函数上（开发态双挂载的 clearTimeout 会取消刚排的通知，实测被取消 2 次、其中一次正是 store 自己排的 ⇒ nav-auto-collapse 并发必红）；② 回调里通知不到人就重新排（双挂载期间 listeners 可能为空，`initialSyncTimer` 兼作已排标记）。用宏任务而非微任务：微任务排在 React 提交前会被吞掉。
 */
function scheduleInitialSync(): void {
  if (initialSyncTimer !== null) {
    return;
  }
  initialSyncTimer = setTimeout(() => {
    /* 惰性取值顺手把 `crossings` 推到正确档位，再通知订阅者重读。 */
    getSnapshot();
    const delivered = listeners.size > 0;
    /* 先清句柄再决定是否重排：重排走的是同一个入口。 */
    initialSyncTimer = null;
    for (const listener of listeners) {
      listener();
    }
    if (!delivered) {
      scheduleInitialSync();
    }
  }, 0);
}

/** 订阅媒体查询变化 + 登记进 `listeners`（补一次通知走模块级调度）。 */
function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(NAV_AUTO_COLLAPSE_QUERY);
  /* 回调只负责通知；跨越次数在取值时推进（见 `getSnapshot`）—— 放在这里会漏掉
     「订阅建立之前发生的窗宽变化」，那条跨越就不该算。 */
  const handler = (): void => {
    onChange();
  };
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
  return typeof window === "undefined" ? false : window.innerWidth <= NAV_AUTO_COLLAPSE_MAX_PX;
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
 * 「窗口窄到装不下展开态」+ 跨越阈值的次数。
 * 与 `useIsMobile()`（768px）不是一条线：那条切形态，这条切宽度让位纪律；阈值与算式唯一出处在 `~/lib/layout-budget`。
 * 带 `crossings`：用户「在窄窗里点开展开」是一次表态，跨越两次阈值后该过期；用「表态时的跨越次数」比对现在即可纯推导判过期，不用 effect / ref。
 */
export function useNarrowNavState(): NarrowNavState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
