"use client";

/* ── 「页面跑着上一版代码 / 服务重启过」的观测器（规范 17 §17.2 第②层逻辑）──
 * 唯一职责：轮询构建标识（网络收敛在 ~/lib/shell/code-update-since-load），把
 * 三类事实分别交给对应出口：
 *   ① 源码 mtime 变（buildId 变、bootId 不变）→ reportCodeUpdatedSinceLoad（陈旧实例线索）；
 *   ② 进程真的重启（bootId 变）→ reportCodeUpdatedSinceLoad，并**仅当启动器自愈**
 *      （带 restartReason）时另发一条 onDevServerRestart；
 *   ③ 首次探测就带 restartReason → 这个进程是启动器自愈重启起来的（重启发生在
 *      页面加载之前），补一条留底通知，让用户进应用后知道刚发生了什么。
 *   ④ 依赖面陈旧（`depsStale`，与构建标识无关、首探就判）→ `onDepsStale()`：
 *      这条要的是一个应用内做不到的动作（停服务 + `pnpm install`），只能提示。
 *
 * 「服务重启过」这件事的**常驻记录**不在这里，而在消息中心
 * （`use-app-service-message-log`）：它记的是「断开 → 恢复」这一对带时刻与原因
 * 的事件，探测 2 秒一拍，比这里 30 秒更及时；这里只保留「启动器自愈原因」这一件
 * 本模块独占的事实——两处分工见 ② 处的注释。
 *
 * 为什么要持续轮询而不是只听 HMR 事件：本项目跑在 Tauri 壳里（生产形态是
 * 编译期内嵌的独立产物），HMR 客户端不一定在场；而「源码在别处被改、当前
 * 窗口仍然长开」恰恰是这个应用最常见的用法。轮询构建标识对这两种形态一视
 * 同仁，且失败即静默（取不到标识就当无法判定，绝不打扰）。
 *
 * 自愈重启的通知跨刷新去重：同一个 bootId（同一次重启）只提示一次，避免用户每按
 * 一次 Ctrl+R 就又被弹一遍。去重记在 localStorage（按 bootId），与消息中心「留底」
 * 语义一致——留一次即可，不需要每次加载都重申。
 */

import { useCallback, useEffect, useRef } from "react";

import { useInterval } from "~/components/ui/use-interval";
import { readStorageItem, removeStorageItem, writeStorageItem } from "~/lib/browser-storage";

import {
  fetchBuildId,
  isBootIdChange,
  isBuildIdChange,
  isPageOlderThanBuild,
  type DepsFreshnessState,
} from "~/lib/shell/code-update-since-load";
import { reportCodeUpdatedSinceLoad } from "~/lib/shell/stale-store-notify";

/** 构建标识轮询间隔：源码改动的粒度是「人敲一次键盘」，30s 足够及时。 */
export const BUILD_ID_POLL_MS = 30_000;

/** 记录「最近一次已就哪个 bootId 提示过重启」的 localStorage 键（跨刷新去重）。 */
export const DEV_RESTART_NOTIFIED_KEY = "comfyapp:dev-restart-notified-bootid";

/** 记录「最近一次已就哪种依赖面陈旧提示过」的键（跨刷新去重，按 `depsState`）。 */
export const DEPS_STALE_NOTIFIED_KEY = "comfyapp:deps-stale-notified-state";

export type UseCodeUpdateWatchArgs = {
  /** 观测到依赖面陈旧时回调（需要「停服务 + `pnpm install`」这个动作）。
   *
   *  `state` 给出陈旧的具体形态，供文案分流。**同一形态只上报一次**（跨刷新，
   *  见 `DEPS_STALE_NOTIFIED_KEY`）；判定为新鲜时去重记录会被清掉，于是下一次
   *  拉取改动 lockfile 时还能再提示。 */
  onDepsStale?: (state: DepsFreshnessState) => void;
  /** 观测到 dev server 重启时回调。
   *
   *  · `reason` = 启动器注入的重启原因（`route-404-heal` / `stale-route-table`），
   *    不是启动器发起的重启（用户手动 / 崩溃）为 null；
   *  · `detail` = 启动器懒归因产出的人话短句（「本次代码更新改了路由结构…」），
   *    归因失败 / 无归因为 null。 */
  onDevServerRestart?: (reason: string | null, detail: string | null) => void;
};

