"use client";

/**
 * SlotOutlet —— 「把子树渲染到别处的一个落点」的全库唯一实现（规范 §12.18）。
 *
 * 要治的形态：某块 UI 在结构上该待在**另一处**（窗口顶栏、标题行、状态栏），
 * 但它的状态与处理器长在**当前这棵子树**上 —— 于是只能「传渲染好的子树，不传数据」。
 * `createPortal` 能做这件事，但它是 `react-dom` 的 API：散在视图层里各写一遍，
 * 就没人说得清「这项目里哪些地方在传送、为什么」；`ui/` 这一层收一次之后，
 * 视图只表达意图（`<SlotContent outlet=…>…</SlotContent>`）。
 *
 * 与 `ui/dialog` / `ui/popover` 的分工：那几个是**浮层**（有自己的定位、遮罩、
 * 焦点锁），本件是**结构**（被传送的内容就是宿主那一处的普通子节点，不浮、
 * 不遮、不抢焦点）。所以它不提供任何浮层能力 —— 要浮层请用那几个基元。
 *
 * 三条边界：
 *   · **没挂落点时原地渲染**（或不渲染，由调用方经 `fallback` 决定）：Storybook、
 *     组件用例、`AppShell` 之外的独立路由页都没有宿主，这条是它们不崩的前提；
 *   · **只在客户端传送**：SSR 没有 DOM，`createPortal` 会直接抛。判据走
 *     `useSyncExternalStore`（服务端 `false`、客户端 `true`），与
 *     `use-title-bar-tabs-active` 那个壳探测同一套出口 —— 用
 *     `useEffect` + `setState` 会被 `react-hooks/set-state-in-effect` 拦下，
 *     而且那也确实是一次多余的级联渲染；
 *   · **落点唯一**：一个提供者只有一个落点。需要多个落点就多挂一层提供者
 *     （现在没有这样的需求，所以不做，别先造）。
 */
import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "~/lib/utils";

interface SlotOutletContextValue {
  /** 落点节点；`null` = 现在没有落点。 */
  node: HTMLElement | null;
  setNode: (node: HTMLElement | null) => void;
}

const SlotOutletContext = createContext<SlotOutletContextValue | null>(null);

/** 提供者 —— 挂在**同时包含落点与内容**的那一层上。 */
export function SlotOutletProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  return (
    <SlotOutletContext.Provider value={{ node, setNode }}>
      {children}
    </SlotOutletContext.Provider>
  );
}

/** 落点 —— 内容最终出现在这里。`className` 由调用处给（落点的排布是布局决定）。 */
export function SlotOutlet({ className }: { className?: string }) {
  const ctx = useContext(SlotOutletContext);
  /* `ref` 回调而不是 `useEffect` 读 ref：节点挂上/卸下都走它，且不在渲染期读 DOM。 */
  return (
    <div
      ref={ctx?.setNode}
      data-slot="slot-outlet"
      className={cn("flex min-w-0 items-center", className)}
    />
  );
}

/**
 * 内容 —— 落点在时传送过去；否则渲染 `fallback`（缺省**就地渲染**）。
 *
 * `fallback` 传 `null` 用于「没有落点就干脆不显示」的场景（如页签切换时，
 * 非当前页的内容本来就不该出现在任何地方）。
 */
export function SlotContent({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const ctx = useContext(SlotOutletContext);
  const node = ctx?.node ?? null;
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  if (node && mounted) return createPortal(children, node);
  return <>{fallback ?? children}</>;
}
