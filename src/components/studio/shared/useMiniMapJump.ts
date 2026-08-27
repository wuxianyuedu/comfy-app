import { useCallback } from "react";
import type { ReactFlowInstance, XYPosition } from "@xyflow/react";

/**
 * MiniMap → main-viewport single-click jump hook.
 *
 * 用法：
 *   const rf = useReactFlow();
 *   const jump = useMiniMapJump(rf);
 *   <MiniMap pannable zoomable onClick={jump} ... />
 *
 * 工作原理：
 *   React Flow 的 `<MiniMap onClick>` 已经帮我们把点击坐标映射到 flow 空间，
 *   回调签名是 `(event, position: XYPosition) => void`，这里的 position
 *   就是小地图被点击位置对应的 flow 坐标。我们直接用 `setCenter(position)` 把
 *   该点居中到主画布中央、并保留当前 zoom。
 *
 * 备注：
 *   • 拖动平移交给 MiniMap 自带的 `pannable` props —— 拖动期间 onClick 不会
 *     触发，没有冲突。
 *   • wheel-zoom 交给 MiniMap 自带的 `zoomable` props。
 *   • Subgraph 切换时 rf 自动指向新的 ReactFlowInstance，无须处理。
 *   • 不需要做 bbox 比例换算——React Flow 内部用同一个 viewBox/transform
 *     维护小地图 → flow 的映射，position 已经是精确的 flow 坐标。
 */
export function useMiniMapJump(rf: ReactFlowInstance) {
  return useCallback(
    (_event: React.MouseEvent, position: XYPosition) => {
      const { zoom } = rf.getViewport();
      void rf.setCenter(position.x, position.y, { zoom, duration: 350 });
    },
    [rf]
  );
}