export function useCodeUpdateWatch({
  onDepsStale,
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
  const onDepsStaleRef = useRef(onDepsStale);
  useEffect(() => {
    onDepsStaleRef.current = onDepsStale;
  }, [onDepsStale]);

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
  const notifyRestart = useCallback(
    (bootId: string, reason: string | null, detail: string | null) => {
      if (readStorageItem(DEV_RESTART_NOTIFIED_KEY) === bootId) {
        return;
      }
      writeStorageItem(DEV_RESTART_NOTIFIED_KEY, bootId);
      onRestartRef.current?.(reason, detail);
    },
    [],
  );

  /** 依赖面陈旧：按 `depsState` 跨刷新去重，判定为新鲜时清掉记录（见 args 的说明）。 */
  const reportDepsStale = useCallback((stale: boolean | null, state: DepsFreshnessState | null) => {
    if (stale === false) {
      removeStorageItem(DEPS_STALE_NOTIFIED_KEY);
      return;
    }
    /* `stale === true` 却拿不到形态（老端点 / 半截响应）时不提示：文案分不了流，
     * 说一句「依赖陈旧」而不指哪一档，用户照着做的动作会不确定。 */
    if (stale !== true || state === null) {
      return;
    }
    if (readStorageItem(DEPS_STALE_NOTIFIED_KEY) === state) {
      return;
    }
    writeStorageItem(DEPS_STALE_NOTIFIED_KEY, state);
    onDepsStaleRef.current?.(state);
  }, []);

  const probe = useCallback(async () => {
    const { bootId, buildId, depsStale, depsState, restartDetail, restartReason } =
      await fetchBuildId();
    if (stoppedRef.current) {
      return;
    }

    /* 依赖面这条与构建标识无关（它不随重启变、也不随源码 mtime 变），且**首探就该
     * 判**（冷启动也会撞上「拉了新代码没重装」）—— 因此放在所有标识分支之前，
     * 不跟着 `buildId === null` 的早退一起被跳过。 */
    reportDepsStale(depsStale, depsState);

    if (buildId === null) {
      return;
    }

    /* 首次探测：既建立对比基准，也是「页面加载时那一版」的记录。 */
    if (loadedAtRef.current === null) {
      loadedAtRef.current = buildId;
      lastRef.current = buildId;
      lastBootIdRef.current = bootId;
      /* ③ 一上来就带重启原因 = 这个进程是启动器自愈重启起来的（重启发生在页面
       *    加载之前，bootId 变化在页面这边看不到），补一条留底通知。 */
      if (bootId && restartReason) {
        notifyRestart(bootId, restartReason, restartDetail);
      }
      return;
    }

    /* ② 进程真的重启（bootId 变）：并入「跑过代码更新」，**并且只在启动器自愈
     *    那一档**再单独提示一次。
     *
     *    为什么不在这里无条件提示「应用服务已重启」：页面长开时任何一次重启都
     *    必然先被探活看到「断开 → 恢复」，而那条记录由消息中心统一写（见
     *    `~/components/message-center/hooks/use-app-service-message-log`），
     *    带得上断开时间、恢复时间与上一次结束的原因。两边都发就是同一次重启
     *    两条消息，且这条没有时间也没有原因。
     *
     *    仍然要发的是**启动器自愈**那一种：`restartReason`（如路由表与源码不
     *    一致）只有构建标识这条链路拿得到，而它在探测边沿之外——重启时探活可能
     *    根本没失败过（进程换得比一拍还快）。 */
    if (isBootIdChange(lastBootIdRef.current, bootId)) {
      lastBootIdRef.current = bootId;
      if (bootId && restartReason) {
        notifyRestart(bootId, restartReason, restartDetail);
      }
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
  }, [notifyRestart, reportDepsStale]);

  useInterval(probe, { ms: BUILD_ID_POLL_MS, pauseWhenHidden: false });
}
