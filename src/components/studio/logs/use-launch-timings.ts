"use client";

import { useEffect, useState } from "react";

import { fetchLaunchTimings } from "~/lib/shell/launch-timings-client";
import type { LaunchTimings } from "~/lib/shell/launch-timings";

/** 面板打开期间未取到读数时的重试间隔（#4363）：服务重启 / 接口瞬断的窗口
 * 期内也保证卡片出现，而不是「首取失败就整段生命周期隐藏」。 */
const RETRY_MS = 5000;

/**
 * 启动耗时分解的数据层（§17：取数在 lib 客户端 + hook，视图只吃 props，#4327）。
 *
 * 面板打开时取数；**没取到就按 {@link RETRY_MS} 重试，直到出现为止**（#4363：
 * 此前只取一次，dev server 重启 / 接口瞬断的那一次失败会让卡片在该次打开里
 * 永久消失，用户「没找到」）。取到即停；面板关闭（`enabled` 变 false）或卸载
 * 时停止重试。任何失败都静默——不向面板冒错误。
 */
export function useLaunchTimings(enabled: boolean): LaunchTimings | null {
  const [state, setState] = useState<LaunchTimings | null>(null);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      fetchLaunchTimings()
        .then((data) => {
          if (!alive) {
            return;
          }
          if (data) {
            setState(data);
            return;
          }
          timer = setTimeout(tick, RETRY_MS);
        })
        .catch(() => {
          if (alive) {
            timer = setTimeout(tick, RETRY_MS);
          }
        });
    };
    tick();
    return () => {
      alive = false;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [enabled]);
  return state;
}
