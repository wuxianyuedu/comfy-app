"use client";

/**
 * 「这份画布没能进服务端」的**用户可见出口**（规范 17 §17.2 第②层）。
 *
 * 为什么单独成一个 hook：写镜像的入口**不止画布那一页** —— 工作区首页的
 * 「新建项目」、`ProjectGate` 的重名新建、「所有项目」那一屏的删除，都会发
 * `vanillaApi.project.*` 并可能被服务端明确拒收。此前这段逻辑长在
 * `use-project-persistence` 里（只有画布挂载它），于是画廊那一屏删除失败时
 * 广播发出去**没人接**，而 `emitAppEvent` 承诺不排队重放 ⇒ 那条拒收永远看不见
 * （「删了没反应」——用户只会以为按钮坏了）。
 *
 * 两条通道都要，缺一不可：
 *   · **挂载时先读一次状态** —— 状态在 `~/lib/project-canvas/sync-notice` 里可查，
 *     而写它的页面可能**没有**这个提示器。只订阅事件的读侧必然漏掉那一次；
 *   · **订阅后续变化** —— 用户在画布上改动触发的自动保存，拒收发生在挂载之后。
 *
 * 提示按「同一条画布的同一句原因」去重：自动保存每 500ms 就会再撞一次，
 * 不去重会把界面刷成一串同样的 toast；而**原因变了**（改了名字之后变成另一条
 * 拒收理由）要重新说一次，所以去重的键带上文案而不是只带 id。
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
  const shown = useRef<string[]>([]);

  useEffect(() => {
    const flush = () => {
      for (const notice of listSyncNotices()) {
        /* 键用 JSON 而不是分隔符拼接：项目名与原因文案都可能含任意字符，
         * 拼出来的键会碰撞（`a|b` 与 `a|`+`b` 同形）——那是「两条不同拒收
         * 只提示一条」这种很难复现的表现。 */
        const key = JSON.stringify([notice.projectId, notice.detail]);
        if (shown.current.includes(key)) continue;
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
