import { useSyncExternalStore } from "react";

/* 窄窗判据的断点：小于 768px（与官方一致）。 */
const MOBILE_BREAKPOINT = 768;
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

/* 订阅媒体查询变化。只在客户端被调用 —— 这是 `useSyncExternalStore` 的约定，
 * 服务端渲染走下面的 `getServerSnapshot`。 */
function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/* 快照取「当前是否窄窗」。判据用 `innerWidth` 而不是 `mql.matches`：两者同源，
 * 但前者与 `MOBILE_BREAKPOINT` 是同一个数，只有一处要维护。返回布尔 —— 值稳定，
 * 不会让 `useSyncExternalStore` 反复重渲染。 */
function isMobileNow(): boolean {
  return typeof window !== "undefined"
    ? window.innerWidth < MOBILE_BREAKPOINT
    : false;
}

/**
 * 当前是否为「窄窗（移动形态）」—— `sidebar.tsx` 据此在浮层与固定栏之间选形态。
 *
 * 与官方的两处差别（都是本仓库判据逼出来的）：
 *
 * 1. 官方是 `useState<boolean | undefined>(undefined)` + 在 `useEffect` 体内
 *    **同步** `setIsMobile(...)`，而 `react-hooks/set-state-in-effect` 判它
 *    「在 effect 里直接 setState」（级联渲染）；且首帧 `undefined` 会逼每个调用处
 *    写 `!!isMobile`。改用 `useSyncExternalStore` 后首帧就有确定值，与
 *    `useWidePanel` / `useCanvasSettings` 同一套机制。
 * 2. 服务端快照显式给 `false`（桌面壳与浏览器桌面尺寸一致，首屏按非窄窗渲染），
 *    不把「还没测出来」当成第三种状态往外传。
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, isMobileNow, () => false);
}
