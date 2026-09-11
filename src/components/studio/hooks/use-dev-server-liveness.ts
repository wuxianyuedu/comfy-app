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
// 持久化（sessionStorage）：
//   - 保留上次 bootId 作为对比基准：dev server 真重启会触发整页刷新，刷新后
//     React 内存里的基准丢失，靠 sessionStorage 恢复旧 bootId 才能识别出新
//     bootId 变化。
//   - 保留上次重启时间，刷新后标记仍可弱化展示「上次重启于 XX:XX」。
//
// 注意：本探测同时用于「dev server 是否在线」的展示——探测失败仍表示进程
// 当前不可达（restarting 字段的旧语义被改掉，详情见下）。

import { useEffect, useRef, useState } from "react";

export const DEV_SERVER_PROBE_MS = 2000;

/** 检测到真正重启后，状态栏「刚重启」高亮的持续时长。 */
export const RESTART_RECENT_MS = 10_000;

const LAST_RESTART_KEY = "devServer.lastRestartAt";
const LAST_BOOT_ID_KEY = "devServer.lastBootId";

export interface DevServerLiveness {
  /** true = 本会话刚检测到一次**真正**重启（bootId 变化），短暂高亮。 */
  restarting: boolean;
  /** 最近一次**真正**重启的时刻；本浏览器会话无记录时为 null。 */
  lastRestartAt: number | null;
  /** 最近一次探测成功（进程可达）。首帧（尚未探过）为 false。 */
  probeOk: boolean;
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

type ProbeResult =
  | { ok: true; bootId: string }
  | { ok: false; bootId: null };

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
  const [everOnline, setEverOnline] = useState(false);

  /* 上次已知 bootId（对比基准）。ref 而非 state：探测回调里读取即可，
   * 无需触发渲染。初值置 null：SSR 阶段读不到 sessionStorage（也不应与
   * 客户端首帧不一致），真正的恢复放在首次探测前（见 probe 里补读），
   * 靠它在页面因进程重启而整页刷新后恢复旧 bootId，才能识别变化。 */
  const lastBootIdRef = useRef<string | null>(null);

  /* 检测到真正重启后的高亮计时器。 */
  const recentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    const probe = async () => {
      /* 首次探测前补读持久化的上次 bootId，作为真正重启的对比基准。
       * （hydrate 阶段 sessionStorage 读不到，此处手动恢复。） */
      lastBootIdRef.current ??= readSessionString(LAST_BOOT_ID_KEY);
      const result = await probeBootId();
      if (stopped) return;

      /* 连通性先落：无论后续是否判定重启，视图都要知道此刻进程可不可达。 */
      setProbeOk(result.ok);
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
          if (recentTimerRef.current) clearTimeout(recentTimerRef.current);
          recentTimerRef.current = setTimeout(() => {
            if (!stopped) setRestarting(false);
          }, RESTART_RECENT_MS);
        }

        lastBootIdRef.current = bootId;
        writeSession(LAST_BOOT_ID_KEY, bootId);
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
    };

    void probe();
    timer = setInterval(() => void probe(), DEV_SERVER_PROBE_MS);
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      if (recentTimerRef.current) clearTimeout(recentTimerRef.current);
    };
  }, []);

  return { restarting, lastRestartAt, probeOk, everOnline };
}
