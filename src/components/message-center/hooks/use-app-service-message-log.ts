"use client";

/* ── 把「应用服务断开 / 启动 / 路由异常」写进消息中心（规范 17 §17.2 第②层）──
 * 把 `useDevServerStatus()` 给的四态翻成消息记录；事实由外部递进（探活循环全应用
 * 只有一条），原因在 push 前现读——断开走壳的 IPC（服务已死、HTTP 不通、记录早在
 * 盘上），恢复走 HTTP，取不到照实说不编原因（ISSUE #1915）。每条盖 runId 供分组
 *（断开盖旧、恢复盖新），并把 `currentRunId` 写进 store 作缺省戳。 */

import { useEffect, useRef } from "react";

import {
  describeAppServiceExit,
  fetchAppServiceExit,
  fetchCurrentDisconnectExit,
  isPreviousRunExit,
} from "~/lib/shell/app-service-exit";
import { isRecord } from "~/lib/is-record";
import { fetchLoopBlockForOffline } from "~/lib/shell/app-service-loop-blocks";
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

import { useMessageCenterStore, type NewMessage } from "../message-center-store";
import { useInterval } from "~/components/ui/use-interval";

export type AppServiceMessageLogInput = {
  /** 当前是哪一次启动（runId）；null = 拿不到（手工 `pnpm dev` 等）。 */
  currentRunId: string | null;
  /** 这一份进程对本次页面会话来说是新的（冷启动 / 真重启；刷新不算）。 */
  processIsNew: boolean;
  /** 应用服务四态（`~/lib/shell/dev-server-status` 的判据结果）。 */
  state: DevServerState;
  /**
   * 最后一拍之前**没人在探测**的那一段（毫秒，0 = 紧接上一拍）。
   * 探活因窗口失焦/进后台而暂停时墙钟照走，「断开持续了多久」会混进没人问过
   * 服务的时间。本 hook 只转给判据，**不在这一层算**（`~/lib/shell/app-service-message`）。
   */
  unprobedMs: number;
};

/** 卸载守卫：`fetchAppServiceExit` 是异步的，卸载后它仍可能回来。 */
type StoppedFlag = { readonly current: boolean };

/* 分档（`kind`）直接取 store 的 `MessageKind` 联合，不另立一份常量表：
 * 断开走 `offline`（与「已重启」不同色——它不是一次恢复动作，是「现在这件事
 * 就是坏的」），启动/恢复走 `restart`（与 `CodeUpdateWatcher` 的重启提示同档）。 */
function push(message: NewMessage): void {
  useMessageCenterStore.getState().push(message);
}

/** 断开那条：先在壳内把「这一次为什么断」读回来（读不到就照实说），再写成消息。 */
async function recordDisconnect(
  at: number,
  stopped: StoppedFlag,
  runId: string | null,
): Promise<void> {
  /* 全程不抛（`fetchCurrentDisconnectExit` 自带兜底）：这一刻刚出过一次故障，
   * 任何异常都只会让现场更难查。 */
  const record = await fetchCurrentDisconnectExit(runId, Date.now());
  if (stopped.current) {
    return;
  }
  const { title, body } = describeAppServiceDisconnect(
    at,
    record === null ? null : describeAppServiceExit(record),
  );
  push({ kind: "offline", title, body, runId, time: at });
}

/** 启动/恢复那条：先把原因读回来，再连同时间一起写成一条完整消息。 */
async function recordStart(
  event: Extract<AppServiceEvent, { type: "start" }>,
  stopped: StoppedFlag,
  runId: string | null,
): Promise<void> {
  /* 全程不抛（`fetchAppServiceExit` / `fetchLoopBlockForOffline` 自带兜底）：这一刻
   * 刚出过一次故障，任何异常都只会让现场更难查。两个读回都只在**恢复**场景有意义
   * （冷启动没有「刚才为什么断」可讲），断开窗口用不上就都回 null，这里不重复判。 */
  const offlineAt = event.offlineAt;
  const recovered = offlineAt !== null;
  const [probe, loopBlock] = await Promise.all([
    fetchAppServiceExit(),
    recovered ? fetchLoopBlockForOffline(offlineAt, event.at) : Promise.resolve(null),
  ]);
  if (stopped.current) {
    return;
  }
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
    /* 与断开窗口重叠的事件循环阻塞（ISSUE #3369）：读到就把恢复消息里的
     * 「多半是短暂无响应」换成事实读数。 */
    loopBlock,
    /* 停表那一段随事件走（判据在纯函数层决定「多长才值得标一行」）。 */
    unprobedMs: event.unprobedMs,
  });
  /* 带上**事件时刻**而不是让 store 记 push 时刻：这条要先把原因读回来，push 天然
   * 比事件晚一个往返，而「断开 → 恢复」的先后必须由事情发生的顺序决定。 */
  push({ kind: "restart", title, body, runId, time: event.at });
}

