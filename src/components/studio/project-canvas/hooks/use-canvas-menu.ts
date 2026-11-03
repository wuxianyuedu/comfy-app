"use client";

// 画布右键菜单 + 节点落子的这一簇回调（Phase 4b 从 CanvasInner 抽出）。
// 四处职责内聚、只依赖 menu / setMenu / setNodes / 落点换算，抽出来让 CanvasInner
// 回到函数长度阈值内（规范 §12.13）；行为与原内联实现逐字一致，仅位置搬家。
import { useCallback, type Dispatch, type MouseEvent, type SetStateAction } from "react";
import type { NodeMouseHandler } from "@xyflow/react";

import { defaultData, type CanvasNodeType, type NodeKind } from "~/lib/project-canvas/canvas-types";
import { placeCanvasNode } from "~/lib/project-canvas/canvas-helpers";

type ScreenToFlowFn = Parameters<typeof placeCanvasNode>[0]["flow"]["screenToFlowPosition"];

type UseCanvasMenuArgs = {
  menu: { x: number; y: number } | null;
  screenToFlowPosition: ScreenToFlowFn;
  setMenu: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  setNodes: Dispatch<SetStateAction<Array<CanvasNodeType>>>;
};

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
        /* SAFETY: 类型断言已复核 */
        x: (e as globalThis.MouseEvent).clientX,
        /* SAFETY: 类型断言已复核 */
        y: (e as globalThis.MouseEvent).clientY,
      });
    },
    [setMenu],
  );

  /** 在右键位置放一个默认数据的节点（`placeCanvasNode` 是落点唯一出口）。 */
  const createNode = useCallback(
    (kind: NodeKind) => {
      if (!menu) {
        return;
      }
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
    if (!menu) {
      return;
    }
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

  const onNodeClick: NodeMouseHandler = useCallback(() => {
    setMenu(null);
  }, [setMenu]);

  return { onPaneContextMenu, createNode, createTestWorkflowNode, onNodeClick };
}
