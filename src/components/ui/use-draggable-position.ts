"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { clamp } from "~/lib/clamp";
import { readStorageJson, writeStorageJson } from "~/lib/browser-storage";
import {
  useViewportSize,
  type ViewportSize,
} from "~/components/ui/use-viewport-size";

/**
 * useDraggablePosition —— 「让一个悬浮元素可以被拖着摆到任意位置」的**唯一实现**。
 *
 * 背景：应用里已经有一批悬浮元素（工坊 Agent 入口 / 浮层、画布上的浮标），
 * 它们的共同处境是「位置由我们定，但用户总有理由想挪开」—— 右下角的入口会挡住
 * 工坊右栏、画布右下角的角标会压住节点。此前只有「固定锚角」一种答案，用户
 * 唯一能做的是把面板关掉。
 *
 * ## 三件必须一起给出的事（少一件这条能力就是半截的）
 *
 * 1. **位置**要能在「窗口尺寸」与「元素尺寸」之间夹住 —— 拖出视口外、或窗口
 *    缩小后停在视野外的悬浮元素，用户既看不见也拖不回来（没有别的抓手）。
 *    夹取用 `~/lib/clamp`，不在调用处各写一遍 `Math.max/min`。
 * 2. **记忆**要跨会话 —— 每次打开都跳回右下角等于没挪过。走
 *    `~/lib/browser-storage`（隐私模式 / 配额满时静默降级回默认位，不抛）。
 * 3. **「拖动」与「点击」必须分得开** —— 悬浮元素通常同时是按钮（拖它和点它
 *    是两件事）。判据是**指针位移阈值**：按下后位移没超过 `DRAG_SLOP_PX` 就
 *    算点击、交给调用处的 `onClick`；超过了就算拖动，并**吞掉随后的 click**
 *    （否则一次拖拽会在松手时顺手把浮层打开）。
 *
 * ## 为什么位置存的是「相对视口右下角的偏移」
 *
 * 存绝对 `left/top` 时，窗口一变大元素就留在原地、离右下角越来越远；存
 * 「距右 / 距下的像素数」则天然跟着右下角走 —— 悬浮元素贴的通常是**角的方位**
 * 而不是某个绝对坐标。调用处据此自行算 `right` / `bottom`。
 *
 * ## 位置的来源：派生 + 一次性覆盖（React 19 的写法约束）
 *
 * 「记住的位置」与「用户这次拖到哪」是**两个来源**，这里的分工是：
 *
 *   · **基线**由渲染期**派生**（`useMemo`）—— 它只依赖「视口多大」与「元素挂上
 *     了没有」两个输入，两者齐了就能算出「该落在哪」（读 `localStorage` + 夹取）。
 *     派生而不是 effect 里 `setState`：React 19 已无 `set-state-in-effect` 豁免，
 *     而这两个输入**只有浏览器里才拿得到**，用 effect 同步状态会被 lint 拦下。
 *   · **用户的拖动结果**放 state（`manual`）—— 它压过基线，直到窗口尺寸或元素
 *     变化把基线重算（那时基线重新成为事实来源）。
 *
 * 这条「派生基线 + 拖动覆盖」的分工同时解决了两个曾出错的地方：
 *   ① 元素**首轮还没挂上**（调用处按「有没有位置」决定要不要渲染它）——
 *      此时派生用的是零尺寸的占位盒子，先把默认偏移给出去让元素出现；
 *   ② 元素挂上后**必须重读 storage**，不能拿手上那个默认值去夹 ——
 *      否则记住的位置被静默丢弃（拖过之后重开应用又跳回右下角）。
 */

/** 判定「这是拖动而不是点击」的指针位移阈值（px）。
 *
 *  4 是「手抖 vs 有意拖动」的分界：小于它的位移连滚动都会被误判成拖动；
 *  取值参照浏览器给拖拽手势留的同一量级容差。 */
export const DRAG_SLOP_PX = 4;

/** 悬浮元素距视口边的最小留白（px）—— 拖到边缘时仍要留出圆角与阴影。 */
export const DRAG_EDGE_GAP_PX = 8;

/** 元素在视口内的落点（左上角坐标 + 自身尺寸）。 */
export interface DraggableBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 持久化的位置：距视口右 / 下的偏移（跟角走，不跟绝对坐标走）。 */
export interface DraggableOffset {
  right: number;
  bottom: number;
}

