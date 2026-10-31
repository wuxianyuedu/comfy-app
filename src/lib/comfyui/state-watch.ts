/* ── 「ComfyUI 运行态变了」的即时推送（SSE 通道）──────────────────────
 *
 * 由来：设置页的 ComfyUI 状态行一直靠一条 5s 轮询（`setting.comfyStatus`）。
 * 轮询能对，但它答的是「此刻」而答不了「刚刚变了」——
 *
 *   · 用户点了「启动」/「关闭」，界面**本来就知道**这件事，却仍要等下一拍
 *     或等动作自己那次 `refetch` 回来；
 *   · 外部把 ComfyUI 拉起来（桌面版 / 自己的终端），最坏要等满一个间隔；
 *   · 每一拍都是一次真正的探测（进程表查询 + 端口探测，空闲 ~1s、负载下十几秒，
 *     见 07 §7.14.2），而在「什么都没变」的绝大多数时间里它白跑。
 *
 * 与存活那条链（ISSUE #1351）的关系：那条推的是**子进程退出**（真正的崩溃靠
 * 事件），本模块推的是**服务端已知的任何一次运行态变化** —— 启动动作落了锁、
 * 进程起来了、就绪了、关闭动作开始了、退出落定了。两者互补：
 * 崩溃事件只管「我亲手拉起的那个子进程退了」，答不了「外部实例起来了」
 * 与「用户刚点了启动」。
 *
 * ## 为什么事件源不是文件系统
 *
 * 「配置变更」（改 comfyuiPath / 端口 / 启动参数）看着最像 `fs.watch` 的场子，
 * 但它是**反例**：桌包里那几份配置的写入方就是本进程自己（设置页保存），
 * 监听文件等于监听自己写在纸上的东西 —— 时序、重名、原子替换（写临时文件 +
 * rename）三样都要处理，而它想回答的那件事在**动作完成的那一刻**就已经知道了。
 * 所以配置变更由**写侧**直接报（`noteComfyConfigChanged`），与运行态事件走同
 * 一条通道；跨进程改配置文件这种外部编辑**不在覆盖范围**（那由用户点「刷新」
 * 或本通道的长轮询兜底，见 `docs/standards/17-UI与逻辑分离.md` 同款取舍）。
 *
 * ## 为什么客户端与服务端各有一份实现、只共用一个载荷类型
 *
 * 心跳（`: hb`）与「长轮询 / SSE 二选一」都是**传输层**的事：浏览器侧用
 * EventSource + `fetch`，服务端侧用订阅 + 挂起的 Promise。两份实现共用同一个
 * **载荷**（`ComfyStateChange`）与同一份**服务端判决**（本模块），差异只在
 * 「帧怎么送到对方手上」——把它们强行合成一份反而要在这份里到处判宿主
 * （§18.4 三选一：本模块是纯 Node 宿主，客户端那份是 `"use client"`）。
 *
 * §18.4 三选一：本模块走**第三类（纯 Node 宿主）** —— 它被 Next 的服务端路由
 * （`/api/comfy/state`）与设置页的 tRPC 端点加载，也会被纯 Node 测试直接加载；
 * 加 `server-only` 会让同一份判决在测试里直接 throw。登记进
 * `tests/lib-node-only-declarations.test.ts` 的 `PURE_NODE_HOSTS`。
 */
import { withTimeoutResult } from "~/lib/with-timeout";

/** 一次「服务端已知的运行态变化」：序列 + 时刻 + 来源 + 说明。 */
export interface ComfyStateChange {
  /** 变化发生的时刻（毫秒）。 */
  at: number;
  /** 中文一句话，可直接进日志或状态行（不复用状态行的四态文案，避免两处文案漂）。 */
  detail: string;
  /** 什么变了（见 `ComfyStateChangeKind`）。 */
  kind: ComfyStateChangeKind;
  /** 单调纪元：每变一次 +1。客户端据此判「这是不是我没见过的那一次」。 */
  seq: number;
}

/** 变化来源。用途只有一个：诊断与断言 —— 判决本身对客户端是同形的。 */
export type ComfyStateChangeKind =
  /** 启动流程落了锁 / 拉起动作开始（进程树即将或已经变化）。 */
  | "start"
  /** 就绪判定通过（HTTP 通了）。 */
  | "ready"
  /** 关闭动作开始（用户点了「关闭 ComfyUI」）。 */
  | "stop"
  /** 进程退出落定（含崩溃与手动关闭，见 `noteComfyExit`）。 */
  | "exit"
  /** 配置变更（路径 / 端口 / 启动参数被写入）。 */
  | "config";

export type Listener = () => void;

