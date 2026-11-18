"use client";

import { useEffect, useState } from "react";

import { fetchLaunchTimings } from "~/lib/shell/launch-timings-client";
import type { LaunchTimings } from "~/lib/shell/launch-timings";

/**
 * 启动耗时分解的数据层（§17：取数在 lib 客户端 + hook，视图只吃 props，#4327）。
 *
 * 面板打开时取**一次**：这份读数是编排器的最后一份快照，启动结束后不再变化；
 * 重新启动后再次打开面板会重新取，自然拿到最新一次的分解。失败（纯浏览器
 * 开发、文件还没写、接口不在、fetch 形态不对）静默回 null——卡片整卡隐藏，
 * 不弹错误扰人。
 */
export function useLaunchTimings(enabled: boolean): LaunchTimings | null {
  const [state, setState] = useState<LaunchTimings | null>(null);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let alive = true;
    fetchLaunchTimings()
      .then((data) => {
        if (alive && data) {
          setState(data);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [enabled]);
  return state;
}
