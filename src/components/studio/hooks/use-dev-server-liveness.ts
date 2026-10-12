"use client";

// ── dev server 存活与「真正重启」探测（底部状态栏重启标记的数据源）──────────
//
// 背景（ISSUE #236）：旧实现把「探测失败」当成 dev server 重启信号——
// dev server 重启期间浏览器对该进程的所有 /api 请求会网络层失败；ComfyUI
// 离线时请求仍能到达 dev server（应用层返回 online:false）。二者据此区分。
// 但显示器关闭 / 浏览器后台节流 / 瞬时断网同样会导致网络层探测失败，被当成
// 重启 → 误报。用户「没改代码、只关了显示器」就看到「重启」标记。
//
// 本实现改用「进程启动标识 bootId」作为**真正重启**的权威信号：
//   - dev server 每次冷启动重新生成一个 bootId（见 src/lib/dev-server-id.ts）；
//   - 只要进程没重启，bootId 恒定不变；
//   - 进程重启后，前端恢复探测到的新 bootId 与上次不同 → 判定为真正重启。
//
// 判定规则：
//   - 探测**成功**且 bootId 与上次记录**不同** → 真正重启，记录真正重启时间。
//   - 探测**失败**（网络瞬时抖动 / 显示器关闭 / 后台节流）→ **不**判定重启，
//     不更新重启时间（这是本次排除的误报）。
//
// 「断开」这一档同样要抗抖动：探活打的是应用服务自己的 HTTP，它在冷编译 /
// 按需编译 / Turbopack 抢锁时都可能超过探活超时，单拍失败就被当成断开的话，
// 界面会在服务好好的情况下翻成「应用服务已断开」并往消息中心写两条消息。
// 连续失败到 {@link OFFLINE_CONFIRM_FAILURES} 拍才算断开（见该常量注释）。
//
// 持久化（sessionStorage）：
//   - 保留上次 bootId 作为对比基准：dev server 真重启会触发整页刷新，刷新后
//     React 内存里的基准丢失，靠 sessionStorage 恢复旧 bootId 才能识别出新
//     bootId 变化。
//   - 保留上次重启时间，刷新后标记仍可弱化展示「上次重启于 XX:XX」。
//
// 注意：本探测同时用于「dev server 是否在线」的展示——探测失败仍表示进程
// 当前不可达（restarting 字段的旧语义被改掉，详情见下）。

import { useCallback, useEffect, useRef, useState } from "react";

import { useInterval } from "~/components/ui/use-interval";
import {
  describeAppServiceExit,
  fetchAppServiceExit,
  isPreviousRunExit,
  type AppServiceExitNotice,
} from "~/lib/shell/app-service-exit";

export const DEV_SERVER_PROBE_MS = 2000;

/**
 * 「连续失败几拍才认断开」的门槛。
 *
 * **为什么单拍失败不算断开**：`/api/dev/server-id` 是应用服务自己的 HTTP，而它在
 * 冷编译、按需编译某条路由、或 Turbopack 抢锁时都可能超过探活的 2.5s 超时。
 * 把它当成「断开」，界面会在**服务好好的**情况下翻成「应用服务已断开」，并往
 * 消息中心写「已断开 + 已恢复」两条 —— 手验现场就是这一档：断开 15:00:28、
 * 恢复 15:00:31（持续 2 秒），而那两秒里服务一直在应答。
 *
 * 取 2 而不是「立即」也不是「很多拍」：两拍 ≈ 4 秒，真实断开（进程没了）在
 * 界面上晚 4 秒出现完全可以接受，而抖动一次就写两条消息不可以。
 *
 * **恢复侧不需要门槛**：抖动期间状态一直没翻成 offline，恢复边沿就不成立
 * （判据见 `~/lib/shell/app-service-message`），因此这里只管「认不认断开」。
 */
export const OFFLINE_CONFIRM_FAILURES = 2;

/** 检测到真正重启后，状态栏「刚重启」高亮的持续时长。 */
export const RESTART_RECENT_MS = 10_000;

const LAST_RESTART_KEY = "devServer.lastRestartAt";
const LAST_BOOT_ID_KEY = "devServer.lastBootId";

