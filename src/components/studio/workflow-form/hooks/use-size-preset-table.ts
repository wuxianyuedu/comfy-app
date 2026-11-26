"use client";

/* 尺寸预设表 controller（规范 17 §17.2 第②层）：把 lib/size-preset-store 的模块级快照接到 React，
 * 并把「改一格 / 恢复默认 / 是否已改」包成动作，视图只拿 table 与动作、不碰存储细节。
 * 用 useSyncExternalStore 而非 useEffect + setState：弹窗改一格，已挂载的尺寸控件（画布节点/库预览/表单
 * 可能同时存在）要在同一次渲染换值，且不触发「渲染期 setState」禁令（规范 §2.4 / §8.6）。
 *
 * 「项目默认」那份也一并带出来（ISSUE #3948）：还原的基准是它（项目默认会随
 * 代码改动），运行期只读（ISSUE #5001）。 */

import { useCallback, useSyncExternalStore } from "react";

import {
  getSizePresetDefaults,
  getSizePresetDefaultsServerSnapshot,
  getSizePresetServerSnapshot,
  getSizePresetTable,
  resetSizePresetScene,
  setSizePresetDims,
  subscribeSizePresetTable,
} from "~/lib/media/size-preset-store";
import {
  sceneIsModified,
  type ResolutionTier,
  type SizeDims,
  type SizePresetTable,
  type SizeScene,
} from "~/lib/media/size-presets";

export type SizePresetTableController = {
  /** 项目默认那份（跟代码走的那份基线）：「恢复默认」的基准。 */
  defaults: SizePresetTable;
  /** 该场景相对**项目默认**是否被改过。 */
  isModified: (scene: SizeScene) => boolean;
  /** 把某场景整表恢复默认（另一个场景不受影响）。 */
  resetScene: (scene: SizeScene) => void;
  /** 改一格：场景 + 比例行 + 分辨率档。 */
  setDims: (scene: SizeScene, ratioLabel: string, tier: ResolutionTier, size: SizeDims) => void;
  /** 当前生效的尺寸表（用户改过的覆盖默认表）。 */
  table: SizePresetTable;
};

export function useSizePresetTable(): SizePresetTableController {
  const table = useSyncExternalStore(
    subscribeSizePresetTable,
    getSizePresetTable,
    getSizePresetServerSnapshot,
  );
  const defaults = useSyncExternalStore(
    subscribeSizePresetTable,
    getSizePresetDefaults,
    getSizePresetDefaultsServerSnapshot,
  );
  const setDims = useCallback(
    (scene: SizeScene, ratioLabel: string, tier: ResolutionTier, size: SizeDims) => {
      setSizePresetDims(scene, ratioLabel, tier, size);
    },
    [],
  );

  const resetScene = useCallback((scene: SizeScene) => {
    resetSizePresetScene(scene);
  }, []);

  const isModified = useCallback(
    (scene: SizeScene) => sceneIsModified(scene, table, defaults),
    [defaults, table],
  );

  return {
    defaults,
    isModified,
    resetScene,
    setDims,
    table,
  };
}