export interface UseDraggablePositionOptions {
  /** `localStorage` 键名（含自己的版本策略，例如 `comfyapp:agent-fab:v1`）。 */
  storageKey: string;
  /** 没存过 / 读失败 / 落点已失效时用的默认偏移。 */
  defaultOffset: DraggableOffset;
  /** 用户真的点了（位移没超阈值）时的回调。 */
  onClick?: () => void;
}

export interface DraggablePositionController<T extends HTMLElement> {
  /** 当前位置；`null` = 还没量到（首帧之前不渲染，避免闪一下再跳位）。 */
  offset: DraggableOffset | null;
  /** 是否正在拖动 —— 调用处据此关掉「悬停提示」这类会打架的浮层。 */
  dragging: boolean;
  /** 挂到被拖元素上的指针事件。 */
  handleProps: {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  };
  /** 挂在被拖元素上的 ref 回调 —— **必须挂上**：本 hook 靠它知道元素什么时候
   *  进的 DOM，「取回记住的位置」与「按真实尺寸夹取」都在那之后才成立。 */
  elementCallbackRef: (el: T | null) => void;
}

/* 元素尺寸与视口尺寸都从现场量，不缓存 —— 悬浮元素会随内容换行改变高度
 * （例如徽标数字从 9 变 99+），缓存一份就会在夹取时算错边界。 */
