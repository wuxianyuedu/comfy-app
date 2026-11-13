"use client";

/* CanvasNode 的文件上传管线。
 * 三条内聚路径共用：生成器的图片输入（pickFile + 隐藏 input）、内容载体媒体选择
 * （pickMedia / onMediaFile，含只写 mediaKindRef）、以及 ContentAssetBody 交来的拖放上传。
 * 隐藏 `<input>` 的持有与触发已收进 `~/components/ui/file-picker`。
 */
import React from "react";
import { useFilePicker } from "~/components/ui/file-picker";
import type { CanvasNodeData } from "~/lib/project-canvas/canvas-types";
import { errorMessage } from "~/lib/error-message";
import { uploadImageFile, uploadMediaFile } from "~/lib/project-canvas/canvas-api";

export type UseFileUploadArgs = {
  patch: (p: Partial<CanvasNodeData>) => void;
};

export function useFileUpload({ patch }: UseFileUploadArgs) {
  /* 文件上传辅助 */
  const uploadTo = React.useRef<"inputImage" | "firstFrame" | "lastFrame" | "media">("inputImage");

  const imagePicker = useFilePicker({
    accept: "image/*",
    /* `.then` 而不是 `async`：`onPick` 的契约是「不返回值」，写成 async
     * 会得到一个没人接的 Promise（eslint 的 no-misused-promises 直接拦）。 */
    onPick: (f) => {
      void uploadImageFile(f)
        .then((name) => {
          patch({ [uploadTo.current]: name, upstreamId: undefined });
        })
        .catch((error: unknown) => {
          patch({ error: errorMessage(error, "上传失败"), status: "error" });
        });
    },
  });

  const pickFile = (target: "inputImage" | "firstFrame" | "lastFrame" | "media") => {
    uploadTo.current = target;
    imagePicker.open();
  };

  /* ── 内容载体上传辅助（图片 / 影片节点） ──
   * 复用 uploadMediaFile（丢进 ComfyUI 输入目录，返回
   * 文件名）。预览 URL 在渲染时由 mediaPath 推导。 */
  const mediaKindRef = React.useRef<"picture" | "movie">("picture");

  const mediaPicker = useFilePicker({
    accept: "image/*,video/*",
    onPick: (f) => {
      void uploadMediaFile(f)
        .then(({ name }) => {
          patch({ mediaPath: name, mediaName: f.name, upstreamId: undefined });
        })
        .catch((error: unknown) => {
          patch({ error: errorMessage(error, "上传失败"), status: "error" });
        });
    },
  });

  const pickMedia = (k: "picture" | "movie") => {
    mediaKindRef.current = k;
    mediaPicker.open();
  };

  /* 虚线区上的拖放上传。
   *  镜像媒体 picker 的回调，但接收 `File` 而不是 `<input>` change
   *  事件 —— ContentAssetBody 把用户丢下的东西直接
   *  传到这里。隐藏 input + pickMedia + FAB 都保留，
   *  好让右下角「+」仍是唯一的点击上传路径。 */
  const onUploadFile = async (f: File) => {
    try {
      const { name } = await uploadMediaFile(f);
      patch({ mediaPath: name, mediaName: f.name, upstreamId: undefined });
    } catch (error: unknown) {
      patch({ error: errorMessage(error, "上传失败"), status: "error" });
    }
  };

  return {
    imageInputProps: imagePicker.inputProps,
    pickFile,
    mediaInputProps: mediaPicker.inputProps,
    pickMedia,
    onUploadFile,
  };
}
