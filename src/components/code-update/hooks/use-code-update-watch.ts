"use client";

/* ── 「页面跑着上一版代码 / 服务重启过」的观测器（规范 17 §17.2 第②层逻辑）──
 * 唯一职责：轮询构建标识（网络收敛在 ~/lib/shell/code-update-since-load），把
 * 三类事实分别交给对应出口：
 *   ① 源码 mtime 变（buildId 变、bootId 不变）→ reportCodeUpdatedSinceLoad（陈旧实例线索）；
 *   ② 进程真的重启（bootId 变）→ onDevServerRestart（重启通知），并一并记 ①；
 *   ③ 首次探测就带 restartReason → 这个进程是启动器自愈重启起来的（重启发生在
 *      页面加载之前），补一条留底通知，让用户进应用后知道刚发生了什么。
 *
 * 为什么要持续轮询而不是只听 HMR 事件：本项目跑在 Tauri 壳里（生产形态是
 * 编译期内嵌的独立产物），HMR 客户端不一定在场；而「源码在别处被改、当前
 * 窗口仍然长开」恰恰是这个应用最常见的用法。轮询构建标识对这两种形态一视
 * 同仁，且失败即静默（取不到标识就当无法判定，绝不打扰）。
 *
 * 重启通知跨刷新去重：同一个 bootId（同一次重启）只提示一次，避免用户每按一次
 * Ctrl+R 就又被弹一遍。去重记在 localStorage（按 bootId），与消息中心「留底」
 * 语义一致——留一次即可，不需要每次加载都重申。
 */

import { useCallback, useEffect, useRef } from "react";

import { useInterval } from "~/components/ui/use-interval";
import { readStorageItem, writeStorageItem } from "~/lib/browser-storage";

import {
  fetchBuildId,
  isBootIdChange,
  isBuildIdChange,
  isPageOlderThanBuild,
} from "~/lib/shell/code-update-since-load";
import { reportCodeUpdatedSinceLoad } from "~/lib/shell/stale-store-notify";

/** 构建标识轮询间隔：源码改动的粒度是「人敲一次键盘」，30s 足够及时。 */
export const BUILD_ID_POLL_MS = 30_000;

/** 记录「最近一次已就哪个 bootId 提示过重启」的 localStorage 键（跨刷新去重）。 */
export const DEV_RESTART_NOTIFIED_KEY = "comfyapp:dev-restart-notified-bootid";

export interface UseCodeUpdateWatchArgs {
  /** 观测到 dev server 重启时回调（reason = 启动器注入的重启原因，可能为 null）。 */
  onDevServerRestart?: (reason: string | null) => void;
}

export function useCodeUpdateWatch({
  onDevServerRestart,
}: UseCodeUpdateWatchArgs = {}): void {
  /* 页面加载时的构建标识（首探所得）、最近一次已知标识、最近一次已知 bootId，
   * 都用 ref：它们只参与判定，不驱动渲染。 */
  const stoppedRef = useRef(false);
  const loadedAtRef = useRef<string | null>(null);
  const lastRef = useRef<string | null>(null);
  const lastBootIdRef = useRef<string | null>(null);
  /* 回调放 ref：轮询闭包只建一次，消费方传新回调不该重建 interval。
   * 同步放 effect 里（渲染期写 ref 会被 React 编译器 lint 拦下）。 */
  const onRestartRef = useRef(onDevServerRestart);
  useEffect(() => {
    onRestartRef.current = onDevServerRestart;
  }, [onDevServerRestart]);

  /* 卸载守卫仍在：`useInterval` 会在卸载时清掉间隔，但**已经发出的那次
   * `fetchBuildId` 仍可能回来**并触发上报 —— 那是全局通知，不该由一个已消失
   * 的 watcher 触发（规范 16 §16.2.4.15）。 */
  useEffect(() => {
    stoppedRef.current = false;
    return () => {
      stoppedRef.current = true;
    };
  }, []);

  /** 就某次重启（按 bootId 去重）通知一次。 */
  const notifyRestart = useCallback((bootId: string, reason: string | null) => {
    if (readStorageItem(DEV_RESTART_NOTIFIED_KEY) === bootId) return;
    writeStorageItem(DEV_RESTART_NOTIFIED_KEY, bootId);
    onRestartRef.current?.(reason);
  }, []);

  const probe = useCallback(async () => {
    const { buildId, bootId, restartReason } = await fetchBuildId();
    if (stoppedRef.current || buildId === null) return;

    /* 首次探测：既建立对比基准，也是「页面加载时那一版」的记录。 */
    if (loadedAtRef.current === null) {
      loadedAtRef.current = buildId;
      lastRef.current = buildId;
      lastBootIdRef.current = bootId;
      /* ③ 一上来就带重启原因 = 这个进程是启动器自愈重启起来的（重启发生在页面
       *    加载之前，bootId 变化在页面这边看不到），补一条留底通知。 */
      if (bootId && restartReason) notifyRestart(bootId, restartReason);
      return;
    }

    /* ② 进程真的重启（bootId 变）：单独提示，并与「仅源码 mtime 变」区分；
     *    重启也意味着运行图整体换了，一并记为「跑过代码更新」。 */
    if (isBootIdChange(lastBootIdRef.current, bootId)) {
      lastBootIdRef.current = bootId;
      if (bootId) notifyRestart(bootId, restartReason);
      reportCodeUpdatedSinceLoad();
      return;
    }

    /* ① 加载后模块被替换（热更新 / 重新编译，bootId 未变）。 */
    if (isBuildIdChange(lastRef.current, buildId)) {
      lastRef.current = buildId;
      reportCodeUpdatedSinceLoad();
      return;
    }

    /* 每次探测都复核「页面是不是本来就更旧」：加载时的标识与此刻不一致，
     * 说明这个页面从挂载起就跑在过期的模块图上。只在真的不一致时上报。 */
    if (isPageOlderThanBuild(loadedAtRef.current, buildId)) {
      reportCodeUpdatedSinceLoad();
    }
  }, [notifyRestart]);

  useInterval(probe, { ms: BUILD_ID_POLL_MS, pauseWhenHidden: false });
}
