/* ── 内容载体节点的图片组（多图相册）拉取逻辑 ──
 * 第②层逻辑：按 taskId 拉 task.detail，取图片列表，只有 >1 张才启用相册。
 * 拉取失败**静默**：单图模式仍要正常显示，不能把整个节点渲染成错误态。
 * taskId / enabled 切换必须立刻拿不到旧图，否则新任务首帧会渲染上一张；图集与上下文一起存 state。
 */

"use client";

import { useEffect, useState } from "react";

import { beginStaleRun } from "~/lib/stale-run";
import type { Dispatch, SetStateAction } from "react";
import { fetchTaskImages, type TaskGalleryImage } from "~/lib/media/task-images-client";

export type UseContentAssetGalleryArgs = {
  /** 只有 picture 节点启用相册；movie / text 不拉。 */
  enabled: boolean;
  taskId?: string | null;
};

export type ContentAssetGallery = {
  /** 多图时的图片列表（长度 > 1），单图 / 无图为 null。 */
  images: Array<TaskGalleryImage> | null;
  index: number;
  open: boolean;
  /** 传函数式更新：翻页要基于「上一张」算，视图里直接 `(i) => (i + 1) % n`。 */
  setIndex: Dispatch<SetStateAction<number>>;
  setOpen: (open: boolean) => void;
};

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
    images: Array<TaskGalleryImage> | null;
    key: string;
  }>({ key: ctxKey, images: null });
  const images = gallery.key === ctxKey ? gallery.images : null;

  useEffect(() => {
    if (taskId === undefined || taskId === null || taskId === "" || !enabled) {
      return;
    }
    /* 这一轮的作废守卫（规范 16 §16.2.4.34）：换任务 / 关掉开关会重开一轮，
     * 旧轮次的图集一律不落地（否则会短暂显示上一个任务的图）。 */
    const guard = beginStaleRun();
    void (async () => {
      try {
        const list = await fetchTaskImages(taskId);
        guard.commit(() => {
          setGallery({
            key: ctxKey,
            // oxlint-disable-next-line no-unnecessary-condition -- fetchTaskImages 的类型与实现都保证返回数组，判空恒真；保留相册降级口径，防空值防御被移除后静默崩溃
            images: list !== null && list.length > 1 ? list : null,
          });
        });
      } catch {
        /* 静默：单图模式仍正常显示，见文件头 */
      }
    })();
    return () => {
      guard.dispose();
    };
  }, [taskId, enabled, ctxKey]);

  return { images, open, index, setOpen, setIndex };
}
