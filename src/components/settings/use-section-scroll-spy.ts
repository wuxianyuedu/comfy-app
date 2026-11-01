"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 「一整页分区滚动 + 左侧导航跟随」的唯一实现（设置页的形态）。
 *
 * ## 这条账的形状
 *
 * 设置页此前是**一屏一节**：导航点一下把 `section` 换掉，右侧换成另一份 JSX。
 * 于是「从头看到尾」这件事做不到 —— 用户想比较两个分区的取值，得来回点；
 * 而「我现在读的是哪一节」只由导航自己的 `aria-current` 表达，正文里没有
 * 任何标题说明（ISSUE #1722）。
 *
 * 改成**一页全量分区**之后，导航不再切换内容，它变成**目录**：点一项滚到那一节，
 * 滚动时高亮跟着走。两件事各有各的失效模式，都是静默的（滚错一节、高亮停在
 * 上一节），所以收在这里、由 `SettingsShell.test.tsx` 看住。
 *
 * ## 判据是「压过顶线的那一节里的最后一个」
 *
 * 观察配置把滚动容器的**可视区压成上沿往下一条线**（`rootMargin` 上收一条线 +
 * 下收整屏），于是「进入」= 「这一节的任一像素压过了那条线」。取其中**文档顺序
 * 最后一个**作为当前分区 —— 这一条就是「跟随滚动」的全部判据。
 *
 * ⚠️ **必须把下沿也收掉**（写成 `0px` 只是上收）：容器的可视区高度是整屏，
 * 那么「进入」就退化成「看得见」—— 而整屏同时看得见三四个分区，「最后一个
 * 看得见的」是**屏幕底部**那一节，不是「读到哪」的那一节。实测症状：页面停在
 * 最顶上（`scrollTop = 0`）而高亮已经跳到第四段。收成一条线之后，
 * 一次只有真正压在顶线上的那一节（至多两节交界的瞬间）算进入。
 *
 * 为什么不按中点 / 比例算：分区高度差别很大（「外观」比「远程模型」短得多），
 * 任何按比例算中点的判据都会在短分区上跳过一节；「压过顶线」则保证短分区只要
 * 真的滚到过就一定会成为当前项。
 *
 * 为什么不用 `scroll` 事件自己算距离：那要在每次滚动事件里读**所有**分区的
 * `getBoundingClientRect`（9 个分区 = 每帧 9 次强制布局）。观察器由浏览器
 * 批量回调，量的是「越没越过那条线」这个原生问题。
 */

/** 滚动容器上沿往下收多少像素作为「已读到」的判定线。 */
export const SECTION_TOP_LINE_PX = 96;

/**
 * 观察器的 `rootMargin` —— 把容器可视区压成上沿往下 `SECTION_TOP_LINE_PX` 处的
 * **一条线**：上沿收 `-SECTION_TOP_LINE_PX`、下沿收 `-100%`（整屏）。
 *
 * 导出是为了让用例直接核这条形状（它是本 hook 的判据本身，不是实现细节）。
 */
export const SECTION_ROOT_MARGIN = `-${SECTION_TOP_LINE_PX}px 0px -100% 0px`;

export type UseSectionScrollSpyOptions<Id extends string = string> = {
  /** 当前分区（受控：点击导航要立刻改高亮，不必等滚动落定）。 */
  activeId: Id;
  /** 滚动容器（分区节在它里面滚动）。 */
  containerRef: React.RefObject<HTMLElement | null>;
  /** 滚动把当前分区改掉了时通知调用方（同步导航高亮与摘要行）。 */
  onActiveChange: (id: Id) => void;
  /** 分区 id 列表（**顺序即文档顺序** —— 「最后一条」靠它定序）。 */
  sectionIds: ReadonlyArray<Id>;
};

export type SectionScrollSpy<Id extends string = string> = {
  /** 挂到**每个分区节**上的 `ref` 回调（`sectionId` 即锚点 id）。 */
  registerSection: (sectionId: Id) => (el: HTMLElement | null) => void;
  /**
   * 滚到指定分区（导航点击调它）。
   *
   * 返回**是否真的命中了锚点**：三态外壳（加载 / 失败）下没有分区节，那时必须
   * 返回 `false` —— 调用方据此判断「这一跳还没落定、载荷先留着」，等就绪外壳
   * 挂上分区节后再滚（否则跳转载荷会在没有落点的首帧里被吃掉）。
   *
   * `behavior` 默认平滑；跳转载荷的落点用 `"auto"`（瞬时）—— 动画期间观察器会
   * 先报「当前视图里那几节」，高亮会闪一下再跳到位。
   */
  scrollToSection: (sectionId: Id, behavior?: ScrollBehavior) => boolean;
};

/**
 * 观察容器里各分区节的可见性，产出「当前分区」并支持滚到指定分区。
 *
 * `activeId` / `onActiveChange` 是受控的：高亮那份状态仍归调用方，本 hook 只
 * 负责「滚动 → 当前分区」这一条方向。
 */