function measureBox(element: HTMLElement): DraggableBox {
  const rect = element.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

/**
 * 把「距右 / 距下的偏移」夹进视口：元素必须整体可见。
 *
 * 窗口变小时，原先贴右下的元素会有一部分跑到视口外；这里把偏移**收紧**到
 * 「至少让元素整体留在视口内」，而不是把它弹回默认位 —— 用户的摆放意图
 *（贴着右下）仍然保留。
 */
function clampOffset(
  offset: DraggableOffset,
  box: Pick<DraggableBox, "width" | "height">,
  viewport: ViewportSize,
): DraggableOffset {
  /* `right` 的可取上限 = 视口宽 − 元素宽 − 两边留白；下限就是留白本身
   * （元素贴住右边）。`Math.max` 兜住「元素比视口还宽」这一档：那时上限
   * 会小于下限，`clamp` 的区间被写反 —— 取留白让它靠左显示，至少读得到。 */
  const maxRight = Math.max(
    DRAG_EDGE_GAP_PX,
    viewport.width - box.width - DRAG_EDGE_GAP_PX,
  );
  const maxBottom = Math.max(
    DRAG_EDGE_GAP_PX,
    viewport.height - box.height - DRAG_EDGE_GAP_PX,
  );
  return {
    right: clamp(offset.right, DRAG_EDGE_GAP_PX, maxRight),
    bottom: clamp(offset.bottom, DRAG_EDGE_GAP_PX, maxBottom),
  };
}

export function useDraggablePosition<T extends HTMLElement>({
  storageKey,
  defaultOffset,
  onClick,
}: UseDraggablePositionOptions): DraggablePositionController<T> {
  /* 元素**是不是已经在 DOM 里**。由回调 ref 回答（React 调它的时候就说明
   * 挂了 / 卸了）—— 它的身份会变，所以能安全地进各种依赖；而 ref 对象的
   * 身份恒定，`ref.current` 被填上时依赖不会重跑（这一点是本 hook 第一版
   * 「记住的位置永远读不回来」的根因）。 */
  const [element, setElement] = useState<T | null>(null);
  /* 用户本次拖动后的落点。`null` = 还没拖过，用派生出来的基线。 */
  const [manual, setManual] = useState<DraggableOffset | null>(null);
  const [dragging, setDragging] = useState(false);

  /* 夹取边界要跟着视口走：窗口变窄后旧偏移会把元素推到视野外。视口尺寸走
   * 唯一出口 `useViewportSize`（不在渲染期读 `window`：SSR 拿不到、缩放也
   * 不会重渲染）。 */
  const viewport = useViewportSize();

  /* 拖动过程中的现场：按下时的指针位、按下时的偏移、以及「这次要判成拖动还
   * 是点击」。放 ref 而不是 state —— pointermove 每帧都写，走 state 会把
   * 整棵树按帧重渲染。 */
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startOffset: DraggableOffset;
    moved: boolean;
  } | null>(null);

  /* 点击回调放 ref 同步：`onClick` 是调用处每次渲染新造的箭头函数，
   * 进依赖就会让 pointerdown 的监听每帧重挂。 */
  const onClickRef = useRef(onClick);
  useEffect(() => {
    onClickRef.current = onClick;
  }, [onClick]);

  /* 视口尺寸同理放 ref：`pointermove` 每帧都要夹取，读 ref 比闭包捕获
   * 「按下那一刻」的尺寸更准（拖到一半把窗口拉窄，边界应当立刻跟上）。 */
  const viewportRef = useRef(viewport);
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  /* 回调 ref：元素挂上 / 换一个 / 卸载时告诉 hook。
   * ⚠️ 必须判等 —— 内联回调会被 React 在**每次渲染**调一次，不判等就是
   * 「渲染 → setState → 渲染」的死循环（同 `ui/use-element-box` 的口径）。 */
  const elementCallbackRef = useCallback((next: T | null) => {
    setElement((prev) => (prev === next ? prev : next));
  }, []);

  /* 基线：读回记住的位置并夹进当前视口。**渲染期派生**而不是 effect 里
   * `setState`（规范 08 §8.6 的规范写法一）——「视口多大」与「元素挂上没有」
   * 都只有浏览器里才拿得到，用 effect 同步状态会被 React 19 的
   * `react-hooks/set-state-in-effect` 拦下（已无豁免）。
   *
   * 元素**还没挂上**时用零尺寸的占位盒子：此时只能先给一个值把元素放出来
   *（调用处按「有没有偏移」决定要不要渲染它），夹取等它真挂上再做一次。
   * `manual` 为真时代表用户已经拖过，那才是事实来源。 */
  const baseline = useMemo(
    () =>
      viewport === null
        ? null
        : clampOffset(
            readStorageJson<DraggableOffset>(storageKey, defaultOffset),
            element === null ? { width: 0, height: 0 } : measureBox(element),
            viewport,
          ),
    [defaultOffset, element, storageKey, viewport],
  );

  /* 用户拖过就听用户的；没拖过听基线。窗口尺寸变化会让 `baseline` 重算（把
   * 拖过的落点也收紧回视口内），但**不**清掉 `manual` —— 否则用户摆的位置
   * 会在每次 resize 时被 storage 里那个（更旧的）值顶掉。 */
  const offset =
    manual !== null && viewport !== null && element !== null
      ? clampOffset(manual, measureBox(element), viewport)
      : baseline;

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      /* 只接主键：右键 / 中键留给上下文菜单与原生的中键行为。 */
      if (event.button !== 0) return;
      const dragged = element;
      if (!dragged || offset === null) return;

      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startOffset: offset,
        moved: false,
      };

      const onMove = (moveEvent: PointerEvent) => {
        const drag = dragRef.current;
        if (drag?.pointerId !== moveEvent.pointerId) return;
        const dx = moveEvent.clientX - drag.startX;
        const dy = moveEvent.clientY - drag.startY;
        if (!drag.moved) {
          if (Math.hypot(dx, dy) < DRAG_SLOP_PX) return;
          drag.moved = true;
          setDragging(true);
        }
        /* 指针右移 = 离右边更近 → `right` 变小，所以是减 `dx`；
         * 下移同理减 `dy`。夹取每一帧都做，元素不会跟出视口。 */
        const nextViewport = viewportRef.current;
        if (nextViewport === null) return;
        setManual(
          clampOffset(
            {
              right: drag.startOffset.right - dx,
              bottom: drag.startOffset.bottom - dy,
            },
            measureBox(dragged),
            nextViewport,
          ),
        );
      };

      const onUp = (upEvent: PointerEvent) => {
        const drag = dragRef.current;
        dragRef.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        if (drag?.pointerId !== upEvent.pointerId) return;
        setDragging(false);
        if (!drag.moved) {
          /* 位移没超阈值 = 点击：交回调用处（打开浮层 / 收起面板）。 */
          onClickRef.current?.();
          return;
        }
        /* 真的拖过：把新落点记住。写失败（隐私模式 / 配额满）静默 ——
         * 记忆是增强不是功能，本次会话内拖到哪仍然在哪。 */
        setManual((current) => {
          if (current !== null) writeStorageJson(storageKey, current);
          return current;
        });
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [element, offset, storageKey],
  );

  return {
    offset,
    dragging,
    handleProps: { onPointerDown },
    elementCallbackRef,
  };
}
