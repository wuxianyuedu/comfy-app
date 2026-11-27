// ── 共享 ResizeObserver：N 个读数点收敛成 1 个 observer + 一批一次 rAF ──
//
// 此前 `TruncatedText` / `useElementBox` 每个实例各自 new 一个 ResizeObserver，
// 各自套一层 rAF。长列表里几十上百个实例就是同数量的观察者与帧调度；
// 窗口缩放 / 侧栏折叠时它们在同一帧里各自触发一次布局量测。
//
// 这里只收「何时读」：一个模块级 observer 持有 Element → 回调集合，
// 一批回调只排一次 `onNextFrame`（一帧出口见 ~/lib/next-frame）。
// 挂载首帧的同步 measure 仍由各调用点自己做（契约：首帧就量），本模块只
// 接管后续尺寸变化。

import { onNextFrame, type CancelNextFrame } from "~/lib/next-frame";

/** 读数回调的类型。导出以便 typedoc 收进文档：被导出函数的签名引用却不导出的
 *  类型会触发「referenced but not included」warning，API 文档自检把任何 warning 判红。 */
export type Listener = () => void;

/** Element → 该元素上的全部读数回调。observer 本身只保留一份。 */
const listeners = new Map<Element, Set<Listener>>();
let observer: ResizeObserver | null = null;
/** 记录当初用的构造器：测试桩 / HMR 换掉全局时重建单例，避免旧实例残留。 */
let observerCtor: typeof ResizeObserver | null = null;
let scheduled: CancelNextFrame | null = null;

function flush(): void {
  scheduled = null;
  /* flush 期间回调可能顺手注销自己（卸载），先展开快照再逐个调用。 */
  const pending: Array<Listener> = [];
  for (const set of listeners.values()) {
    for (const cb of set) {
      pending.push(cb);
    }
  }
  for (const cb of pending) {
    cb();
  }
}

function schedule(): void {
  if (scheduled !== null) {
    scheduled();
  }
  scheduled = onNextFrame(flush);
}

function ensureObserver(): void {
  const ctor: typeof ResizeObserver | null =
    typeof ResizeObserver === "undefined" ? null : ResizeObserver;
  if (ctor === null) {
    return;
  }
  if (observer !== null && observerCtor === ctor) {
    return;
  }
  /* 构造器变了：丢掉旧实例与它名下的订阅，按新构造器重来。 */
  observer?.disconnect();
  listeners.clear();
  observer = new ctor(() => {
    schedule();
  });
  observerCtor = ctor;
}

/**
 * 把一个读数回调挂到共享 observer 上，返回注销函数。
 * 不可用的环境（jsdom / 老浏览器）返回空注销函数，调用点的首帧同步量测
 * 已经覆盖那一种退化。
 */
export function observeElementResize(el: Element, callback: Listener): () => void {
  ensureObserver();
  if (observer === null) {
    return () => undefined;
  }
  let set = listeners.get(el);
  if (set === undefined) {
    set = new Set<Listener>();
    listeners.set(el, set);
    observer.observe(el);
  }
  set.add(callback);
  return () => {
    set.delete(callback);
    if (set.size === 0) {
      listeners.delete(el);
      /* 测试桩 / 老实现可能只有 observe + disconnect，没有 unobserve。 */
      observer?.unobserve?.(el);
    }
  };
}
