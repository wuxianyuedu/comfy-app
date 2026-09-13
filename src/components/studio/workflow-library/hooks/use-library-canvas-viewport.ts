"use client";

/* 工作流库「画布节点」预览的**只读平移 / 缩放**编排（规范 §17.2 第②层）。
 *
 * 用户的原始诉求：「这里需要可以拖动整个画布查看其他超出边框的内容」——
 * 三列（对外参数 / 宿主卡片 / 对外输出参数）合起来常宽过面板，超出去的部分
 * 此前根本看不到。这里把手势翻译成视口状态（算式在 workflow-library-canvas-
 * viewport.ts），视图只负责把 transform 贴到内容层上。
 *
 * 三条约束：
 *   ① **只读**：不碰映射、不碰连线 —— 连线量测读的是被平移后的真实 DOM 矩形，
 *      所以拖动画布不会让线错位；
 *   ② 手势与卡片上的交互不打架：从输入框、下拉、圆点、按钮上按下时不启动平移；
 *      从卡片空白处按下且位移极小（≤ 阈值）时按「点一下」处理，不吞掉选中；
 *   ③ 滚轮是**非被动**监听：React 的 onWheel 是 passive 的，不能 preventDefault，
 *      一滚就会连带滚动外层页面 —— 缩放的同时页面跳走，读作「画面乱跑」。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  IDENTITY_VIEWPORT,
  PAN_DRAG_THRESHOLD,
  fitViewport,
  isIdentityViewport,
  panBy,
  zoomAt,
  zoomLabel,
  viewportTransform,
  zoomStepFromWheel,
  type LibraryViewport,
} from "../workflow-library-canvas-viewport";

/** 平移不应从这些元素上起手：它们各自的按下语义已经被占用。 */
const INTERACTIVE_SELECTOR =
  "input, textarea, select, button, a, [role='button'], [data-wire-anchor], [contenteditable='true']";

export interface LibraryCanvasViewportController {
  /** 内容层的 transform 文本（`translate3d(...) scale(...)`）。 */
  transform: string;
  /** 缩放百分比展示。 */
  zoomText: string;
  /** 是否处于初始视口（决定「复位」是否可用）。 */
  isIdentity: boolean;
  /** 拖动手势要挂在内容层上的按下处理。 */
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  /** 把「外框」元素交给视口（滚轮缩放的**非被动**监听装它上面）。
   *
   *  刻意不走 React 的 `ref=` 通道：`react-hooks/refs` 会把「hook 返回值里被
   *  `ref=` 消费的属性」整片判成 ref 对象，进而拦住同一个对象上 `transform`
   *  这类正常的渲染期读取。视图用 effect 把元素交进来即可。 */
  setFrameElement: (element: HTMLElement | null) => void;
  /** 把「内容层」元素交给视口（`适应` 按它的布局尺寸算缩放）。 */
  setContentElement: (element: HTMLElement | null) => void;
  /** 适应：缩到刚好放得下并居中。 */
  fit: () => void;
  /** 复位：回到初始布局。 */
  reset: () => void;
}

