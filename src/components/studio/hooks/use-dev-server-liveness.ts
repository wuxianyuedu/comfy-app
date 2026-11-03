"use client";

// ── dev server 存活与「真正重启」探测（底部状态栏重启标记的数据源）
// 旧实现把「探测失败」当重启信号，但显示器关闭 / 后台节流 / 瞬时断网也会网络层失败 → 误报。
// 现改用 bootId 作权威：进程每次冷启动重新生成，没重启则恒定；新 bootId ≠ 上次即真重启。
// 断开侧抗抖动：连续失败到 OFFLINE_CONFIRM_FAILURES 拍才算（单拍超时可能只是冷编译 / Turbopack 抢锁）。
// sessionStorage 保留上次 bootId 与重启时间：真重启会整页刷新、内存基准丢失，刷新后靠它识别。

import { useCallback, useEffect, useRef, useState } from "react";

import { useInterval } from "~/components/ui/use-interval";
import { SERVER_ID_ENDPOINT } from "~/lib/log/panel-self-poll";
import {
  describeAppServiceExit,
  fetchAppServiceExit,
  isPreviousRunExit,
  type AppServiceExitNotice,
} from "~/lib/shell/app-service-exit";

export const DEV_SERVER_PROBE_MS = 2000;

/**
 * 「连续失败几拍才认断开」的门槛。单拍失败不算：`/api/dev/server-id` 是应用服务自己的
 * HTTP，冷编译 / 按需编译 / Turbopack 抢锁时都可能超过 2.5s 超时，当断开会让服务好好的
 * 界面翻成「已断开」并写两条消息。取 2（两拍 ≈ 4 秒）；恢复侧不需要门槛。
 */
export const OFFLINE_CONFIRM_FAILURES = 2;

/** 检测到真正重启后，状态栏「刚重启」高亮的持续时长。 */
export const RESTART_RECENT_MS = 10_000;

const LAST_RESTART_KEY = "devServer.lastRestartAt";
const LAST_BOOT_ID_KEY = "devServer.lastBootId";

export type DevServerLiveness = {
  /** 连续失败拍数（未达门槛时说明它正在积累）；探通一次即归零。 */
  consecutiveFailures: number;
  /**
   * 当前是哪一次**启动**（launcher 的 runId）；null = 拿不到（纯手工 `pnpm dev`、
   * 端点还没答过、或这次启动没走 launcher）。消息中心按它把历史消息分成「每一次启动」一组。
   * **只在探测成功时更新**：断开那一刻要「正在死的这次启动」id，那时问不到，须留住上次值。
   */
  currentRunId: string | null;
  /** 本会话是否曾成功探到过该进程：用于把「还没探通」与「曾经通、现在断」
   *  区分开——只有后者才是「应用服务已断开」。 */
  everOnline: boolean;
  /**
   * 「上一次应用服务为什么结束」——进程死亡那一刻由启动编排落盘、这里在服务
   * **恢复应答之后**读回（ISSUE #1692）。null = 没有原因可讲 / 还没读到。
   */
  lastExit: AppServiceExitNotice | null;
  /** `lastExit` 对应记录的落盘时刻（毫秒）；无记录为 null。 */
  lastExitAt: number | null;
  /** 最近一次**真正**重启的时刻；本浏览器会话无记录时为 null。 */
  lastRestartAt: number | null;
  /** 最近一次探测成功（进程可达）。首帧（尚未探过）为 false。 */
  probeOk: boolean;
  /**
   * **这一份进程对本次页面会话来说是新的**（冷启动或真重启）。与 `restarting` 的差别：
   * 那个 10 秒后自行复位，这个不会。「进程换了一个」不能看探活失败（显示器关闭 / 后台节流 /
   * 断网都会失败），而整页刷新**不算**进程换新。消息中心「已启动 / 已恢复」建在它上面。
   */
  processIsNew: boolean;
  /**
   * **抗抖动后的可达性**（喂给 `deriveDevServerStatus` 的那个事实）。
   * 与 `probeOk` 的差别正是 `OFFLINE_CONFIRM_FAILURES`：单拍失败不翻 false，连续失败到门槛才算。
   * 状态栏与消息中心都只看这个值 —— 它们要回答「服务现在能不能应答」，不是「刚才那一拍」。
   */
  reachable: boolean;
  /** true = 本会话刚检测到一次**真正**重启（bootId 变化），短暂高亮。 */
  restarting: boolean;
  /**
   * 最近一次探测**得到了 404**：进程在应答，但这条探活端点不在编译图里（陈旧路由表 /
   * Turbopack 会话级路由失效）。与 `probeOk` 的区别是「答了、只是答的是 404」与「没答」——
   * 用户能做的动作不同（重启应用 vs 等它起来），状态栏必须分得开。
   */
  routeTableStale: boolean;
  /**
   * 这一拍之前有多少毫秒**没人在探测**（0 = 紧接上一拍）。探活会因窗口失焦 / 页面进后台而
   * **暂停**（`useInterval` 默认 pauseWhenHidden），后台节流时定时器还可能拖到分钟级，
   * 停表期间墙钟照走。消息中心拿这个数把「断开 → 恢复」里那段无人问过的时间如实标注。
   */
  unprobedMs: number;
};

