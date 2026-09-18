"use client";

/* ── 「页面跑着上一版代码」的观测器（规范 17 §17.2 第②层逻辑）──────────
 * 唯一职责：轮询构建标识（网络收敛在 ~/lib/code-update-since-load），把
 * 「页面加载时就已经落后」与「加载后模块被替换」两种事实交给
 * ~/lib/stale-store-notify。判据本身是纯函数，本文件只做「取事实 → 调判据」，
 * 便于 renderHook 断言。
 *
 * 为什么要持续轮询而不是只听 HMR 事件：本项目跑在 Tauri 壳里（生产形态是
 * 编译期内嵌的独立产物），HMR 客户端不一定在场；而「源码在别处被改、当前
 * 窗口仍然长开」恰恰是这个应用最常见的用法。轮询构建标识对这两种形态一视
 * 同仁，且失败即静默（取不到标识就当无法判定，绝不打扰）。
 */

import { useEffect, useRef } from "react";

import {
  fetchBuildId,
  isBuildIdChange,
  isPageOlderThanBuild,
} from "~/lib/shell/code-update-since-load";
import { reportCodeUpdatedSinceLoad } from "~/lib/shell/stale-store-notify";

/** 构建标识轮询间隔：源码改动的粒度是「人敲一次键盘」，30s 足够及时。 */
export const BUILD_ID_POLL_MS = 30_000;

export function useCodeUpdateWatch(): void {
  /* 页面加载时的构建标识（首探所得）与最近一次已知标识，都用 ref：
   * 它们只参与判定，不驱动渲染。 */
  const loadedAtRef = useRef<string | null>(null);
  const lastRef = useRef<string | null>(null);

  useEffect(() => {
    let stopped = false;

    const probe = async () => {
      const { buildId } = await fetchBuildId();
      if (stopped || buildId === null) return;

      /* 首次探测：它既建立对比基准，也是「页面加载时那一版」的记录。 */
      if (loadedAtRef.current === null) {
        loadedAtRef.current = buildId;
        lastRef.current = buildId;
        return;
      }

      /* ① 加载后模块被替换（热更新 / 重新编译）。 */
      if (isBuildIdChange(lastRef.current, buildId)) {
        lastRef.current = buildId;
        reportCodeUpdatedSinceLoad();
        return;
      }

      /* ② 每次探测都复核「页面是不是本来就更旧」：页面加载时的标识与此刻
       *    不一致，说明这个页面从挂载起就跑在过期的模块图上（服务重启过、
       *    或加载时命中旧 chunk）。这一条只在**真的不一致**时上报，正常
       *    情况下每次比较都相等。 */
      if (isPageOlderThanBuild(loadedAtRef.current, buildId)) {
        reportCodeUpdatedSinceLoad();
      }
    };

    void probe();
    const timer = setInterval(() => void probe(), BUILD_ID_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
}
