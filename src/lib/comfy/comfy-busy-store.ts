"use client";

// ── 「ComfyUI 此刻忙不忙」的全页单点持有者（ISSUE #1351）──────────────
//
// 为什么需要这一份状态：`~/lib/comfyui/liveness` 的分阶段频率里有一档是
// 「出图 / 队列执行中 → 降到 30s」，理由是 `/system_stats` 内部会调
// `torch.cuda.mem_get_info` —— GPU 满载时探它等于往已经排队的 aiohttp 里
// 再插请求，既拖慢出图又更容易触发超时假阳性。要按这一档降压，系统指标的
// **持有者**（`comfy-stats-store`）就必须知道「现在忙不忙」。
//
// 而「忙不忙」的事实来自另一条通道（`/api/comfy/queue`，`use-comfy-queue`
// 每 2s 一拉）。两条通道各有自己的持有者，谁都不该去 import 对方的 hook
// （那会把「谁先挂载」变成隐式依赖）。于是像 `offline-gate` / `poll-timer`
// 一样：**判据本体放 `src/lib`，两侧都只读写这一份**。
//
// 语义刻意保持极窄 —— 只有一个布尔。这里不放队列长度、不放进度：那些是
// 「展示需求」（要 2s 刷新的是 UI 上的数字），与「存活判断需求」是两件事，
// 混在一个 store 里会让人以为降压就等于不展示进度（进度走 WS 推送，零成本）。

type Listener = () => void;

type BusyGlobal = {
  state?: { busy: boolean; since: number };
  listeners?: Set<Listener>;
};

declare global {
  var __comfyBusy_v1: BusyGlobal | undefined;
}

/* HMR 单例：模块重载后「忙不忙」不该被重置成「闲」——那会让刚降压的系统指标
 * 探针立刻恢复高频，正好打在最忙的时刻。 */
const st: BusyGlobal = (globalThis.__comfyBusy_v1 ??= {});

/** 判「忙」的迟到窗口：队列从「有活儿」翻成「没活儿」时立刻解除降压会让
 *  「刚出完一张、下一张还在排队」的间隙反复切换 —— 出图是连续提交的，
 *  用一小段黏滞把它压平。
 *
 *  **只对「忙 → 闲」这一向生效**：反向（闲 → 忙）必须立即生效，否则高峰期
 *  的头几秒仍在用 4s 高频探它。 */
export const COMFY_BUSY_HOLD_MS = 5_000;

type BusyState = { busy: boolean; since: number };

/* 状态与订阅者都挂在全局单例上（`st`）：HMR 重载后「忙不忙」不该被重置成
 * 「闲」——那会让刚降压的系统指标探针立刻恢复高频，正好打在最忙的时刻。
 * 用 `globalThis` 而不是模块级 `let`，手法与 `lifecycle` / `status` 同款。 */
function state(): BusyState {
  return (st.state ??= { busy: false, since: 0 });
}

function listeners(): Set<Listener> {
  return (st.listeners ??= new Set<Listener>());
}

function notify(): void {
  for (const l of listeners()) l();
}

/**
 * 队列通道每拉到一次状态就喂进来。
 *
 * `busy` 的取值口径由调用方决定（本应用在跑 / ComfyUI 自己排着队都算忙）——
 * 这里只负责「黏滞 + 通知」，不重新判一遍。
 */
export function noteComfyBusy(busy: boolean, now = Date.now()): void {
  const s = state();
  if (busy) {
    if (s.busy) return;
    st.state = { busy: true, since: now };
    notify();
    return;
  }
  /* 转闲要过黏滞窗口：窗口内仍视为忙（见 COMFY_BUSY_HOLD_MS）。
   * `since` 记的是「开始忙」的时刻，不是「上一次喂 true」的时刻 —— 否则
   * 连续喂 true 会不断把窗口往后推，忙完之后要再等满 5s 才肯转闲。 */
  if (!s.busy) return;
  if (now - s.since < COMFY_BUSY_HOLD_MS) return;
  st.state = { busy: false, since: now };
  notify();
}

/** 此刻是否算忙（供系统指标的持有者决定轮询档位）。 */
export function getComfyBusy(): boolean {
  return state().busy;
}

/** 订阅「忙不忙」的变化；返回退订函数。
 *
 * 每条订阅各持自己的包装（与 `comfy-stats-store` 同款理由：同一个回调订阅两次
 * 时 Set 只留一条而计数是 2，第一次退订就把另一个订阅者一起摘掉）。 */
export function subscribeComfyBusy(onChange: Listener): () => void {
  const set = listeners();
  set.add(onChange);
  return () => {
    set.delete(onChange);
  };
}

/** 只给用例：清干净状态与订阅者。 */
export function resetComfyBusyStoreForTest(): void {
  st.state = { busy: false, since: 0 };
  st.listeners = new Set<Listener>();
}
