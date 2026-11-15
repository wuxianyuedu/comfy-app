"use client";

/* 尺寸预设表 controller（规范 17 §17.2 第②层）：把 lib/size-preset-store 的模块级快照接到 React，
 * 并把「改一格 / 恢复默认 / 是否已改」包成动作，视图只拿 table 与动作、不碰存储细节。
 * 用 useSyncExternalStore 而非 useEffect + setState：弹窗改一格，已挂载的尺寸控件（画布节点/库预览/表单
 * 可能同时存在）要在同一次渲染换值，且不触发「渲染期 setState」禁令（规范 §2.4 / §8.6）。
 *
 * 「项目默认」那份与「能不能写项目默认」那个开关也一并带出来（ISSUE #3948）：还原的
 * 基准是它（项目默认能被「保存到项目代码库」改过），而「保存到项目代码库」这个入口
 * 只在开发检出出现。 */

import { useCallback, useState, useSyncExternalStore } from "react";

import {
  getSizePresetDefaults,
  getSizePresetDefaultsServerSnapshot,
  getSizePresetProjectDefaultEditable,
  getSizePresetServerSnapshot,
  getSizePresetTable,
  resetSizePresetScene,
  saveSizePresetTableToProjectDefaults,
  setSizePresetDims,
  subscribeSizePresetTable,
} from "~/lib/media/size-preset-store";
import { errorText } from "~/lib/error-message";
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
  /** 这份检出能不能「保存到项目代码库」（正式包为 false，入口随之隐藏）。 */
  projectDefaultEditable: boolean;
  /** 把某场景整表恢复默认（另一个场景不受影响）。 */
  resetScene: (scene: SizeScene) => void;
  /** 「保存到项目代码库」：写进入库那份 JSON；返回写盘的路径（正式包为 null）。 */
  saveAsProjectDefaults: () => Promise<string | null>;
  /** 「保存到项目代码库」进行中。 */
  savingProjectDefaults: boolean;
  /** 改一格：场景 + 比例行 + 分辨率档。 */
  setDims: (scene: SizeScene, ratioLabel: string, tier: ResolutionTier, size: SizeDims) => void;
  /** 上一次动作的结果 / 失败原因（界面念它）。 */
  status: string | null;
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
  const projectDefaultEditable = useSyncExternalStore(
    subscribeSizePresetTable,
    getSizePresetProjectDefaultEditable,
    getSizePresetProjectDefaultEditable,
  );
  const [status, setStatus] = useState<string | null>(null);
  const [savingProjectDefaults, setSavingProjectDefaults] = useState(false);

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

  /* 「保存为项目默认（跟代码走）」：把当前这份表写进代码库那份 JSON（ISSUE #3948）。
   * 写完即生效（服务端现读磁盘那份），但**别的检出与桌包**要等提交 / 重新构建。 */
  const saveAsProjectDefaults = useCallback(async (): Promise<string | null> => {
    setSavingProjectDefaults(true);
    try {
      const { file } = await saveSizePresetTableToProjectDefaults(table);
      setStatus(
        `已写入项目默认（${file}），提交后每个检出与桌包都是这一份；` +
          "桌面包要把这份 JSON 重新构建才会带上。",
      );
      return file;
    } catch (error) {
      setStatus(errorText(error, "写入失败"));
      return null;
    } finally {
      setSavingProjectDefaults(false);
    }
  }, [table]);

  return {
    defaults,
    isModified,
    projectDefaultEditable,
    resetScene,
    saveAsProjectDefaults,
    savingProjectDefaults,
    setDims,
    status,
    table,
  };
}
