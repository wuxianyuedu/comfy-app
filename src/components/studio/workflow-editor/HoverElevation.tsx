/* 悬浮节点置顶 —— 被指着的节点必须压住连线（ISSUE #400）。节点与线分层绘制，
 *  横穿的线只是路过也会压住卡片。渲染器写 `data-hovered="true"`，抬升交给 CSS，
 *  只重渲染被指的节点。⚠️ 属性必须落在 `.react-flow__node` 外壳上：外壳带
 *  `position:absolute` + 行内 z-index、自成层叠上下文，落在卡片里抬不出去壳，
 *  故用 ref 向上找外壳；钩子自管鼠标事件，避免 `onNodeMouseEnter` 整图重渲染。 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DOMAttributes } from "react";

/** 节点元素上要用到的悬浮事件属性。 */
type HoverHandlers = Pick<DOMAttributes<HTMLElement>, "onMouseEnter" | "onMouseLeave">;

/** React Flow 外壳的类名。CSS 选择器与它对齐（见 globals.css）。 */
const NODE_WRAPPER_SELECTOR = ".react-flow__node";

export type HoverElevation = {
  /** 鼠标是否正指在本节点上（由本钩子写进 React Flow 外壳的 `data-hovered`）。 */
  hovered: boolean;
  /** 需要展开到节点元素上的事件处理器。 */
  hoverHandlers: HoverHandlers;
  /** 挂到节点元素上的 ref —— 用来定位 React Flow 外壳。 */
  hoverRef: (element: HTMLElement | null) => void;
};

/** 承载悬浮态的属性名。CSS 侧的对应选择器在 globals.css：
 *  `.react-flow__node[data-hovered="true"]`（抬 z-index，压住连线）。 */
export const HOVER_ATTRIBUTE = "data-hovered";

/** 给节点接上「悬浮即置顶」的能力。
 *
 *  状态挂在**被悬浮的节点自己**身上，所以鼠标进出只重渲染那一个节点；
 *  画布级 props 回调 / 全局 store 都会把整张图拉进重渲染，这里刻意避开。 */
export function useHoverElevation(): HoverElevation {
  const [hovered, setHovered] = useState(false);
  /* 节点卡片本体。React Flow 的外壳是它的祖先，且由 React Flow 渲染，
   *  我们只能拿它做 DOM 操作，不能自己渲染这个元素。 */
  const cardRef = useRef<HTMLElement | null>(null);

  const onMouseEnter = useCallback(() => {
    setHovered(true);
  }, []);
  const onMouseLeave = useCallback(() => {
    setHovered(false);
  }, []);

  const hoverRef = useCallback((element: HTMLElement | null) => {
    cardRef.current = element;
  }, []);

  /* 悬浮态 → 外壳属性。写成 effect 而不是渲染期直接操作 DOM：属性归 React Flow
   *  的外壳所有，外壳被重挂（切图 / 重排）后 effect 会随 `hovered` 重新对齐，
   *  不会留下悬挂标记。 */
  useEffect(() => {
    const wrapper = cardRef.current?.closest<HTMLElement>(NODE_WRAPPER_SELECTOR);
    if (!wrapper) {
      return;
    }
    if (hovered) {
      wrapper.setAttribute(HOVER_ATTRIBUTE, "true");
      return () => {
        wrapper.removeAttribute(HOVER_ATTRIBUTE);
      };
    }
    wrapper.removeAttribute(HOVER_ATTRIBUTE);
    return undefined;
  }, [hovered]);

  return { hovered, hoverHandlers: { onMouseEnter, onMouseLeave }, hoverRef };
}
