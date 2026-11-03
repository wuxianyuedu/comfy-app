import { useCallback } from "react";
import type { ReactFlowInstance, XYPosition } from "@xyflow/react";

/**
 * MiniMap → 主视口单击跳转 hook。挂法：`const jump = useMiniMapJump(rf)`，再挂到 `<MiniMap pannable zoomable onClick={jump} />`。
 * React Flow 的 `<MiniMap onClick>` 已把点击坐标映射到 flow 空间，回调 `(event, position) => void` 的 position 就是被点处的 flow 坐标；直接用 `setCenter(position)` 居中到主画布并保留当前 zoom。
 * 拖动平移交给 MiniMap 自带的 `pannable`（拖动期间不触发 onClick），缩放交给 `zoomable`；Subgraph 切换时 rf 自动指向新的 ReactFlowInstance。
 * 不需要 bbox 比例换算 —— React Flow 内部用同一个 viewBox/transform 维护小地图 → flow 映射，position 已是精确 flow 坐标。 */
export function useMiniMapJump(rf: ReactFlowInstance) {
  return useCallback(
    (_event: React.MouseEvent, position: XYPosition) => {
      const { zoom } = rf.getViewport();
      void rf.setCenter(position.x, position.y, { zoom, duration: 350 });
    },
    [rf],
  );
}
