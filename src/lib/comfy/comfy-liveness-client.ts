"use client";

// ── ComfyUI **进程退出事件**的客户端订阅（ISSUE #1351 第②层网络部分）──
//
// 服务端那条 SSE 通道（`/api/comfy/liveness`）把「服务端子进程死了」这件事
// **主动推**过来；这里只做三件事：解析帧、按 `seq` 去重、把「刚崩了一次」
// 这个一次性事实交给订阅者。
//
// 为什么要有「一次性脉冲」而不是一个持续为真的 `crashed` 标志：崩溃是**事件**，
// 不是**状态**。状态（现在到底活着没有）只能由一次 HTTP 复核给出 —— 收到脉冲
// 之后立刻探一次、拿复核结果切状态。把 `crashed=true` 直接当状态用，会在
// 「进程被拉起又活了」时永远翻不回来，也绕过了「连续 3 次失败才判 crash」。
//
// 去重按 `seq`：SSE 断线重连时服务端会**补发当前快照**，不去重就等于每次重连
// 都白做一次复核（更要紧的是，会让连续失败计数被同一件事反复喂）。
//
// 不使用 EventSource 的 `lastEventId`：服务端补的是**当前**快照，不是事件回放，
// 语义上「我见过多大的 seq」这一条由客户端自己记更直接（也少一层协议约定）。

import type { ComfyLivenessSignal } from "~/lib/comfyui/liveness-signal";

/** 帧形状收窄：SSE 载荷是外部输入，逐字段判型，不做类型断言。 */
function parseSignal(raw: unknown): ComfyLivenessSignal | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.seq !== "number" ||
    !Number.isFinite(o.seq) ||
    typeof o.at !== "number" ||
    typeof o.reason !== "string"
  ) {
    return null;
  }
  return {
    seq: o.seq,
    at: o.at,
    reason: o.reason,
    userStopped: o.userStopped === true,
  };
}

type Listener = (signal: ComfyLivenessSignal) => void;

type LivenessClientGlobal = {
  seenSeq?: number;
  listeners?: Set<Listener>;
  es?: EventSource | null;
};

declare global {
  var __comfyLivenessClient_v1: LivenessClientGlobal | undefined;
}

/* HMR 单例：`seenSeq` 必须跨模块重载存活 —— 重置成 0 会让重连补发的同一个
 * `seq` 又被当成新事件，白做一次复核并污染连续失败计数。 */
const st: LivenessClientGlobal = (globalThis.__comfyLivenessClient_v1 ??= {});

const listeners = new Set<Listener>();

function deliver(signal: ComfyLivenessSignal): void {
  const seen = st.seenSeq ?? 0;
  if (signal.seq <= seen) return;
  st.seenSeq = signal.seq;
  /* 用户主动关闭不是崩溃：不派发脉冲。客户端不必为「我们自己让它退的」再探一次
   * 证明它没了 —— 那个结论调用方本来就有（它点了关闭）。 */
  if (signal.userStopped) return;
  for (const l of listeners) l(signal);
}

/** 建立订阅（幂等：多次调用共用一条 EventSource）。返回退订函数。 */
export function subscribeComfyCrashes(listener: Listener): () => void {
  listeners.add(listener);
  ensureConnected();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) disconnect();
  };
}

function ensureConnected(): void {
  if (st.es) return;
  if (typeof EventSource === "undefined") return;
  try {
    const es = new EventSource("/api/comfy/liveness");
    es.onmessage = (ev: MessageEvent<string>) => {
      try {
        const signal = parseSignal(JSON.parse(ev.data));
        if (signal !== null) deliver(signal);
      } catch {
        /* 坏帧不影响后续：一条解析不了的载荷不该把整条订阅拖死。 */
      }
    };
    st.es = es;
  } catch {
    /* 构造失败（SSE 不受支持等）：静默降级 —— 存活仍由轮询兜底，
     * 「事件为主、轮询兜底」里的兜底那一半就是为这种情况留的。 */
    st.es = null;
  }
}

function disconnect(): void {
  st.es?.close();
  st.es = null;
}

/** 只给用例：复位订阅者、已见纪元与连接。 */
export function resetComfyLivenessClientForTest(): void {
  disconnect();
  st.seenSeq = 0;
  listeners.clear();
}
