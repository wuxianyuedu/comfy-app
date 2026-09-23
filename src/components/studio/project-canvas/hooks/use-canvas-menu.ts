"use client";

// 画布右键菜单 + 节点落子的这一簇回调（Phase 4b 从 CanvasInner 抽出一个子 hook）。
//
// CanvasInner 是长驻的大组件；这四处（右键面板菜单、放普通节点、放 Ardot 风工作流
// 参考节点、点节点关菜单）职责内聚、只依赖 menu / setMenu / setNodes / 落点换算，
// 抽成子 hook 让 CanvasInner 回到函数长度阈值内（规范 §12.13：巨型函数按职责切子 hook）。
// 行为与原内联实现逐字一致，仅位置搬家。
import {
  useCallback,
  type Dispatch,
  type MouseEvent,
  type SetStateAction,
} from "react";
import type { NodeMouseHandler } from "@xyflow/react";

import {
  defaultData,
  type CanvasNodeType,
  type NodeKind,
} from "~/lib/project-canvas/canvas-types";
import { placeCanvasNode } from "~/lib/project-canvas/canvas-helpers";

type ScreenToFlowFn = Parameters<
  typeof placeCanvasNode
>[0]["flow"]["screenToFlowPosition"];

interface UseCanvasMenuArgs {
  menu: { x: number; y: number } | null;
  setMenu: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  setNodes: Dispatch<SetStateAction<CanvasNodeType[]>>;
  screenToFlowPosition: ScreenToFlowFn;
}

export function useCanvasMenu({
  menu,
  setMenu,
  setNodes,
  screenToFlowPosition,
}: UseCanvasMenuArgs) {
  const onPaneContextMenu = useCallback(
    (e: MouseEvent | globalThis.MouseEvent) => {
      e.preventDefault();
      setMenu({
        x: (e as globalThis.MouseEvent).clientX,
        y: (e as globalThis.MouseEvent).clientY,
      });
    },
    [setMenu],
  );

  /** 在右键位置放一个默认数据的节点（`placeCanvasNode` 是落点唯一出口）。 */
  const createNode = useCallback(
    (kind: NodeKind) => {
      if (!menu) return;
      setNodes((nds) =>
        placeCanvasNode({
          nodes: nds,
          point: menu,
          flow: { screenToFlowPosition },
          data: defaultData(kind),
        }),
      );
      setMenu(null);
    },
    [menu, screenToFlowPosition, setNodes, setMenu],
  );

  /** 在右键位置放一个纯视觉的 Ardot 风工作流节点（无数据、无处理器）。 */
  const createTestWorkflowNode = useCallback(() => {
    if (!menu) return;
    setNodes((nds) =>
      placeCanvasNode({
        nodes: nds,
        point: menu,
        flow: { screenToFlowPosition },
        data: defaultData("workflow"),
      }),
    );
    setMenu(null);
  }, [menu, screenToFlowPosition, setNodes, setMenu]);

  const onNodeClick: NodeMouseHandler = useCallback(
    () => setMenu(null),
    [setMenu],
  );

  return { onPaneContextMenu, createNode, createTestWorkflowNode, onNodeClick };
}
