import { useSyncExternalStore } from "react";

import {
  NAV_AUTO_COLLAPSE_MAX_PX,
  NAV_AUTO_COLLAPSE_QUERY,
} from "~/lib/layout-budget";

/** 窄窗判据 + 「跨越过阈值的次数」。 */
export type NarrowNavState = { narrow: boolean; crossings: number };

/* 订阅媒体查询变化。只在客户端被调用 —— 服务端渲染走下面的 `getServerSnapshot`。 */
function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(NAV_AUTO_COLLAPSE_QUERY);
  /* 回调只负责通知；跨越次数在取值时推进（见 `getSnapshot`）—— 放在这里会漏掉
     「订阅建立之前发生的窗宽变化」，那条跨越就不该算。 */
  const handler = (): void => onChange();
  mql.addEventListener("change", handler);
  /* ⚠️ 订阅建立后补一次通知：React 的 hydration 首帧读的是 `getServerSnapshot`，
     之后只有 store 通知才会让它重读快照。而「进页面时窗口就已经是窄窗」这种情况
     媒体查询不会再 change —— 于是 `data-state` 永远停在服务端那份「展开」上。
     实测过时机差别：**微任务不行**（排在 React 提交完成之前，那次通知被吞掉，
     首屏窄窗仍不收起，而 resize 之后能收起）；宏任务（下一个任务）才落在提交之后。
     `subscribe` 是模块级稳定身份，不会因此形成重订阅循环。 */
  const sync = setTimeout(onChange, 0);
  return () => {
    clearTimeout(sync);
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
