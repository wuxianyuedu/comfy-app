"use client";

/* 尺寸预设表的 controller（规范 17 §17.2 第②层）：把 `lib/size-preset-store`
 * 的模块级快照接到 React，并把「改一格 / 恢复默认 / 是否已改」包成动作，
 * 视图只拿 `table` 与三个动作渲染，不直接碰 localStorage。
 *
 * 用 `useSyncExternalStore` 而不是 `useEffect` + `setState`：配置弹窗里改一格，
 * 已经挂载的尺寸控件（画布节点 / 库内预览 / 表单可能同时存在）要在同一次渲染里
 * 换值，且不触发「渲染期 setState」禁令（规范 §2.4 / §8.6）。 */

import { useCallback, useSyncExternalStore } from "react";

import {
  getSizePresetServerSnapshot,
  getSizePresetTable,
  resetSizePresetScene,
  setSizePresetDims,
  subscribeSizePresetTable,
} from "~/lib/size-preset-store";
import {
  sceneIsModified,
  type ResolutionTier,
  type SizeDims,
  type SizePresetTable,
  type SizeScene,
} from "~/lib/size-presets";

export interface SizePresetTableController {
  /** 当前生效的尺寸表（用户改过的覆盖默认表）。 */
  table: SizePresetTable;
  /** 改一格：场景 + 比例行 + 分辨率档。 */
  setDims: (
    scene: SizeScene,
    ratioLabel: string,
    tier: ResolutionTier,
    size: SizeDims,
  ) => void;
  /** 把某场景整表恢复默认（另一个场景不受影响）。 */
  resetScene: (scene: SizeScene) => void;
  /** 该场景相对默认值是否被改过。 */
  isModified: (scene: SizeScene) => boolean;
}

export function useSizePresetTable(): SizePresetTableController {
  const table = useSyncExternalStore(
    subscribeSizePresetTable,
    getSizePresetTable,
    getSizePresetServerSnapshot,
  );

  const setDims = useCallback(
    (
      scene: SizeScene,
      ratioLabel: string,
      tier: ResolutionTier,
      size: SizeDims,
    ) => setSizePresetDims(scene, ratioLabel, tier, size),
    [],
  );

  const resetScene = useCallback(
    (scene: SizeScene) => resetSizePresetScene(scene),
    [],
  );

  const isModified = useCallback(
    (scene: SizeScene) => sceneIsModified(scene, table),
    [table],
  );

  return { table, setDims, resetScene, isModified };
}
