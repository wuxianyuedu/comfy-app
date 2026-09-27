/* ── 内容载体节点的图片组（多图相册）拉取逻辑 ──────────────────────────
 * 从 ContentAssetBody（.tsx 视图）里抽出的第②层逻辑：
 *   1. 按 taskId 拉 task.detail，取出图片列表；只有 >1 张才启用相册
 *      （单图仍走节点主体的常规预览路径）；
 *   2. 相册开关与当前下标是纯视觉状态，但它们是「数据驱动」的（没有多图
 *      就没有相册可开），所以一并放在这里，视图只消费不决策。
 *
 * 错误策略：拉取失败**静默**——单图模式仍要正常显示内容，不能因为一次
 * 查询失败就把整个节点渲染成错误态。
 *
 * taskId / enabled 切换时要立刻拿不到旧图，否则新任务的首帧会先渲染上一张
 * 任务的相册缩略图。做法是把图集和「它属于哪一轮上下文」一起存成一条 state，
 * 渲染时按上下文键取值（不再用渲染期 setState 清空）。
 */

"use client";

import { useEffect, useState } from "react";

import { beginStaleRun } from "~/lib/stale-run";
import type { Dispatch, SetStateAction } from "react";
import {
  fetchTaskImages,
  type TaskGalleryImage,
} from "~/lib/media/task-images-client";

export interface UseContentAssetGalleryArgs {
  taskId?: string | null;
  /** 只有 picture 节点启用相册；movie / text 不拉。 */
  enabled: boolean;
}

export interface ContentAssetGallery {
  /** 多图时的图片列表（长度 > 1），单图 / 无图为 null。 */
  images: TaskGalleryImage[] | null;
  open: boolean;
  index: number;
  setOpen: (open: boolean) => void;
  /** 传函数式更新：翻页要基于「上一张」算，视图里直接 `(i) => (i + 1) % n`。 */
  setIndex: Dispatch<SetStateAction<number>>;
}

export function useContentAssetGallery({
  taskId,
  enabled,
}: UseContentAssetGalleryArgs): ContentAssetGallery {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const ctxKey = `${taskId ?? ""}|${enabled}`;
  /* 图集与「它属于哪一轮上下文」一起存成一条 state（P2：去掉渲染期 setState）。
   * 上下文变了就当作这一轮还没有图 —— 与原先在渲染期 `setImages(null)` 等价：
   * 新任务的首帧不会渲染上一任务的缩略图。 */
  const [gallery, setGallery] = useState<{
    key: string;
    images: TaskGalleryImage[] | null;
  }>({ key: ctxKey, images: null });
  const images = gallery.key === ctxKey ? gallery.images : null;

  useEffect(() => {
    if (!taskId || !enabled) return;
    /* 这一轮的作废守卫（规范 16 §16.2.4.34）：换任务 / 关掉开关会重开一轮，
     * 旧轮次的图集一律不落地（否则会短暂显示上一个任务的图）。 */
    const guard = beginStaleRun();
    void (async () => {
      try {
        const list = await fetchTaskImages(taskId);
        guard.commit(() =>
          setGallery({
            key: ctxKey,
            images: list && list.length > 1 ? list : null,
          }),
        );
      } catch {
        /* 静默：单图模式仍正常显示，见文件头 */
      }
    })();
    return () => guard.dispose();
  }, [taskId, enabled, ctxKey]);

  return { images, open, index, setOpen, setIndex };
}
