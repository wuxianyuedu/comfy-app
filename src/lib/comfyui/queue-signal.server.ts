/* ── 全局队列变化事件 → 客户端（事件为主、轮询兜底，ISSUE #1351 同族）────────
 *
 * 与 `liveness-signal` 同源但更轻：队列状态没有「单调纪元」需求（客户端收到事件后
 * 直接去 `/api/comfy/queue` 拉最新一帧，自然就是当前态），所以这里只做一件事——
 * 把「队列可能变了」这件事**服务端检测 + 推出去**。
 *
 * 为什么是「服务端 diff」而不是「生产者 emit」：
 *   · 队列状态有两个来源——本应用 `task` 表的行（submit/start/finish/cancel 散在
 *     `repository-task-impl` 多处，hook 进去容易漏一处就 stale）+ ComfyUI 自己的
 *     `/queue`（ComfyUI 不会主动推给我们，只能我们探）。两者都得靠轮询才能发现
 *     变化，于是把轮询收在这一个共享循环里，比在 N 个生产者处各插一针更不容易漏。
 *   · 多个 SSE 连接**共享同一个** 2s diff 循环（挂在 globalThis，HMR 不丢），而不是
 *     每连一个客户端就多打一遍 ComfyUI——比起「每标签各轮询一次」这是净减少。
 *
 * 帧形态（与 `/api/comfy/liveness` 同款 SSE）：连上时先推一帧让客户端立刻拉一次，
 * 之后只在 diff 出变化时才推 `data: {"changed":true,"at":…}`；`: hb` 注释行每 15s
 * 一次保活。客户端据此再打一次 `/api/comfy/queue` 拉真值（store 内部 `pollOnce`）。
 */

import { collectComfyQueueStatus } from "./queue-status.server";
import { fireAndForget } from "~/lib/async-action";
import type { ComfyQueueStatus } from "./queue-status-types";

/** 服务端 diff 节奏：与旧客户端 2s 轮询同频，保证 ComfyUI 全局队列的变化延迟不退化。 */
const QUEUE_EVENTS_POLL_MS = 2000;

export type Listener = () => void;
type Subscription = {
  onChange: Listener;
};

type QueueSignalGlobal = {
  inflight?: boolean;
  lastSerialized?: string | null;
  listeners?: Set<Subscription>;
  timer?: ReturnType<typeof setInterval> | null;
};

declare global {
  var __comfyQueueSignal_v1: QueueSignalGlobal | undefined;
}

/* HMR 单例：模块重载后订阅者与 diff 循环必须还在（否则一次 HMR 就把「上一拍状态」
 * 忘了，重连的客户端得干等下一轮变化）。与 liveness / status 的 `globalThis` 手法同款。 */
const st: QueueSignalGlobal = (globalThis.__comfyQueueSignal_v1 ??= {});

async function tick(): Promise<void> {
  if (st.inflight === true) {
    return;
  }
  st.inflight = true;
  try {
    const status: ComfyQueueStatus = await collectComfyQueueStatus();
    const serialized = JSON.stringify(status);
    /* 只在「真变了」时才通知：progress / nodeType 在出图期频繁跳动，但 diff 循环
     * 本身每 2s 才比一次，所以事件频率被钉在 ≤1/2s（不会比旧的 2s 轮询更密），
     * 而空闲（无变化）时一帧都不发 —— 这正是把「轮询」换成「事件」的收益。 */
    if (serialized !== st.lastSerialized) {
      st.lastSerialized = serialized;
      const snapshot = st.listeners ? [...st.listeners] : [];
      for (const sub of snapshot) {
        try {
          sub.onChange();
        } catch {
          /* 单个订阅者回调抛错不得影响其余订阅者与 diff 循环本身。 */
        }
      }
    }
  } catch {
    /* 探测失败不动基线：保留上一拍，下个周期再试（瞬时 ComfyUI 抖动不该把
     * 事件通道搞挂）。 */
  } finally {
    st.inflight = false;
  }
}

function ensureTimer(): void {
  if (st.timer !== null && st.timer !== undefined) {
    return;
  }
  st.timer = setInterval(() => {
    // tick 内部已吞掉 `collectComfyQueueStatus` 的瞬时抖动（见 tick 的 catch），
    // 这里 fireAndForget 的 onError 实际不触发；用收口形态取代散落的 `void tick()`。
    fireAndForget(tick(), () => undefined);
  }, QUEUE_EVENTS_POLL_MS);
}

function stopTimer(): void {
  if (st.timer !== null && st.timer !== undefined) {
    clearInterval(st.timer);
  }
  st.timer = null;
}

/** 订阅队列变化；返回退订函数。首个订阅者拉起共享 diff 循环，最后一个退订即停。 */
export function subscribeQueueChanged(listener: Listener): () => void {
  const listeners = (st.listeners ??= new Set<Subscription>());
  const subscription: Subscription = { onChange: listener };
  listeners.add(subscription);
  ensureTimer();
  return () => {
    listeners.delete(subscription);
    if (listeners.size === 0) {
      stopTimer();
    }
  };
}

/** 只给用例：清干净循环、订阅者与基线，避免用例之间互相污染。 */
export function resetQueueChangedSignalForTest(): void {
  stopTimer();
  st.listeners = new Set<Subscription>();
  st.lastSerialized = null;
  st.inflight = false;
}