export function useSectionScrollSpy<Id extends string>({
  containerRef,
  sectionIds,
  activeId,
  onActiveChange,
}: UseSectionScrollSpyOptions<Id>): SectionScrollSpy<Id> {
  /** 已挂上的分区节（id → 元素），观察器按它建立观察。 */
  const nodesRef = useRef(new Map<Id, HTMLElement>());
  /** 仍在「顶线之下」的分区集合 —— 跨回调累积，由 observer 的 entry 更新。 */
  const crossedRef = useRef(new Set<HTMLElement>());
  /** 最新的回调：回调里读它，避免把 `onActiveChange` 放进观察器的依赖数组。 */
  const notifyRef = useRef(onActiveChange);
  useEffect(() => {
    notifyRef.current = onActiveChange;
  }, [onActiveChange]);
  /** 当前分区放 ref：回调里要判「变了没有」，读 state 会拿到这一批渲染的旧值。 */
  const activeRef = useRef(activeId);
  useEffect(() => {
    activeRef.current = activeId;
  }, [activeId]);
  /** 触发观察器重建的计数器 —— 分区节挂上 / 摘掉时自增。 */
  const [revision, setRevision] = useState(0);

  /**
   * 分区节的 `ref` 回调。**按 id 缓存**（同一个 id 每次返回同一个函数）：
   * 内联回调会让 React 每轮渲染先解绑再绑上，`revision` 跟着每轮自增 ——
   * 观察器于是每轮重建一次（与 `useElementBox` 的等值判断同一课）。
   */
  const refsRef = useRef(new Map<Id, (el: HTMLElement | null) => void>());
  const registerSection = useCallback((sectionId: Id) => {
    const cached = refsRef.current.get(sectionId);
    if (cached) {
      return cached;
    }
    const ref = (el: HTMLElement | null) => {
      const prev = nodesRef.current.get(sectionId);
      /* 判等：`ref` 回调在每次渲染后都会被 React 调一次（先 null 再元素），
       * 不判等会让 `revision` 每轮自增。 */
      if (el) {
        if (prev === el) {
          return;
        }
        nodesRef.current.set(sectionId, el);
      } else {
        if (prev === undefined) {
          return;
        }
        nodesRef.current.delete(sectionId);
        crossedRef.current.delete(prev);
      }
      setRevision((n) => n + 1);
    };
    refsRef.current.set(sectionId, ref);
    return ref;
  }, []);

  useEffect(() => {
    const root = containerRef.current;
    /* jsdom 与老浏览器没有 `IntersectionObserver`：不做跟随，导航仍可点
     *（点击走 `scrollToSection`，不依赖观察器）。与 `useElementBox` 对
     * `ResizeObserver` 的退化口径一致 —— 不假装跟随生效，也不报错。 */
    if (!root || typeof IntersectionObserver === "undefined") {
      return;
    }

    const byId = nodesRef.current;
    const crossed = crossedRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            /* SAFETY: 类型断言已复核 */
            crossed.add(entry.target as HTMLElement);
          } else {
            /* SAFETY: 类型断言已复核 */
            crossed.delete(entry.target as HTMLElement);
          }
        }
        /* 按**文档顺序**自己排一遍取最后一个：`entries` 的次序不保证，
         * 不能拿浏览器给的那一个当结论。 */
        let next: Id | null = null;
        for (const id of sectionIds) {
          const el = byId.get(id);
          if (el && crossed.has(el)) {
            next = id;
          }
        }
        /* 没有任何分区越过顶线（整页刚滚到最顶、第一节还没到线）时保留当前值
         * —— 跟随的语义是「读到了哪一节」，不是「暂时没有」。 */
        if (next === null || next === activeRef.current) {
          return;
        }
        activeRef.current = next;
        notifyRef.current(next);
      },
      {
        root,
        /* 上收一条线 + 下收整屏 = 把可视区压成那一条线（见 `SECTION_ROOT_MARGIN`）。 */
        rootMargin: SECTION_ROOT_MARGIN,
        /* 只判「有没有压过线」，不需要面积比例。 */
        threshold: 0,
      },
    );

    for (const id of sectionIds) {
      const el = byId.get(id);
      if (el) {
        observer.observe(el);
      }
    }
    return () => observer.disconnect();
  }, [containerRef, sectionIds, revision]);

  const scrollToSection = useCallback(
    (sectionId: Id, behavior: ScrollBehavior = "smooth"): boolean => {
      const el = nodesRef.current.get(sectionId);
      if (!el) {
        return false;
      }
      /* 先改高亮再滚：滚动是动画的，等高亮跟着滚落定会有肉眼可见的滞后。 */
      if (sectionId !== activeRef.current) {
        activeRef.current = sectionId;
        notifyRef.current(sectionId);
      }
      el.scrollIntoView({ block: "start", behavior });
      return true;
    },
    [],
  );

  return { registerSection, scrollToSection };
}
