/* ── 进程退出事件 → 客户端的**即时**存活信号（ISSUE #1351）─────────────
 *
 * 「真正的崩溃靠事件，不靠轮询」这条要落地，缺的不是判决（那在
 * `./liveness`），而是**事件的通路**：
 *
 *     子进程 exit 事件（毫秒级，`lifecycle-wait.ts` 的 createChildExitHandler）
 *        ↓ noteComfyExit()
 *     本模块（进程内信号 + 单调纪元）
 *        ↓ SSE（`~/app/api/comfy/liveness/route.ts`）
 *     客户端（`~/lib/comfy/comfy-liveness-client`）
 *        ↓ 立刻做一次 HTTP 复核
 *     状态切换（且要过 `createCrashLatch` 的连续 3 次门槛）
 *
 * 为什么需要这一层而不是直接让客户端看轮询结果：子进程句柄在**服务端**
 * （Next 进程 / sidecar 里），浏览器侧拿不到 `child.on("exit")`。信号必须先
 * 在服务端被记下来、再推出去。
 *
 * 为什么用「单调纪元 + 订阅」而不是直接回传事件对象：SSE 客户端可能在崩溃
 * 发生后**才**连上来（用户刚打开页面），此时它必须能立刻知道「上一拍已经崩过
 * 一次」，而不是干等下一轮。纪元（`seq`）让「我读到的是什么时刻的结论」可判，
 * 也让断线重连后的补发有依据。
 *
 * §18.4 三选一：本模块走**第三类（纯 Node 宿主）** —— 它由 Next 的服务端
 * 路由与测试加载，既不需要 `server-only`（加了会让同一份判决在纯 Node 测试里
 * 直接 throw），也没有 `.server.ts` 要拆的纯逻辑姐妹模块：判决已经在
 * `./liveness` 里了。登记进 `tests/lib-node-only-declarations.test.ts`。
 */
import type { ComfyExitReport } from "./lifecycle-exit";

/** 一次「进程退出」事件。 */
export interface ComfyLivenessSignal {
  /** 单调纪元：每记一次退出 +1。客户端据此判「这是不是我没见过的那一次」。 */
  seq: number;
  /** 记录时刻（毫秒）。 */
  at: number;
  /** 退出原因摘要（`describeComfyExit` 的一句话结论），供提示文案用。 */
  reason: string;
  /** 退出是否由用户主动关闭触发。**主动关闭不是崩溃** —— 客户端据此跳过
   *  「崩溃复核」那一条（我们自己让它退的，不需要再探一次证明它没了）。 */
  userStopped: boolean;
}

/** 此刻的信号快照（无订阅者时也要能读 —— 客户端首次连上就得知道现状）。 */
export interface ComfyLivenessSnapshot {
  seq: number;
  last: ComfyLivenessSignal | null;
}

type Listener = (signal: ComfyLivenessSignal) => void;

/**
 * 订阅者集合里**存一个包装对象**，而不是直接把回调塞进 `Set`：同一个回调订阅
 * 两次时 `Set` 只留一条记录，而订阅计数是 2 —— 第一次退订就把这条回调删掉，
 * 另一个订阅者从此收不到通知（静默失效）。同一个坑与
 * `comfy-stats-store` 的 `Subscription` 同款，两处都刻意用包装。
 */
interface Subscription {
  onChange: Listener;
}

type SignalGlobal = {
  seq?: number;
  last?: ComfyLivenessSignal | null;
  listeners?: Set<Subscription>;
};

declare global {
  var __comfyLivenessSignal_v1: SignalGlobal | undefined;
}

/* HMR 单例：与 lifecycle / status 的 `globalThis` 手法同款 —— 模块重载后
 * 订阅者与纪元必须还在（否则一次 HMR 就把「上一拍崩过」这件事忘了）。 */
const st: SignalGlobal = (globalThis.__comfyLivenessSignal_v1 ??= {});

/** 记一次进程退出（**只由 exit 事件路径调用**）。
 *
 * 返回这次记下的信号，便于调用方把它并进自己那一行日志 —— 本函数不再另开
 * 日志通道（退出原因已经由 `createChildExitHandler` 落过横幅与 `[exit]` 行，
 * 在这里重打一遍是噪声）。
 */
export function noteComfyExit(report: ComfyExitReport): ComfyLivenessSignal {
  const signal: ComfyLivenessSignal = {
    seq: (st.seq ?? 0) + 1,
    at: Date.now(),
    reason: report.reason,
    /* `describeComfyExit` 的判据顺序把「用户主动关闭」放在最前，所以这一项
     * 就是它的 reason —— 不再在两边各抄一份字符串常量（抄错了会静默把
     * 「用户关的」判成崩溃）。 */
    userStopped: report.reason === "用户主动关闭",
  };
  st.seq = signal.seq;
  st.last = signal;
  for (const subscription of st.listeners ?? []) {
    try {
      subscription.onChange(signal);
    } catch {
      /* 一个订阅者的回调抛错不得影响其它订阅者与退出路径本身：
       * 这里在下游是进程退出事件，异常逃出去会盖掉真正的退出日志。 */
    }
  }
  return signal;
}

/** 此刻的纪元与最近一次退出（首次连上的客户端据此判定现状）。 */
export function getLivenessSnapshot(): ComfyLivenessSnapshot {
  return { seq: st.seq ?? 0, last: st.last ?? null };
}

/** 订阅后续的退出事件；返回退订函数。
 *
 * 订阅者集合**不做引用去重**（与 `comfy-stats-store` 的 `Subscription` 包装
 * 同款的理由：同一个回调订阅两次时 Set 只留一条，而计数是 2 —— 第一次退订
 * 就把另一个订阅者一起摘掉，静默失效）。这里的每条订阅各自持有自己的包装。
 */
export function subscribeComfyExit(listener: Listener): () => void {
  const listeners = (st.listeners ??= new Set<Subscription>());
  const subscription: Subscription = { onChange: listener };
  listeners.add(subscription);
  return () => {
    listeners.delete(subscription);
  };
}

/** 只给用例：清干净纪元、最近一次与订阅者，避免用例之间互相污染。 */
export function resetComfyLivenessSignalForTest(): void {
  st.seq = 0;
  st.last = null;
  st.listeners = new Set<Subscription>();
}
