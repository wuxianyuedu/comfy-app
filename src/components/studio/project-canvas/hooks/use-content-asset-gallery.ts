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
 * taskId / enabled 切换时在**渲染期**清空旧图（React 19 的「渲染期调整
 * state」范式）：否则新任务的首帧会先渲染上一张任务的相册缩略图。
 */

"use client";

import { useEffect, useState } from "react";
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
  const [images, setImages] = useState<TaskGalleryImage[] | null>(null);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const ctxKey = `${taskId ?? ""}|${enabled}`;
  const [prevCtxKey, setPrevCtxKey] = useState(ctxKey);
  if (ctxKey !== prevCtxKey) {
    setPrevCtxKey(ctxKey);
    setImages(null);
  }

  useEffect(() => {
    if (!taskId || !enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchTaskImages(taskId);
        if (cancelled) return;
        setImages(list && list.length > 1 ? list : null);
      } catch {
        /* 静默：单图模式仍正常显示，见文件头 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId, enabled]);

  return { images, open, index, setOpen, setIndex };
}
