"use client";

/* ── 把「应用服务断开 / 启动 / 路由异常」写进消息中心（规范 17 §17.2 第②层）──
 *
 * 唯一职责：把 `useDevServerStatus()` 给的四态与进程标识，翻成消息中心里的
 * 「断开」「启动 / 恢复」与「路由异常」三条记录（**时间 + 原因 + 该做什么**）。
 *
 * ## 为什么需要它（此前这里什么出口都没有）
 *
 * 状态栏那一格翻成「应用服务已断开」之后，用户能看到的只有四个字：什么时候断的
 * （要靠猜）、因为什么断的（问不到）、恢复了没有（要看颜色变回去）。曾经
 * `CodeUpdateWatcher` 记过一条「应用服务已重启」，但那**只是重启**、没有断开、
 * 也没有时间与原因，而且它由 30 秒一拍的构建标识轮询驱动——服务断开期间那一路
 * 直接取不到任何标识（见 `code-update-since-load` 的 catch 分支），于是故障窗口
 * 里它一声不吭。这条链路是唯一的常驻记录口。
 *
 * ## 为什么事实由外部递进来
 *
 * 探活循环全应用只有一条（`useDevServerLiveness` 在 `useDevServerStatus` 里，
 * 而后者只有底部状态栏一个消费方）。本 hook **不自己起第二条循环**，而是接状态栏
 * 已经在算的那份事实（`state` / `bootId`）——否则同一个 `/api/dev/server-id`
 * 会每两秒被打两次，探活一旦变慢，两边一起变慢。
 *
 * ## 原因为什么在这里现读，而不是等上游送到
 *
 * 成因由启动编排在进程结束那一刻写进 `run/app-service-exit.json`，读它要问**已经
 * 起来的那个新进程**（`GET /api/dev/last-exit`）。这条读取正好发生在「边沿已判定、
 * 消息还没写」的当口，于是由本 hook 在 push 之前现取一次：判据（纯，见
 * `~/lib/shell/app-service-message`）与取数（IO）各自待在该待的层，两边不互相
 * 依赖，也就不存在「等上游把原因递下来，而上游也在等」的环。
 *
 * 取不到就按「没有原因可讲」发（文案里说明为什么读不到）——**不编一个原因**，
 * 也不因为取不到就把这条消息整个吞掉：时间本身已经是事实。
 *
 * ## 每条消息盖一个「启动戳」
 *
 * 手验反馈：消息中心里**多次启动的记录混在了一起**，用户分不清哪几条属于同一次
 * 启动——而这个面板记的恰恰是故障，分不清批次等于分不清故障次数。于是每条消息都
 * 带上 `runId`（launcher 单点产出的启动标识，与 `log/runs/<…>-<runId>` 同源），
 * 面板按它分组（判据见 `~/lib/shell/message-run-groups`）。
 *
 * 两个时刻各归各的组：**断开**发生在旧一次启动里（盖旧 runId——服务已经死了，
 * 端点问不到，用的是探活链路留住的那一个），**恢复**发生在新一次启动里（盖新
 * runId，与 `setProbeOk` 同一批落，见 `use-dev-server-liveness`）。
 *
 * 本 hook 还负责把 `currentRunId` 写进 store：`push` 的 runId 缺省盖它，于是**所有**
 * 生产方（应用服务、代码更新、版本更新）都自动按启动分组，不需要每一个都去接一次
 * 探活链路。
 */

import { useEffect, useRef } from "react";

import {
  describeAppServiceExit,
  fetchAppServiceExit,
  isPreviousRunExit,
} from "~/lib/shell/app-service-exit";
import type { DevServerState } from "~/lib/shell/dev-server-status";
import {
  deriveAppServiceEvent,
  describeAppServiceDisconnect,
  describeAppServiceRouteStale,
  describeAppServiceStart,
  initialAppServiceCursor,
  type AppServiceEvent,
  type AppServiceEventCursor,
} from "~/lib/shell/app-service-message";

import {
  useMessageCenterStore,
  type NewMessage,
} from "../message-center-store";

export interface AppServiceMessageLogInput {
  /** 应用服务四态（`~/lib/shell/dev-server-status` 的判据结果）。 */
  state: DevServerState;
  /** 这一份进程对本次页面会话来说是新的（冷启动 / 真重启；刷新不算）。 */
  processIsNew: boolean;
  /** 当前是哪一次启动（runId）；null = 拿不到（手工 `pnpm dev` 等）。 */
  currentRunId: string | null;
}

