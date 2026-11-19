import { useSyncExternalStore } from "react";

/* 窄窗判据的断点：小于 768px（与官方一致）。 */
const MOBILE_BREAKPOINT = 768;
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

/* 订阅媒体查询变化。只在客户端被调用 —— 这是 `useSyncExternalStore` 的约定，
 * 服务端渲染走下面的 `getServerSnapshot`。 */
function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener("change", onChange);
  return () => {
    mql.removeEventListener("change", onChange);
  };
}

/* 快照取「当前是否窄窗」。判据用 `innerWidth` 而不是 `mql.matches`：两者同源，
 * 但前者与 `MOBILE_BREAKPOINT` 是同一个数，只有一处要维护。返回布尔 —— 值稳定，
 * 不会让 `useSyncExternalStore` 反复重渲染。 */
function isMobileNow(): boolean {
  return typeof window === "undefined" ? false : window.innerWidth < MOBILE_BREAKPOINT;
}

/** 当前是否为「窄窗（移动形态）」—— `sidebar.tsx` 据此在浮层与固定栏之间选形态。与官方两处差别：① 官方
 * `useState<boolean | undefined>` + 在 effect 体内同步 `setIsMobile`，会被 `react-hooks/set-state-in-effect` 判为级联渲染，
 * 首帧 `undefined` 还逼每个调用处写 `!!`；改用 `useSyncExternalStore` 后首帧就有确定值。② 服务端快照显式给 `false`，
 * 不把「还没测出来」当第三态外传。 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, isMobileNow, () => false);
}
