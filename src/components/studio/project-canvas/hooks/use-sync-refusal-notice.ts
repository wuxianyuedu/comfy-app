"use client";

/**
 * 「这份画布没能进服务端」的用户可见出口（规范 17 §17.2 第②层）。
 * 必须挂载时读一次 + 订阅后续变化：emitAppEvent 不排队重放，只订阅会漏掉先发生的拒收。
 * 去重键带上文案而非只带 id：自动保存每 500ms 撞一次，原因变了要重新提示。
 */

import { useEffect, useRef } from "react";

import { subscribeAppEvent } from "~/lib/app-events";
import { listSyncNotices } from "~/lib/project-canvas/sync-notice";
import { useToast } from "../../ToastProvider";

/**
 * 拒收提示的停留时间（毫秒）。默认的 3.2s 是给「已经保存」这类回执用的；
 * 这一句是**要照着做的**（画布只在本地存住了，得改名字或换 id），
 * 所以按 `useToast` 里 `duration` 那个参数的口径给一档长的。
 */
const REFUSAL_TOAST_MS = 12_000;

export function useSyncRefusalNotice(): void {
  const toast = useToast();
  /** 已经提示过的「画布 + 原因」，用于去重。 */
  const shown = useRef<Array<string>>([]);

  useEffect(() => {
    const flush = () => {
      for (const notice of listSyncNotices()) {
        /* 键用 JSON 而不是分隔符拼接：项目名与原因文案都可能含任意字符，
         * 拼出来的键会碰撞（`a|b` 与 `a|`+`b` 同形）——那是「两条不同拒收
         * 只提示一条」这种很难复现的表现。 */
        const key = JSON.stringify([notice.projectId, notice.detail]);
        if (shown.current.includes(key)) {
          continue;
        }
        shown.current = [...shown.current, key];
        toast.error(
          `画布「${notice.projectName}」没有同步到服务端`,
          notice.detail,
          REFUSAL_TOAST_MS,
        );
      }
    };
    flush();
    return subscribeAppEvent("comfyapp:canvas-sync-changed", flush);
  }, [toast]);
}