export interface DevServerLiveness {
  /** true = 本会话刚检测到一次**真正**重启（bootId 变化），短暂高亮。 */
  restarting: boolean;
  /**
   * **这一份进程对本次页面会话来说是新的**（冷启动或真重启）。
   *
   * 与 `restarting` 的差别是「10 秒高亮」与「本次会话的既成事实」：那个会自己
   * 复位，这个不会。它存在的理由是有一条判据只有它能给 ——「进程换了一个」不能
   * 看探活失败（显示器关闭 / 后台节流 / 瞬时断网都会失败，那几条已明确不判定
   * 重启），而整页刷新**不算**进程换新（同一份进程还在服务，刷新只是页面重来）。
   * 消息中心「应用服务已启动 / 已恢复」那条记录就建在它上面
   * （见 `~/lib/shell/app-service-message`）。
   */
  processIsNew: boolean;
  /**
   * 「上一次应用服务为什么结束」——进程死亡那一刻由启动编排落盘、这里在服务
   * **恢复应答之后**读回（ISSUE #1692）。null = 没有原因可讲 / 还没读到。
   */
  lastExit: AppServiceExitNotice | null;
  /** 最近一次**真正**重启的时刻；本浏览器会话无记录时为 null。 */
  lastRestartAt: number | null;
  /** 最近一次探测成功（进程可达）。首帧（尚未探过）为 false。 */
  probeOk: boolean;
  /**
   * **抗抖动后的可达性**（喂给 `deriveDevServerStatus` 的那个事实）。
   *
   * 与 `probeOk` 的差别正是 {@link OFFLINE_CONFIRM_FAILURES}：单拍失败不把
   * 「可达」翻成 false，连续失败到门槛才算。状态栏与消息中心都只看这个值——
   * 它们要回答的是「服务现在能不能应答」，而不是「刚才那一拍有没有应答」。
   */
  reachable: boolean;
  /** 连续失败拍数（未达门槛时说明它正在积累）；探通一次即归零。 */
  consecutiveFailures: number;
  /** `lastExit` 对应记录的落盘时刻（毫秒）；无记录为 null。 */
  lastExitAt: number | null;
  /** 本会话是否曾成功探到过该进程：用于把「还没探通」与「曾经通、现在断」
   *  区分开——只有后者才是「应用服务已断开」。 */
  everOnline: boolean;
}

