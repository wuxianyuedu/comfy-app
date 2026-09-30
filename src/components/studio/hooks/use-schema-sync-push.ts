"use client";

// ── 「立即同步」按钮的动作侧（底部状态栏数据库过期那一格）──
//
// 视图层不得直接 fetch（规范 §17 / check-ui-logic-separation）：这个 hook 把
// `POST /api/schema/push` 收在 hooks/ 目录里，组件只拿 `push` / `pushing`。
//
// 服务端收到请求后 spawn `scripts/db-sync.mjs --force`（用户已在确认弹窗里
// 知情），结果走既有的状态文件 → `GET /api/schema` 2s 轮询链路回到页面；
// 本 hook 不轮询结果，只管发起与在途态。

import { useCallback, useEffect, useRef, useState } from "react";

/** 「立即同步」的发起侧：`push` 幂等可重复调用（服务端有并发守卫）。 */
export function useSchemaSyncPush(): {
  push: () => Promise<void>;
  pushing: boolean;
} {
  const [pushing, setPushing] = useState(false);
  const stoppedRef = useRef(false);

  /* 卸载守卫：请求回来时组件可能已卸载（页签切走），别再 setState。 */
  useEffect(() => {
    stoppedRef.current = false;
    return () => {
      stoppedRef.current = true;
    };
  }, []);

  const push = useCallback(async () => {
    if (stoppedRef.current) return;
    setPushing(true);
    try {
      /* 结果不在这里消费：成败都会经状态文件反映到轮询到的相位上
       * （失败时相位仍是 stale/missing，提示格原样给出原因）。 */
      await fetch("/api/schema/push", { method: "POST" });
    } catch {
      /* 网络层失败同理：下一次轮询（2s）会把真实状态带回来。 */
    } finally {
      if (!stoppedRef.current) setPushing(false);
    }
  }, []);

  return { push, pushing };
}
