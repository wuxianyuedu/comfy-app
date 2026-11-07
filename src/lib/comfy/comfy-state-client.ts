"use client";

// ── 「ComfyUI 运行态变了」的客户端一半（长轮询）──────────────────────
//
// 服务端那条通道（`/api/comfy/state`）在变化发生的那一刻把通知挂到已连上的人
// 手上；这里只做三件事：**计数在挂的订阅**、按 `since` 发请求、把「刚变了一次」
// 这个一次性事实交给订阅者。
//
// 为什么按「有没有人订阅」开关而不是进页面就常连：设置页是唯一的状态出口，
// 而这条通道的用途就是替掉它的 5s 一拍。没人看的时候挂着一条长轮询连接，
// 等于把「省下来的探测」换成「永远占着的连接」——两者都不该在没人看时发生。
//
// 与 `comfy-liveness-client`（SSE 那条）的分工：那条推**子进程退出**，是存活
// 链的一部分，只在上层订阅时连；这条推**服务端已知的任何变化**（启动 / 就绪 /
// 关闭 / 退出 / 配置），只服务设置页。两者消息不共用一个 `seq`，
// 也**不做去重合并** —— 各自消费各自的，重复的结论由「重新问一次状态」吸收。
//
// 去重按 `seq`：这一层是「单调纪元」的统一手法（与 `liveness-signal` 同款）。
// 断线重连 / 睡醒重来都会重新把当前快照发一遍，不去重就等于每次重连都白做一次
// 状态查询。

import { startPollTimer } from "~/lib/poll-timer";
import { isRecord } from "~/lib/is-record";
import type { ComfyStateChange } from "~/lib/comfyui/state-watch";

/** 单次长轮询的请求上限：比服务端的窗口（25s）宽一点，只兜住病态挂死的连接。 */
const REQUEST_TIMEOUT_MS = 35_000;

export type Listener = (change: ComfyStateChange) => void;

type StateClientGlobal = {
  listeners?: Set<Listener>;
  /** 在途请求的身份：迟到的回包不许再触发下一轮（否则会与新轮次打架）。 */
  runId?: number;
  seenSeq?: number;
  stop?: (() => void) | null;
};

declare global {
  var __comfyStateClient_v1: StateClientGlobal | undefined;
}

/* HMR 单例：`seenSeq` 必须跨模块重载存活 —— 重置成 0 会让重连补发的同一个
 * `seq` 又被当成新事件，白做一次状态查询。 */
const st: StateClientGlobal = (globalThis.__comfyStateClient_v1 ??= {});

const listeners = new Set<Listener>();

/** 合法来源白名单：与服务端 `ComfyStateChangeKind` 的取值保持一致。 */
const STATE_CHANGE_KINDS: ReadonlyArray<ComfyStateChange["kind"]> = [
  "start",
  "ready",
  "stop",
  "exit",
  "config",
];

function isStateChangeKind(value: unknown): value is ComfyStateChange["kind"] {
  return typeof value === "string" && STATE_CHANGE_KINDS.some((kind) => kind === value);
}

/** 帧形状收窄：外部输入，逐字段判型。 */
function parseChange(raw: unknown): ComfyStateChange | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (
    typeof raw.seq !== "number" ||
    !Number.isFinite(raw.seq) ||
    typeof raw.at !== "number" ||
    !isStateChangeKind(raw.kind) ||
    typeof raw.detail !== "string"
  ) {
    return null;
  }
  return {
    seq: raw.seq,
    at: raw.at,
    kind: raw.kind,
    detail: raw.detail,
  };
}

function deliver(change: ComfyStateChange): void {
  const seen = st.seenSeq ?? 0;
  if (change.seq <= seen) {
    return;
  }
  st.seenSeq = change.seq;
  for (const listener of listeners) {
    listener(change);
  }
}

/**
 * 订阅服务端的变化通知（幂等：多次调用共用一条长轮询链）。返回退订函数，
 * 最后一个订阅者退订即停表。
 */
export function subscribeComfyStateChanges(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    start();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stop();
    }
  };
}

/**
 * 起一条长轮询链。
 *
 * 用 `startPollTimer` 而不是自己 `while (true)`：**它已经把「切后台暂停、
 * 回前台立刻补一次」做完了**（§16.2.4.15 的 P12 硬闸收口）—— 挂着窗口跑
 * 几十秒的长轮询，用户切走时该立刻停下（那条请求还挂在服务端），切回来时
 * 该立刻问一次「我不在的时候变了没」。这正是该原语的语义，重写一遍只会漂。
 *
 * `ms` **必须是函数形态**，且返回 `0`（「立刻再跑一拍」）。写死数字 `0` 不行：
 * 那个原语把**定值** `0` 与 `null` 一并当成「不轮询」（`ms <= 0` 直接返回空停表
 * —— 实测这条会静默什么都不发，界面上表现为「状态再也不更新」）。函数形态
 * 返回 `0` 才是它唯一表达的「立刻再来」；而 `0` 在这里因为**本拍跑完才排下一拍**
 * （请求本身就是等待）不会成为忙等。
 */
function start(): void {
  if (st.stop) {
    return;
  }
  const runId = (st.runId = (st.runId ?? 0) + 1);
  st.stop = startPollTimer(
    async () => {
      /* 已经换过一条链（退订又订阅）：这一拍的结果与下一拍都不该再落下。 */
      if (st.runId !== runId) {
        return null;
      }
      const change = await pollOnce();
      if (change !== null && st.runId === runId) {
        deliver(change);
      }
      /* 回来就立刻再发一轮：长轮询的「等」在服务端，客户端这边不该再加延迟。 */
      return 0;
    },
    {
      ms: () => 0,
      immediate: true,
      /* 本文件在 `src/lib`，那里不许直接 `console.*`（`tests/single-logger-channel`
       * 硬闸）。而这条通道**本来就不需要日志**：`pollOnce` 把网络错误与坏帧都
       * 吞成「这一轮没有变化」——能走到这里的只剩编程错误，而下一次 HTTP 请求
       * 本身就是「我刚怎么死的」最快的证据（长轮询会立刻重发）。真需要排查时
       * 打开 Network 面板就能看到全部往返，比一行被吞掉的 console 更完整。 */
      onError: () => undefined,
    },
  );
}

function stop(): void {
  st.stop?.();
  st.stop = null;
  /* `runId` 不重置：留在原值上，让在途那一拍的回包认得出自己已经过期。 */
  st.runId = (st.runId ?? 0) + 1;
}

/** 一次长轮询请求：204 = 没有变化，返回 null（调用方继续等）。 */
async function pollOnce(): Promise<ComfyStateChange | null> {
  let res: Response;
  try {
    res = await fetch(`/api/comfy/state?since=${st.seenSeq ?? 0}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    /* 断网 / 超时 / 服务还在起：静默降级到下一轮。这条通道只是「更快的通知」，
     * 它坏了不该在界面上说话 —— 兜底是设置页那次重新问状态，而不是这里 */
    return null;
  }
  if (res.status === 204) {
    return null;
  }
  if (!res.ok) {
    return null;
  }
  try {
    return parseChange(await res.json());
  } catch {
    /* 坏帧不影响后续：一条解析不了的载荷不该把整条链拖死。 */
    return null;
  }
}

/** 只给用例：复位订阅者、已见纪元与在跑的链。 */
export function resetComfyStateClientForTest(): void {
  st.stop?.();
  st.stop = null;
  st.runId = (st.runId ?? 0) + 1;
  st.seenSeq = 0;
  listeners.clear();
}