/**
 * 订阅者集合里**存一个包装对象**，而不是直接把回调塞进 `Set`：同一个回调订阅
 * 两次时 `Set` 只留一条记录，而订阅计数是 2 —— 第一次退订就把这条回调删掉，
 * 另一个订阅者从此收不到通知（静默失效）。同一个坑与 `liveness-signal` /
 * `comfy-stats-store` 同款，三处都刻意用包装。
 */
interface Subscription {
  onChange: Listener;
}

type WatchGlobal = {
  last?: ComfyStateChange | null;
  listeners?: Set<Subscription>;
  seq?: number;
};

declare global {
  var __comfyStateWatch_v1: WatchGlobal | undefined;
}

/* HMR 单例：与 `lifecycle` / `status` / `liveness-signal` 同款 —— 模块重载后
 * 纪元与在挂的订阅者必须还在，否则一次热编译就让客户端「已见 seq」与服务端
 * 对不上（表现为变化每次都重放一遍，或者干脆不再推）。 */
const st: WatchGlobal = (globalThis.__comfyStateWatch_v1 ??= {});

/**
 * 记一次变化并通知所有订阅者。
 *
 * **不查库、不做 IO、不 await**：它会被进程退出那条路径调用，而那条路径上
 * 任何异常都不许盖掉真正的退出日志（与 `noteComfyExit` 同一条约束）。
 */
export function noteComfyStateChange(
  kind: ComfyStateChangeKind,
  detail: string,
  now = Date.now(),
): ComfyStateChange {
  const change: ComfyStateChange = {
    seq: (st.seq ?? 0) + 1,
    at: now,
    kind,
    detail,
  };
  st.seq = change.seq;
  st.last = change;
  for (const sub of st.listeners ?? []) {
    try {
      sub.onChange();
    } catch {
      /* 一个订阅者的回调抛错不得影响其它订阅者与调用方（下游是进程退出 /
       * 启动动作，异常逃出去会盖掉真正的业务日志）。 */
    }
  }
  return change;
}

/** 此刻的纪元与最近一次变化（首次连上的客户端据此判定现状）。 */
export function getComfyStateChange(): {
  last: ComfyStateChange | null;
  seq: number;
} {
  return { seq: st.seq ?? 0, last: st.last ?? null };
}

/** 订阅后续变化；返回退订函数。
 *
 * 订阅者集合**不做引用去重**（理由见上方的 `Subscription` 包装）。 */
export function subscribeComfyState(listener: Listener): () => void {
  const listeners = (st.listeners ??= new Set<Subscription>());
  const subscription: Subscription = { onChange: listener };
  listeners.add(subscription);
  return () => {
    listeners.delete(subscription);
  };
}

/**
 * 等一次变化（长轮询的等待侧）。
 *
 * `timeoutMs` 到了就返回 `null` —— 调用方据此回一个**空的 204** 并重新发起
 * 下一轮，而不是把连接一直挂着（挂死的连接在代理 / 系统休眠之后不会自愈，
 * 而「重发一次」的成本是零）。`since` 已经是旧值（在订阅之前就变过了）时
 * **立即返回**，不然客户端会白等满一个超时窗口才知道自己错过了。
 */
export function waitForComfyStateChange(
  since: number,
  timeoutMs: number,
): Promise<ComfyStateChange | null> {
  const current = st.seq ?? 0;
  const last = st.last ?? null;
  if (last !== null && current > since) {
    return Promise.resolve(last);
  }
  /* 「等一次通知、超时给 null」= 一次赛跑，出口**只有一处**
   * （`~/lib/with-timeout` 的 `withTimeoutResult`，§16.2.4.62 的 P58 硬闸）：
   * 自写 `setTimeout` + `clearTimeout` + 在回调里结算 Promise 正是它要消灭的
   * 样板 —— 而且它带「胜出即清定时器」的收尾，自己写很容易漏掉让句柄把进程
   * 钉在事件循环上（Next 的 dev 热重载与测试收尾都会被拖住）。 */
  let unsubscribe: (() => void) | null = null;
  const notified = new Promise<ComfyStateChange | null>((resolve) => {
    unsubscribe = subscribeComfyState(() => resolve(st.last ?? null));
  });
  return withTimeoutResult(notified, timeoutMs, null, {
    /* 超时也要退订 —— 不退就是每次长轮询窗口往订阅表里留一个死回调，
     * 而这张表只增不减（服务端进程活多久它就多长）。 */
    onTimeout: () => unsubscribe?.(),
  }).finally(() => unsubscribe?.());
}

/** 只给用例：清干净纪元、最近一次与订阅者，避免用例之间互相污染。 */
export function resetComfyStateWatchForTest(): void {
  st.seq = 0;
  st.last = null;
  st.listeners = new Set<Subscription>();
}