/** 后台启动分支失败的用户可见文案（ISSUE #4257）：按分支给后果与出路；
 *  未知分支给通用文案。导出仅为可测。 */
export function bootBranchNotice(name: string): { body: string; title: string } {
  switch (name) {
    case "dispatch": {
      return {
        body:
          "后台的任务派发循环没能启动，排队中的任务不会被自动执行（重启应用通常可恢复；" +
          "若反复出现，请到控制台反馈并附应用日志）。",
        title: "应用服务：任务自动派发未启动",
      };
    }
    case "reaper": {
      return {
        body:
          "后台的回收循环没能启动，失败或超时的任务可能停留在「生成中」。" + "重启应用通常可恢复。",
        title: "应用服务：孤儿任务回收未启动",
      };
    }
    case "film-resume": {
      return {
        body: "重启前中断的影片可能停留在「生成中」，不会自动续跑。重启应用通常可恢复。",
        title: "应用服务：成片监看恢复未启动",
      };
    }
    default: {
      return {
        body: "一个后台功能没能启动，相关能力可能不可用。重启应用通常可恢复。",
        title: `应用服务：后台功能「${name}」未启动`,
      };
    }
  }
}

/** 启动分支结果的轮询间隔：就绪后先查一次，之后每分钟对账一次。 */
const BOOT_BRANCH_POLL_MS = 60_000;

/** 拉一次启动分支失败清单并记进消息中心；全程不抛——这一刻若服务不健康，
 *  拉不到是常态，分支失败本身已有 boot 日志兜底。 */
async function checkBootBranches(runId: string, stopped: StoppedFlag): Promise<void> {
  try {
    const res = await fetch("/api/dev/boot-branches");
    const raw: unknown = await res.json();
    /* 卸载后再回来的一拍不再写消息（stopped 由 hook 的卸载守卫翻转）。 */
    if (stopped.current || !isRecord(raw) || !Array.isArray(raw.branches)) {
      return;
    }
    for (const branch of raw.branches) {
      if (!isRecord(branch) || branch.ok !== false || typeof branch.name !== "string") {
        continue;
      }
      const notice = bootBranchNotice(branch.name);
      push({
        kind: "info",
        id: `boot-branch-${runId}-${branch.name}`,
        title: notice.title,
        body: notice.body,
        runId,
        time: Date.now(),
      });
    }
  } catch {
    /* 拉不到就算了：分支失败本身已有 boot 日志兜底 */
  }
}

export function useAppServiceMessageLog({
  state,
  processIsNew,
  currentRunId,
  unprobedMs,
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
      { state, processIsNew, unprobedMs },
      Date.now(),
    );
    cursorRef.current = cursor;
    if (event === null) {
      return;
    }
    if (event.type === "disconnect") {
      /* 断开那一刻就**尽量**把原因带上（ISSUE #1915）：记录早在进程结束时落盘，
       * HTTP 读不到（没了的服务自己在应答），壳内走 IPC 读同一文件；拿不到时
       * `describeAppServiceDisconnect` 照实说「这一刻拿不到」，不编「未知原因」。
       * 盖的是**本次启动**的 runId，判据相应为 `isCurrentDisconnectExit`。 */
      void recordDisconnect(event.at, stoppedRef, currentRunId);
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
  }, [state, processIsNew, currentRunId, unprobedMs]);

  /* 后台启动分支的失败提示（ISSUE #4257）：新进程就绪后（以及此后每分钟）
   * 问一次 /api/dev/boot-branches，把仍失败的功能分支记进消息中心——
   * dispatch / reaper / film-resume 静默失效时，用户能看见「为什么任务不动」。
   * 消息 id 按 runId + 分支名确定 ⇒ 刷新与重复轮询由 store 的幂等去重吸收。
   * 轮询走 `useInterval`（视图层定时器的唯一出口，P12）：就绪即查一次，
   * 后台标签页自动暂停、回前台补跑一次——手写 setInterval 会空转白拉。 */
  useInterval(
    () => {
      if (currentRunId === null) {
        return;
      }
      void checkBootBranches(currentRunId, stoppedRef);
    },
    { ms: processIsNew && currentRunId !== null ? BOOT_BRANCH_POLL_MS : null },
  );
}
