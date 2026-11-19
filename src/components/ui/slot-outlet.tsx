"use client";

/**
 * SlotOutlet —— 「把子树渲染到别处的一个落点」的全库唯一实现（规范 §12.18）。`createPortal` 能做，但散在视图层各写一遍就说不清哪些地方在传送、为什么；视图只表达意图。
 * 与 `ui/dialog` / `ui/popover` 的分工：那几个是浮层（有定位、遮罩、焦点锁），本件是结构（被传送内容是宿主处的普通子节点，不浮、不遮、不抢焦点）。三条边界：没挂落点时原地渲染 / 只在客户端传送（SSR 无 DOM，走 `useSyncExternalStore`）/ 落点唯一。
 */
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "~/lib/utils";

type SlotOutletContextValue = {
  /** 落点节点；`null` = 现在没有落点。 */
  node: HTMLElement | null;
  setNode: (node: HTMLElement | null) => void;
};

const SlotOutletContext = createContext<SlotOutletContextValue | null>(null);

/** 提供者 —— 挂在**同时包含落点与内容**的那一层上。 */
export function SlotOutletProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  return (
    <SlotOutletContext.Provider value={{ node, setNode }}>{children}</SlotOutletContext.Provider>
  );
}

/** 落点 —— 内容最终出现在这里。`className` 由调用处给（落点的排布是布局决定）。 */
export function SlotOutlet({ className }: { className?: string }) {
  const ctx = useContext(SlotOutletContext);
  /* `ref` 回调而不是 `useEffect` 读 ref：节点挂上/卸下都走它，且不在渲染期读 DOM。 */
  return (
    <div
      className={cn("flex min-w-0 items-center", className)}
      data-slot="slot-outlet"
      ref={ctx?.setNode}
    />
  );
}

/**
 * 内容 —— 落点在时传送过去；否则渲染 `fallback`（缺省就地渲染）。`fallback` 传 `null` 用于「没有落点就干脆不显示」（如页签切换时非当前页内容）。
 */
export function SlotContent({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const ctx = useContext(SlotOutletContext);
  const node = ctx?.node ?? null;
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  if (node && mounted) {
    return createPortal(children, node);
  }
  return <>{fallback ?? children}</>;
}
