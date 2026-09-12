/* 悬浮节点置顶 —— 被鼠标指着的节点必须压住连线。
 *
 *  背景（ISSUE #400）：画布连线不参与「浮到最上层」，节点与线各自在不同层级
 *  绘制。一条横穿画布的线只是「恰好路过」某个节点时，用户悬停到该节点上，看到
 *  的仍是线压着卡片 —— 与「选中后节点浮到最上层」的观感不一致，节点参数基本
 *  没法读。
 *
 *  做法：节点渲染器把悬浮态写成 `data-hovered="true"`，抬升幅度交给 CSS
 *  （见 globals.css 的 `.react-flow__node[data-hovered="true"]`）。这样
 *  「鼠标进出」只让被指的那个节点重渲染，画布其余部分零成本 —— 比改节点数据
 *  （会触发整张 store 表更新、拖慢大图）划算得多。
 *
 *  ⚠️ 属性必须落在 **React Flow 自己的节点外壳**（`.react-flow__node`）上，
 *  不能落在节点组件渲染的卡片本体上：外壳带 `position:absolute` + 行内
 *  `z-index`，自成一个层叠上下文，卡片无论怎么抬 z-index 都抬不出外壳。
 *  因此这里用 ref 从卡片元素向上找到最近的外壳再写属性（见 useHoverElevation）。
 *
 *  钩子自己管鼠标事件，而不是复用 React Flow 的 `<ReactFlow onNodeMouseEnter>`：
 *  后者会把事件冒到宿主画布、再经 props 传回每个节点 —— 那是一次画布级状态更新，
 *  整张图一起重渲染。钩子挂在节点元素上，React 只会重渲染该节点。 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DOMAttributes } from "react";

/** 节点元素上要用到的悬浮事件属性。 */
type HoverHandlers = Pick<DOMAttributes<HTMLElement>, "onMouseEnter" | "onMouseLeave">;

/** React Flow 外壳的类名。CSS 选择器与它对齐（见 globals.css）。 */
const NODE_WRAPPER_SELECTOR = ".react-flow__node";

export interface HoverElevation {
  /** 鼠标是否正指在本节点上（由本钩子写进 React Flow 外壳的 `data-hovered`）。 */
  hovered: boolean;
  /** 需要展开到节点元素上的事件处理器。 */
  hoverHandlers: HoverHandlers;
  /** 挂到节点元素上的 ref —— 用来定位 React Flow 外壳。 */
  hoverRef: (element: HTMLElement | null) => void;
}

/** 给节点接上「悬浮即置顶」的能力。
 *
 *  状态挂在**被悬浮的节点自己**身上，所以鼠标进出只重渲染那一个节点；
 *  画布级 props 回调 / 全局 store 都会把整张图拉进重渲染，这里刻意避开。 */
export function useHoverElevation(): HoverElevation {
  const [hovered, setHovered] = useState(false);
  /* 节点卡片本体。React Flow 的外壳是它的祖先，且由 React Flow 渲染，
   *  我们只能拿它做 DOM 操作，不能自己渲染这个元素。 */
  const cardRef = useRef<HTMLElement | null>(null);

  const onMouseEnter = useCallback(() => setHovered(true), []);
  const onMouseLeave = useCallback(() => setHovered(false), []);

  const hoverRef = useCallback((element: HTMLElement | null) => {
    cardRef.current = element;
  }, []);

  /* 悬浮态 → 外壳属性。写成 effect 而不是渲染期直接操作 DOM：属性归 React Flow
   *  的外壳所有，外壳被重挂（切图 / 重排）后 effect 会随 `hovered` 重新对齐，
   *  不会留下悬挂标记。 */
  useEffect(() => {
    const wrapper = cardRef.current?.closest<HTMLElement>(NODE_WRAPPER_SELECTOR);
    if (!wrapper) return;
    if (hovered) {
      wrapper.setAttribute(HOVER_ATTRIBUTE, "true");
      return () => wrapper.removeAttribute(HOVER_ATTRIBUTE);
    }
    wrapper.removeAttribute(HOVER_ATTRIBUTE);
    return undefined;
  }, [hovered]);

  return { hovered, hoverHandlers: { onMouseEnter, onMouseLeave }, hoverRef };
}

/** 承载悬浮态的属性名。CSS 侧的对应选择器在 globals.css：
 *  `.react-flow__node[data-hovered="true"]`（抬 z-index，压住连线）。 */
export const HOVER_ATTRIBUTE = "data-hovered";
