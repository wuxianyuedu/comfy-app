/* 悬浮节点置顶 —— 被鼠标指着的节点必须压住连线。
 *
 *  背景（ISSUE #400）：画布连线不参与「浮到最上层」，而节点与线各自在不同层级
 *  绘制。一条横穿画布的线只是「恰好路过」某个节点时，用户悬停到该节点上，看到
 *  的仍是线压着卡片 —— 与「选中后节点浮到最上层」的观感不一致，节点参数基本
 *  没法读。
 *
 *  做法：节点渲染器在根元素上写 `data-hovered="true"`，抬升幅度交给 CSS
 *  （见 globals.css 的 `.react-flow__node[data-hovered="true"]`）。这样
 *  「鼠标进出」只让被指的那个节点重渲染，画布其余部分零成本 —— 比改节点数据
 *  （会触发整张 store 表更新、拖慢大图）划算得多。
 *
 *  钩子自己管鼠标事件，而不是复用 React Flow 的 `<ReactFlow onNodeMouseEnter>`：
 *  后者会把事件冒到宿主画布，再经 props 传回每个节点 —— 那是一次画布级状态更新，
 *  整张图一起重渲染。钩子挂在节点根元素上，React 只会重渲染该节点。
 */
import { useCallback, useState } from "react";
import type { DOMAttributes } from "react";

/** 节点根元素上要用到的悬浮事件属性。 */
type HoverHandlers = Pick<DOMAttributes<HTMLElement>, "onMouseEnter" | "onMouseLeave">;

export interface HoverElevation {
  /** 鼠标是否正指在本节点上（写进根元素的 `data-hovered`）。 */
  hovered: boolean;
  /** 需要展开到节点根元素上的事件处理器。 */
  hoverHandlers: HoverHandlers;
}

/** 给节点接上「悬浮即置顶」的能力。
 *
 *  状态挂在**被悬浮的节点自己**身上，所以鼠标进出只重渲染那一个节点；
 *  画布级 props 回调 / 全局 store 都会把整张图拉进重渲染，这里刻意避开。 */
export function useHoverElevation(): HoverElevation {
  const [hovered, setHovered] = useState(false);

  const onMouseEnter = useCallback(() => setHovered(true), []);
  const onMouseLeave = useCallback(() => setHovered(false), []);

  return { hovered, hoverHandlers: { onMouseEnter, onMouseLeave } };
}

/** 根元素上承载悬浮态的属性名。CSS 侧的对应选择器在 globals.css：
 *  `.react-flow__node[data-hovered="true"]`（抬 z-index，压住连线）。 */
export const HOVER_ATTRIBUTE = "data-hovered";