function readSessionNumber(key: string): number | null {
  try {
    const raw = sessionStorage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function readSessionString(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* sessionStorage 被禁用（隐私模式）时放弃持久化，标记仅本轮生效 */
  }
}

type ProbeResult = { ok: true; bootId: string } | { ok: false; bootId: null };

/** 单次探测：读取 dev server 当前 bootId。任何 HTTP 响应（含应用层错误码）
 *  说明进程在；仅网络层失败（reject）视为不可达。 */
async function probeBootId(): Promise<ProbeResult> {
  try {
    const res = await fetch("/api/dev/server-id", {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return { ok: false, bootId: null };
    const data = (await res.json()) as { bootId?: unknown };
    return typeof data.bootId === "string" && data.bootId.length > 0
      ? { ok: true, bootId: data.bootId }
      : { ok: false, bootId: null };
  } catch {
    return { ok: false, bootId: null };
  }
}

export function useDevServerLiveness(): DevServerLiveness {
  /* 初值刻意为 null（SSR 与客户端首帧一致，避免 hydration 不匹配）；
   * 持久化的上次重启时间在首次探测完成后补读。 */
  const [restarting, setRestarting] = useState(false);
  const [lastRestartAt, setLastRestartAt] = useState<number | null>(null);
  /* 连通性：视图（状态栏）据此显示「应用服务运行中 / 已断开」。
   * 初值 false 表示「还没探过」，不代表故障——判据里由 everOnline 区分。 */
  const [probeOk, setProbeOk] = useState(false);
  /* 连续失败拍数：单拍失败不足以判「断开」（见 OFFLINE_CONFIRM_FAILURES），
   * 探通一次归零。 */
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const [everOnline, setEverOnline] = useState(false);
  /* 「这份进程对本次页面会话来说是新的」（见 `DevServerLiveness.processIsNew`）。
   * 初值 false：首帧还没探过，谈不上新旧。 */
  const [processIsNew, setProcessIsNew] = useState(false);
  /* 上一次结束的原因（服务恢复应答之后才读得到，见 ~/lib/shell/app-service-exit）。
   * 只在**换了一个新 bootId** 时取一次，因此同一次故障不会随每次轮询重复读取。 */
  const [lastExit, setLastExit] = useState<AppServiceExitNotice | null>(null);
  const [lastExitAt, setLastExitAt] = useState<number | null>(null);
  /* 已就哪个 bootId 取过原因：轮询每 2s 一次，没有它就等于每拍都打一次这个端点。 */
  const exitFetchedForBootIdRef = useRef<string | null>(null);

  /* 上次已知 bootId（对比基准）。ref 而非 state：探测回调里读取即可，
   * 无需触发渲染。初值置 null：SSR 阶段读不到 sessionStorage（也不应与
   * 客户端首帧不一致），真正的恢复放在首次探测前（见 probe 里补读），
   * 靠它在页面因进程重启而整页刷新后恢复旧 bootId，才能识别变化。 */
  const lastBootIdRef = useRef<string | null>(null);

  /* 检测到真正重启后的高亮计时器。 */
  const recentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef(false);

  /* 卸载守卫：`useInterval` 卸载即停间隔，但已发出的探测仍可能回来并
   * `setState`（也可能落在 `recentTimer` 的回调里）—— `stoppedRef` 保留
   * （规范 16 §16.2.4.15）。 */
  const stoppedRef = useRef(false);
  const probe = useCallback(async () => {
    /* 首次探测前补读持久化的上次 bootId，作为真正重启的对比基准。
     * （hydrate 阶段 sessionStorage 读不到，此处手动恢复。） */
    lastBootIdRef.current ??= readSessionString(LAST_BOOT_ID_KEY);
    const result = await probeBootId();
    if (stoppedRef.current) return;

    /* 连通性先落：无论后续是否判定重启，视图都要知道此刻进程可不可达。 */
    setProbeOk(result.ok);
    setConsecutiveFailures(result.ok ? 0 : (n) => n + 1);
    if (result.ok) setEverOnline(true);

    if (result.ok) {
      const bootId = result.bootId;
      const prevBootId = lastBootIdRef.current;

      /* 真正重启判定：已有对比基准（非首次/非刷新后首探）且 bootId 变化。
       * 首次探测（prevBootId 为 null）只做基准记录，不算重启。 */
      if (prevBootId !== null && prevBootId !== bootId) {
        const now = Date.now();
        setLastRestartAt(now);
        writeSession(LAST_RESTART_KEY, String(now));
        /* 短暂置「刚重启」高亮，随后自动复位。 */
        setRestarting(true);
        setProcessIsNew(true);
        if (recentTimerRef.current) clearTimeout(recentTimerRef.current);
        recentTimerRef.current = setTimeout(() => {
          if (!stoppedRef.current) setRestarting(false);
        }, RESTART_RECENT_MS);
      } else if (prevBootId === null) {
        /* 首探且**没有任何基准**（sessionStorage 里也没有）：这是一次冷启动，
         * 不是「刷新后接着看同一份进程」。区别对消息中心很要紧——前者要记一条
         * 「应用服务已启动」，后者（刷新前基准 == 本次 bootId）一条都不该记，
         * 否则用户每按一次 Ctrl+R 就多一条。 */
        setProcessIsNew(true);
      }

      lastBootIdRef.current = bootId;
      writeSession(LAST_BOOT_ID_KEY, bootId);

      /* 就这个 bootId 取一次「上一次为什么结束」（ISSUE #1692）。放在成功探测
       * 之后是必然的：探活走的正是应用服务自己的 HTTP，服务不在时这条端点也
       * 不通——记录只能在**它恢复应答之后**读回。
       *
       * 每个 bootId 只取一次：轮询 2s 一拍，不按 bootId 去重等于每拍都打一次
       * 这个端点，而答案在整个进程生命周期里不会变。 */
      if (exitFetchedForBootIdRef.current !== bootId) {
        exitFetchedForBootIdRef.current = bootId;
        const probe = await fetchAppServiceExit();
        if (stoppedRef.current) return;
        const record = probe.record;
        /* 只认「说的是上一次运行」的记录：记录带着结束那一次的 runId，与当前
         * 进程的 runId 一致就说明它描写的不是过去那一次（判据见 lib）。 */
        if (record && isPreviousRunExit(record, probe.currentRunId)) {
          setLastExit(describeAppServiceExit(record));
          setLastExitAt(Date.parse(record.at) || null);
        }
      }
    }
    /* 探测失败：不判定重启——这正是本次要排除的误报
     * （显示器关闭 / 后台节流 / 瞬时断网）。也不动 lastRestartAt。 */

    /* 首次探测完成后补读持久化的上次重启时间：setState 在异步回调里
     * 而非 effect 体（react-hooks/set-state-in-effect），且首帧保持
     * null 与 SSR 输出一致。 */
    if (!initializedRef.current) {
      initializedRef.current = true;
      setLastRestartAt((prev) => prev ?? readSessionNumber(LAST_RESTART_KEY));
    }
  }, []);

  useEffect(() => {
    stoppedRef.current = false;
    return () => {
      stoppedRef.current = true;
      if (recentTimerRef.current) clearTimeout(recentTimerRef.current);
    };
  }, []);

  /* 探测轮询：挂载即先探一次（`immediate`，之前也是），切后台暂停 —— 后台
   * 节流/断网正是这条判据要排除的误报来源（规范 16 §16.2.4.15）。 */
  useInterval(probe, { ms: DEV_SERVER_PROBE_MS });

  return {
    restarting,
    processIsNew,
    lastRestartAt,
    lastExit,
    lastExitAt,
    probeOk,
    /* 抗抖动后的可达性：还没到门槛的失败仍算可达（单拍抖动不是断开）。
     * `consecutiveFailures` 达门槛那一刻这一项翻 false，状态栏与消息中心
     * 随之各记一条（断开 / 恢复），而抖动期间它们什么都不记。 */
    reachable: probeOk || consecutiveFailures < OFFLINE_CONFIRM_FAILURES,
    consecutiveFailures,
    everOnline,
  };
}