export function useLibraryCanvasViewport(): LibraryCanvasViewportController {
  const [viewport, setViewport] = useState<LibraryViewport>(IDENTITY_VIEWPORT);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  /* 用 ref 之外的 state 持有内容层：`fit` 是用户点按钮时才跑的（不在渲染期读
   *  ref），但把元素放进 state 能让「适应」的依赖关系显式、也不违反 refs 规则。 */
  const [content, setContent] = useState<HTMLElement | null>(null);
  /* 拖动中的状态放 ref：指针每移动一帧都要读，走 state 会让整块卡片列重渲染
   *  （几十个 DOM 节点逐帧重建，明显卡手）。 */
  const dragRef = useRef<{
    pointerId: number;
    /** 起手位置（阈值判定与「从起手处开始平移」都用它）。 */
    startX: number;
    startY: number;
    /** 已经用掉的位移（增量平移用）—— 越过阈值前的那一小段不能丢，
     *  否则画面会永远比手慢「阈值」那么多像素。 */
    appliedX: number;
    appliedY: number;
    moved: boolean;
  } | null>(null);

  /* 名字刻意不带 `ref` 字样：那是「ref 对象」的命名，会让 react-hooks/refs
   *  把整个 controller 当成 ref 而拦住渲染期读 `transform`（这里只是两个
   *  存元素的 setter 回调）。 */
  const setFrameElement = useCallback((element: HTMLElement | null) => {
    setContainer(element);
  }, []);

  const setContentElement = useCallback((element: HTMLElement | null) => {
    setContent(element);
  }, []);

  const fit = useCallback(() => {
    if (!content || !container) return;
    /* 量的是内容层的**布局**尺寸（offsetWidth/Height），不是 getBoundingClientRect：
     *  rect 已经被当前 transform 缩放过，用它算「适应」会一次比一次小。 */
    setViewport(
      fitViewport(
        { width: content.offsetWidth, height: content.offsetHeight },
        { width: container.clientWidth, height: container.clientHeight },
      ),
    );
  }, [content, container]);

  const reset = useCallback(() => setViewport(IDENTITY_VIEWPORT), []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      /* 只受理主键 / 触摸 / 笔：右键与中键各有语义（上下文菜单、自动滚动）。 */
      if (event.button !== 0) return;
      /* 从可交互元素上按下不启动平移：那是输入、下拉、按钮或连线圆点的手势。 */
      const target = event.target as HTMLElement | null;
      if (target?.closest(INTERACTIVE_SELECTOR)) return;
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        appliedX: 0,
        appliedY: 0,
        moved: false,
      };
      /* 拖动全程都要收到移动事件（指针移出元素也不会丢）。移动/抬起本来就挂在
       *  窗口上，这一步只是让浏览器把「后续事件都发给本元素」—— 老浏览器与测试
       *  环境（jsdom）没有这个方法，缺了它拖动照样可用。 */
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [],
  );

  /* 移动 / 抬起挂在窗口上：指针可能移出内容层（拖到面板边缘之外）—— 绑在内容层
   * 上中途就丢事件了，画面会停在半路。 */
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag?.pointerId !== event.pointerId) return;
      if (!drag.moved) {
        const far =
          Math.abs(event.clientX - drag.startX) > PAN_DRAG_THRESHOLD ||
          Math.abs(event.clientY - drag.startY) > PAN_DRAG_THRESHOLD;
        /* 还没越过阈值：先当「点一下」处理，不动画面（否则点卡片/点输入框都会
         *  被一两次手抖变成位移）。 */
        if (!far) return;
        drag.moved = true;
        /* 越过阈值的那一下会顺带选中文本，拖动时出现一片蓝底很难看。 */
        document.getSelection()?.removeAllRanges();
      }
      /* 位移一律从**起手位置**算（减去已用掉的那部分）：内容始终跟着手走，
       *  不会因为「阈值前那段没记」而永久慢一点点。 */
      const dx = event.clientX - drag.startX - drag.appliedX;
      const dy = event.clientY - drag.startY - drag.appliedY;
      drag.appliedX += dx;
      drag.appliedY += dy;
      setViewport((prev) => panBy(prev, { dx, dy }));
    };
    const up = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag?.pointerId !== event.pointerId) return;
      dragRef.current = null;
      if (drag.moved) {
        /* 真的拖过：吃掉紧随其后的 click，避免「拖完顺手选中了某张卡」。
         *  `once: true` 已经保证只吃一次，但若这一下 click 始终没来（指针在空白
         *  处抬起），监听会一直挂着 —— 0ms 后主动撤掉，避免吃掉很久之后的点击。 */
        const swallow = (clickEvent: MouseEvent) => {
          clickEvent.stopPropagation();
          clickEvent.preventDefault();
          window.removeEventListener("click", swallow, { capture: true });
        };
        window.addEventListener("click", swallow, {
          capture: true,
          once: true,
        });
        setTimeout(() => {
          window.removeEventListener("click", swallow, { capture: true });
        }, 0);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  /* 滚轮缩放：必须是**非被动**监听才拦得住页面滚动（React 的 onWheel 是
   *  passive 的）。锚点取光标相对容器左上角的位置 —— 缩放围绕光标进行，
   *  用户盯着的那张卡不会滑出视野。 */
  useEffect(() => {
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      const anchor = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      setViewport((prev) =>
        zoomAt(prev, anchor, zoomStepFromWheel(prev.zoom, event.deltaY)),
      );
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [container]);

  return useMemo(
    () => ({
      transform: viewportTransform(viewport),
      zoomText: zoomLabel(viewport.zoom),
      isIdentity: isIdentityViewport(viewport),
      onPointerDown,
      setFrameElement,
      setContentElement,
      fit,
      reset,
    }),
    [viewport, onPointerDown, setFrameElement, setContentElement, fit, reset],
  );
}