/** 卸载守卫：`fetchAppServiceExit` 是异步的，卸载后它仍可能回来。 */
type StoppedFlag = { readonly current: boolean };

/* 分档（`kind`）直接取 store 的 `MessageKind` 联合，不另立一份常量表：
 * 断开走 `offline`（与「已重启」不同色——它不是一次恢复动作，是「现在这件事
 * 就是坏的」），启动/恢复走 `restart`（与 `CodeUpdateWatcher` 的重启提示同档）。 */
function push(message: NewMessage): void {
  useMessageCenterStore.getState().push(message);
}

/** 启动/恢复那条：先把原因读回来，再连同时间一起写成一条完整消息。 */
async function recordStart(
  event: Extract<AppServiceEvent, { type: "start" }>,
  stopped: StoppedFlag,
  runId: string | null,
): Promise<void> {
  /* 全程不抛（`fetchAppServiceExit` 自带兜底）：这一刻刚出过一次故障，
   * 任何异常都只会让现场更难查。 */
  const probe = await fetchAppServiceExit();
  if (stopped.current) return;
  /* 只认「说的是上一次运行」的记录——判据见 `isPreviousRunExit`，
   * 同一份记录形状与 `use-dev-server-liveness` 的读回侧一致。 */
  const record =
    probe.record !== null && isPreviousRunExit(probe.record, probe.currentRunId)
      ? probe.record
      : null;
  const { title, body } = describeAppServiceStart({
    at: event.at,
    offlineAt: event.offlineAt,
    exitAt: record === null ? null : Date.parse(record.at) || null,
    notice: record === null ? null : describeAppServiceExit(record),
  });
  push({ kind: "restart", title, body, runId });
}

export function useAppServiceMessageLog({
  state,
  processIsNew,
  currentRunId,
}: AppServiceMessageLogInput): void {
  /* 边沿判据的游标放 ref：它只参与判定、不驱动渲染，而它必须**跨渲染存活**——
   * 边沿判据的整个要点就是「和上一拍比」，每渲染重建一份就没有「上一拍」了。 */
  const cursorRef = useRef<AppServiceEventCursor>(initialAppServiceCursor());
  const stoppedRef = useRef(false);

  useEffect(() => {
    /* 局部别名取的是 ref 的**身份**（不是它的 `.current` 值）：cleanup 与
     * 之后每一次异步回调要写的是同一个开关，而读 ref 的 `.current` 写进
     * cleanup 会被 eslint 判成「cleanup 跑到时它早变了」。 */
    const stopped = stoppedRef;
    stopped.current = false;
    return () => {
      stopped.current = true;
    };
  }, []);

  /* 把「当前是哪一次启动」同步进 store：`push` 的 runId 缺省盖它，于是其它生产方
   * （代码更新 / 版本更新）也自动按启动分组；面板则据此标出「本次启动」那一组。
   * 放在 effect 里而不是渲染期：这是跨组件共享状态，不是本 hook 的渲染输入。 */
  useEffect(() => {
    useMessageCenterStore.getState().setCurrentRunId(currentRunId);
  }, [currentRunId]);

  useEffect(() => {
    const { cursor, event } = deriveAppServiceEvent(
      cursorRef.current,
      { state, processIsNew },
      Date.now(),
    );
    cursorRef.current = cursor;
    if (event === null) return;
    if (event.type === "disconnect") {
      const { title, body } = describeAppServiceDisconnect(event.at);
      /* 断开那一刻盖的是**旧一次启动**的 runId（服务已经死了、端点问不到，
       * 用的是探活链路留住的值）——它本来就发生在那一启动里。 */
      push({ kind: "offline", title, body, runId: currentRunId });
      return;
    }
    if (event.type === "route-stale") {
      /* 服务还在应答，runId 是**当前这一次**的（端口答得了 404 就答得了它）——
       * 与断开那条相反，不是刻意为之，是事实本来就不同。 */
      const { title, body } = describeAppServiceRouteStale(event.at);
      push({ kind: "offline", title, body, runId: currentRunId });
      return;
    }
    void recordStart(event, stoppedRef, currentRunId);
  }, [state, processIsNew, currentRunId]);
}