/**
 * 「上一拍发起 → 这一拍发起」之间有多少毫秒是**没人在探测**的。扣掉 `DEV_SERVER_PROBE_MS`：
 * 那一拍本来就该走完（正常连拍为 0），超出部分才是停表；clamp 到 ≥0，首拍与时钟回拨都不该为负。
 * 用**发起**时刻而非应答时刻：探活有 2.5s 超时，拿应答算会把「这一拍慢了」记成停表。
 */
export function probeGapMs(previousStartedAt: number | null, startedAt: number): number {
  if (previousStartedAt === null) {
    return 0;
  }
  return Math.max(0, startedAt - previousStartedAt - DEV_SERVER_PROBE_MS);
}

function readSessionNumber(key: string): number | null {
  try {
    const raw = sessionStorage.getItem(key);
    const n = raw === null ? Number.NaN : Number(raw);
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

type ProbeResult =
  | { bootId: string; ok: true; runId: string | null }
  /** 服务**应答了**，但这条端点不在编译图里（404 = 陈旧路由表的签名，
   *  与启动器 `classifyProbe` 的 `route-404` 同一判据）。 */
  | { bootId: null; ok: false; routeTableStale: true; runId: null }
  /** 网络层失败 / 非 404 的错误码：服务此刻不可达（或答不上来）。 */
  | { bootId: null; ok: false; routeTableStale: false; runId: null };

/** 单次探测：读取 dev server 当前 bootId 与**本次启动**的 runId。三种结局分得开：
 * 2xx = 进程在；404 = 进程在但端点没进路由表（陈旧路由表 / Turbopack 会话级失效，正解是重启）；
 * 抛异常 / 其它错误码 = 不可达。404 单独成一档，否则 `everOnline` 永远为假、状态栏永久停在
 * 「连接中」，而页面明明被同一进程服务着。`runId` 与 `bootId` 同一次请求回来是刻意的
 *（分两次会在「服务刚恢复」那一刻拿着旧 runId，把恢复消息盖错启动组）。 */
async function probeBootId(): Promise<ProbeResult> {
  try {
    const res = await fetch(SERVER_ID_ENDPOINT, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) {
      return {
        ok: false,
        bootId: null,
        runId: null,
        routeTableStale: res.status === 404,
      };
    }
    /* SAFETY: 类型断言已复核 */
    const data = (await res.json()) as {
      bootId?: unknown;
      runId?: unknown;
    };
    const runId = typeof data.runId === "string" && data.runId.length > 0 ? data.runId : null;
    return typeof data.bootId === "string" && data.bootId.length > 0
      ? { ok: true, bootId: data.bootId, runId }
      : { ok: false, bootId: null, runId: null, routeTableStale: false };
  } catch {
    return { ok: false, bootId: null, runId: null, routeTableStale: false };
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
  /* 「探活端点本身 404」这一档。与连通性分开存：它描述的不是「服务在不在」，
   * 而是「服务答的这条路通不通」，两者可以同时为假、也可以各自单独为真。 */
  const [routeTableStale, setRouteTableStale] = useState(false);
  const [everOnline, setEverOnline] = useState(false);
  /* 「这份进程对本次页面会话来说是新的」（见 `DevServerLiveness.processIsNew`）。
   * 初值 false：首帧还没探过，谈不上新旧。 */
  const [processIsNew, setProcessIsNew] = useState(false);
  /* 上一次结束的原因（服务恢复应答之后才读得到，见 ~/lib/shell/app-service-exit）。
   * 只在**换了一个新 bootId** 时取一次，因此同一次故障不会随每次轮询重复读取。 */
  const [lastExit, setLastExit] = useState<AppServiceExitNotice | null>(null);
  const [lastExitAt, setLastExitAt] = useState<number | null>(null);
  /* 当前是哪一次启动（runId）。**失败不清空**：断开那一刻要给「正在死的这次启动」
   * 盖戳，而那时端点已经问不到了（见 `DevServerLiveness.currentRunId`）。 */
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  /* 已就哪个 bootId 取过原因：轮询每 2s 一次，没有它就等于每拍都打一次这个端点。 */
  const exitFetchedForBootIdRef = useRef<string | null>(null);
  /* 「这一拍之前没人在探测的那一段」（见 DevServerLiveness.unprobedMs）。存的是
   * 事实，因此进 state 而不是 ref —— 它要沿 view model 递到消息中心去。 */
  const [unprobedMs, setUnprobedMs] = useState(0);
  /* 上一拍**发起**时刻（基准）。ref 而非 state：它在探测回调里被读写、不参与渲染，
   * 推进它本身不该触发一次渲染。 */
  const lastProbeStartedAtRef = useRef<number | null>(null);

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
    /* 停表多久了：按**发起**时刻算，而且必须在 `await` 之前落（基准也要先推进，
     * 否则同一拍里再读到的「上一拍」还是它自己，下一拍就会算成没停过表）。
     * 见 `probeGapMs`。 */
    const startedAt = Date.now();
    setUnprobedMs(probeGapMs(lastProbeStartedAtRef.current, startedAt));
    lastProbeStartedAtRef.current = startedAt;
    const result = await probeBootId();
    if (stoppedRef.current) {
      return;
    }

    /* 连通性先落：无论后续是否判定重启，视图都要知道此刻进程可不可达。 */
    setProbeOk(result.ok);
    setRouteTableStale(!result.ok && result.routeTableStale);
    setConsecutiveFailures(result.ok ? 0 : (n) => n + 1);
    if (result.ok) {
      setEverOnline(true);
    }
    /* 启动标识只认成功那一拍：与 `setProbeOk` 同一批落，于是「服务刚恢复」的
     * 下一个渲染里拿到的已经是**新一次启动**的 runId —— 恢复那条消息因此盖在
     * 新组而不是旧组（若分成两次请求就会盖错）。 */
    if (result.ok) {
      setCurrentRunId(result.runId);
    }

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
        if (recentTimerRef.current) {
          clearTimeout(recentTimerRef.current);
        }
        recentTimerRef.current = setTimeout(() => {
          if (!stoppedRef.current) {
            setRestarting(false);
          }
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

      /* 就这个 bootId 取一次「上一次为什么结束」（ISSUE #1692）。放在成功探测之后是必然的：
       * 探活走的正是应用服务自己的 HTTP，服务不在时这条端点也不通 —— 记录只能在它恢复应答后读回。
       * 每个 bootId 只取一次：轮询 2s 一拍，不去重等于每拍都打一次，而答案整个进程生命周期不变。 */
      if (exitFetchedForBootIdRef.current !== bootId) {
        exitFetchedForBootIdRef.current = bootId;
        const probe = await fetchAppServiceExit();
        // oxlint-disable-next-line no-unnecessary-condition -- stoppedRef 由卸载清理在 await 期间写入，规则的控制流分析看不到该写入点
        if (stoppedRef.current) {
          return;
        }
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
      if (recentTimerRef.current) {
        clearTimeout(recentTimerRef.current);
      }
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
    routeTableStale,
    /* 抗抖动后的可达性：还没到门槛的失败仍算可达（单拍抖动不是断开）。
     * `consecutiveFailures` 达门槛那一刻这一项翻 false，状态栏与消息中心
     * 随之各记一条（断开 / 恢复），而抖动期间它们什么都不记。 */
    reachable: probeOk || consecutiveFailures < OFFLINE_CONFIRM_FAILURES,
    consecutiveFailures,
    everOnline,
    currentRunId,
    unprobedMs,
  };
}
