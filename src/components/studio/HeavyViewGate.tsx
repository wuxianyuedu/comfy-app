"use client";

/**
 * 重视图的「非活跃降级」闸（ISSUE #4677，#4598 的期望第 3 条）。
 *
 * 页签栈让打开过的屏**常驻挂载**（切走不卸载、保状态），代价是隐藏中的完整
 * 子树仍会随页签切换 / 父级状态 / 兄弟屏事件做 React 渲染。轮询那一半已由
 * `pauseWhenViewHidden` + `enabled: isTabActive` 收掉（#4598 已合并）；这里
 * 收掉剩下的一半：非活跃时经 React `<Activity>` 的 hidden 模式把子树藏起来
 * ——React 对隐藏中的子树**一次渲染都不做**（页签切换 / 父级状态 / 兄弟屏
 * 事件都不再触碰它），同时 fiber 状态原样保留（表单草稿、展开态、已加载的
 * 数据都在），切回时原样恢复；effects 重挂与 React Query 的
 * `enabled: isTabActive` 同一拍，回来即拿新鲜数据。
 *
 * 为什么经 `<Activity>` 而不是「条件渲染成轻量占位」：后者把组件内部状态
 * 全部丢掉——表单草稿 / 展开态正是本条约束点名要保的；Activity 是平台给
 * 的同名能力（React 19.2+），状态保留是它语义的一部分。
 *
 * 滚动位置（约束点名的另一项）：本仓锁定的 React 19.3 里，Activity 的
 * hidden 是**保留 DOM、置 `display:none`**——但切走的那一刻布局消失，
 * 容器 scrollTop 被钳回 0；切回时 effects 重挂、数据重拉，内容高度先塌后
 * 长，滚动位置不会自己回来。所以这里仍要记账回放：活跃期用捕获监听持续
 * 记下后代滚动容器的位置（scroll 不冒泡、捕获能收到；每次滚动只做 O(1)
 * 写入），重新可见后按「到根的兄弟序路径」回放——两代 DOM 同构，路径即可
 * 对号入座，不按元素身份（身份随重挂全部换新）。回放带**有界重试**：数据
 * 没长回来时 scrollTop 会被钳住，用 `useInterval`（轮询的唯一出口，P12）
 * 每 150ms 补一次，直到全部成功或预算（5s）用完。
 */

import { Activity, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { useInterval } from "~/components/ui/use-interval";

/** 从 `root` 到 `el` 的兄弟序路径（两代 DOM 同构时可作身份对号）。 */
function pathOf(root: HTMLElement, el: HTMLElement): string | null {
  const parts: Array<string> = [];
  let node: HTMLElement | null = el;
  while (node !== null && node !== root) {
    /* 显式标注：parent 的类型经 `node = parent` 与自身初始化成环，靠推断会塌成 any。 */
    const parent: HTMLElement | null = node.parentElement;
    if (parent === null) {
      return null;
    }
    parts.push(String(Array.prototype.indexOf.call(parent.children, node)));
    node = parent;
  }
  return node === root ? parts.reverse().join("/") : null;
}

/** 按 `pathOf` 记下的路径找回元素；结构对不上（理论上不会）返回 null。 */
function findByPath(root: HTMLElement, path: string): HTMLElement | null {
  let node: HTMLElement = root;
  for (const part of path.split("/")) {
    const next = node.children[Number(part)];
    if (!(next instanceof HTMLElement)) {
      return null;
    }
    node = next;
  }
  return node;
}

/** 回放重试的节奏与总预算。 */
const RESTORE_INTERVAL_MS = 150;
const RESTORE_BUDGET_MS = 5000;

export function HeavyViewGate({
  active = true,
  children,
}: {
  /** 是否当前页签；缺省 true（无页签语境的渲染路径按「就是当前屏」处理）。 */
  active?: boolean;
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  /** 活跃期滚动过的容器 → 位置（键是路径：元素身份随重挂全部换新）。 */
  const scrolled = useRef<Map<string, number>>(new Map());
  const restoreStartedAt = useRef(0);
  /** 回放没全部成功期间为真——驱动下面的 150ms 重试；全部成功或超预算即收。 */
  const [restorePending, setRestorePending] = useState(false);

  /* 重新可见且记过账 ⇒ 挂起回放档（下面的 useInterval 会立即先试一轮）。 */
  useEffect(() => {
    if (active && scrolled.current.size > 0) {
      restoreStartedAt.current = Date.now();
      setRestorePending(true);
    }
  }, [active]);

  const restore = useCallback((): void => {
    const wrap = wrapRef.current;
    if (wrap === null) {
      setRestorePending(false);
      return;
    }
    let pending = 0;
    for (const [path, top] of scrolled.current) {
      const el = findByPath(wrap, path);
      if (el === null) {
        pending += 1;
        continue;
      }
      el.scrollTop = top;
      if (Math.abs(el.scrollTop - top) > 1) {
        pending += 1;
      }
    }
    const expired = Date.now() - restoreStartedAt.current > RESTORE_BUDGET_MS;
    if (pending === 0 || expired) {
      scrolled.current.clear();
      setRestorePending(false);
    }
  }, []);

  /* 回放重试：immediate 先试一轮；没全成功就每 150ms 补一次（有界）。 */
  useInterval(restore, {
    ms: restorePending ? RESTORE_INTERVAL_MS : null,
    immediate: true,
    pauseWhenHidden: false,
    pauseWhenViewHidden: false,
  });

  /* 活跃期持续记录滚动位置：每个滚动事件只做一次 O(1) 写入，不扫树。 */
  useEffect(() => {
    if (!active) {
      return;
    }
    const wrap = wrapRef.current;
    if (wrap === null) {
      return;
    }
    const onScroll = (event: Event): void => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const path = pathOf(wrap, target);
        if (path !== null) {
          scrolled.current.set(path, target.scrollTop);
        }
      }
    };
    wrap.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      wrap.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [active]);

  return (
    <div className="h-full" ref={wrapRef}>
      <Activity mode={active ? "visible" : "hidden"}>{children}</Activity>
    </div>
  );
}
