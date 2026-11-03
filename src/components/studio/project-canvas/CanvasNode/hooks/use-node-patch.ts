// 画布节点的 data patch 与自删：CanvasNode 的逻辑簇之一（§12.13，函数长度闸拆分）。
// 行为与原内联实现一致：patch 合并写回 data（带 SAFETY 断言），deleteSelf 按 id 过滤。
import { useCallback } from "react";
import { useReactFlow } from "@xyflow/react";

import type { CanvasNodeData } from "~/lib/project-canvas/canvas-types";

export function useNodePatch(id: string) {
  const { setNodes } = useReactFlow();

  const patch = useCallback(
    (p: Partial<CanvasNodeData>) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === id
            ? {
                ...node,
                /* SAFETY: 类型断言已复核 */
                data: {
                  ...(node.data as CanvasNodeData),
                  ...p,
                },
              }
            : node,
        ),
      );
    },
    [id, setNodes],
  );

  const deleteSelf = () => {
    setNodes((nds) => nds.filter((nd) => nd.id !== id));
  };

  return { deleteSelf, patch };
}
