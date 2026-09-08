"use client";

// ── dev server 存活探测（底部状态栏「重启中」标记的数据源）──────────────
// Next dev server 重启期间，浏览器对该进程的所有 /api 请求在网络层失败
// （连接拒绝 / 超时）；而 ComfyUI 离线时请求仍能到达 dev server（应用层
// 返回 online:false）。二者据此区分：网络层失败 = dev server 本体不在。
//
// 状态机：
//   可达 →（探测失败）重启中，记录首次失败时刻为重启时间（sessionStorage
//   保留，页面因重启触发整页刷新后标记仍可恢复显示）→（恢复可达）正常态，
//   最近一次重启时间继续弱化展示。
//
// 注意：探测失败也可能源于断网/端口被占等异常，统一呈现为「重启中」——
// 对用户的操作含义一致：进行中任务已丢失，恢复后需重新执行。

import { useEffect, useRef, useState } from "react";

export const DEV_SERVER_PROBE_MS = 2000;

const LAST_RESTART_KEY = "devServer.lastRestartAt";

export interface DevServerLiveness {
  /** true = 探测失败（dev server 重启中 / 进程不可达）。 */
  restarting: boolean;
  /** 最近一次重启（探测开始失败）的时刻；本浏览器会话无记录时为 null。 */
  lastRestartAt: number | null;
}

function readSavedRestartAt(): number | null {
  try {
    const raw = sessionStorage.getItem(LAST_RESTART_KEY);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function useDevServerLiveness(): DevServerLiveness {
  const [restarting, setRestarting] = useState(false);
  /* 初值刻意为 null（SSR 与客户端首帧一致，避免 hydration 不匹配）；
   * 持久化的上次重启时间在首次探测完成后补读。 */
  const [lastRestartAt, setLastRestartAt] = useState<number | null>(null);
  /* prev-alive 用 ref 而非 state updater 内联判断：状态更新函数可能被
   * React 严格模式双重调用，副作用（写 sessionStorage）不能放在其中。 */
  const aliveRef = useRef(true);
  const initializedRef = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    const probe = async () => {
      let alive = true;
      try {
        /* 任何 HTTP 响应（含应用层错误码）都说明 dev server 本体在；
         * 只有网络层失败（reject）才算进程不在。 */
        await fetch("/api/comfy/stats", {
          cache: "no-store",
          signal: AbortSignal.timeout(2500),
        });
      } catch {
        alive = false;
      }
      if (stopped) return;
      const wasAlive = aliveRef.current;
      aliveRef.current = alive;
      if (!alive && wasAlive) {
        const now = Date.now();
        setLastRestartAt(now);
        try {
          sessionStorage.setItem(LAST_RESTART_KEY, String(now));
        } catch {
          /* sessionStorage 被禁用（隐私模式）时放弃持久化，标记仅本轮生效 */
        }
      }
      setRestarting(!alive);
      /* 首次探测完成后补读持久化的上次重启时间：setState 在异步回调里
       * 而非 effect 体（react-hooks/set-state-in-effect），且首帧保持
       * null 与 SSR 输出一致。 */
      if (!initializedRef.current) {
        initializedRef.current = true;
        setLastRestartAt((prev) => prev ?? readSavedRestartAt());
      }
    };

    void probe();
    timer = setInterval(() => void probe(), DEV_SERVER_PROBE_MS);
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  return { restarting, lastRestartAt };
}
