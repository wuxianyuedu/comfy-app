"use client";

// ── 「尺寸配置表」分区的控制器（规范 17 §17.2 第②层）──────────────────────
//
// 表格的**唯一持有者**在服务端：项目默认（编译进包的 DEFAULT_SIZE_PRESET_TABLE）
// + 本机覆盖（`data/size-presets.json`），经 `setting.sizePresetGet` / `sizePresetSave`
// 读写（ISSUE #3788），读取侧逐格合并。本 hook 把 React Query 缓存接到视图，
// 并把「改一格 / 恢复默认 / 是否已改」包成动作。
//
// 改格走**乐观更新**：先改缓存（画布 / 表单里已挂载的尺寸控件同帧换值），再落盘；
// 落盘失败回读服务端那份（本地改动回退），并把原因念给界面。

import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";
import {
  DEFAULT_SIZE_PRESET_TABLE,
  sceneIsModified,
  type ResolutionTier,
  type SizeDims,
  type SizePresetTable,
  type SizeScene,
} from "~/lib/media/size-presets";

export type SizePresetSectionController = {
  /** 该场景相对默认值是否被改过。 */
  isModified: (scene: SizeScene) => boolean;
  /** 首次读取进行中（表格先按默认值渲染）。 */
  loading: boolean;
  /** 把某场景整表恢复默认（另一个场景不受影响）。 */
  resetScene: (scene: SizeScene) => void;
  /** 改一格：场景 + 比例行 + 分辨率档 + 宽高。 */
  setDims: (scene: SizeScene, ratioLabel: string, tier: ResolutionTier, size: SizeDims) => void;
  /** 保存 / 还原的失败原因（界面念它）。 */
  status: string | null;
  /** 当前生效的尺寸表（查询未回来时是默认表）。 */
  table: SizePresetTable;
};

export function useSizePresetSection(): SizePresetSectionController {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const query = useQuery(trpc.setting.sizePresetGet.queryOptions());
  const saveMutation = useMutation(trpc.setting.sizePresetSave.mutationOptions());
  const [status, setStatus] = useState<string | null>(null);

  const table = query.data ?? DEFAULT_SIZE_PRESET_TABLE;
  const queryKey = trpc.setting.sizePresetGet.queryKey();

  const setDims = useCallback(
    (scene: SizeScene, ratioLabel: string, tier: ResolutionTier, size: SizeDims) => {
      const current =
        queryClient.getQueryData<SizePresetTable>(queryKey) ?? DEFAULT_SIZE_PRESET_TABLE;
      const row = current[scene][ratioLabel];
      if (!row) {
        return;
      }
      const nextScene: SizePresetTable["image"] = {
        ...current[scene],
        [ratioLabel]: {
          ...row,
          [tier]: { width: size.width, height: size.height },
        },
      };
      const next: SizePresetTable =
        scene === "image" ? { ...current, image: nextScene } : { ...current, video: nextScene };
      /* 乐观：先改缓存（已挂载的尺寸控件同帧换值），再落盘；失败回读回退。 */
      queryClient.setQueryData(queryKey, next);
      saveMutation
        .mutateAsync(next)
        .then(() => {
          setStatus(null);
        })
        .catch((error: unknown) => {
          void queryClient.invalidateQueries({ queryKey });
          setStatus(`保存失败，已回退到服务端那份：${String(error)}`.slice(0, 200));
        });
    },
    [queryClient, queryKey, saveMutation],
  );

  const resetScene = useCallback(
    (scene: SizeScene) => {
      const current =
        queryClient.getQueryData<SizePresetTable>(queryKey) ?? DEFAULT_SIZE_PRESET_TABLE;
      const fresh = DEFAULT_SIZE_PRESET_TABLE;
      const next: SizePresetTable =
        scene === "image" ? { ...current, image: fresh.image } : { ...current, video: fresh.video };
      queryClient.setQueryData(queryKey, next);
      saveMutation
        .mutateAsync(next)
        .then(() => {
          setStatus(null);
        })
        .catch((error: unknown) => {
          void queryClient.invalidateQueries({ queryKey });
          setStatus(`还原失败，已回退到服务端那份：${String(error)}`.slice(0, 200));
        });
    },
    [queryClient, queryKey, saveMutation],
  );

  return {
    loading: query.isLoading,
    isModified: (scene: SizeScene) => sceneIsModified(scene, table),
    setDims,
    resetScene,
    table,
    status,
  };
}
