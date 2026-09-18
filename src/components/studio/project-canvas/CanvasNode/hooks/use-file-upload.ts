"use client";

/* 从 CanvasNode 抽出 —— 文件上传管线。
 *  三条内聚的上传路径共用本 hook：生成器节点的
 *  图片输入选择器（fileRef + uploadTo）、内容载体媒体
 *  选择器（mediaRef + pickMedia/onMediaFile，含原样保留的
 *  只写 mediaKindRef）以及由 ContentAssetBody 交过来的拖放
 *  上传（onUploadFile）。隐藏的 <input> 元素仍在
 *  CanvasNode 的 JSX 里；这里只住 refs / 处理器。 */
import React from "react";
import { type CanvasNodeData } from "~/lib/project-canvas/canvas-types";
import {
  uploadImageFile,
  uploadMediaFile,
} from "~/lib/project-canvas/canvas-api";

/** catch 抛出值（unknown）→ 与旧 `err?.message ?? fallback` 逐值等价的
 *  消息提取：带 string message 的对象取 message（含空串），其余回退。 */
function errorMessage(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return undefined;
}

export interface UseFileUploadArgs {
  patch: (p: Partial<CanvasNodeData>) => void;
}

export function useFileUpload({ patch }: UseFileUploadArgs) {
  /* 文件上传辅助 */
  const fileRef = React.useRef<HTMLInputElement>(null);
  const uploadTo = React.useRef<
    "inputImage" | "firstFrame" | "lastFrame" | "media"
  >("inputImage");
  const pickFile = (
    target: "inputImage" | "firstFrame" | "lastFrame" | "media",
  ) => {
    uploadTo.current = target;
    fileRef.current?.click();
  };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      if (uploadTo.current === "media") {
        const { name } = await uploadMediaFile(f);
        patch({ mediaPath: name, mediaName: f.name, upstreamId: undefined });
      } else {
        const name = await uploadImageFile(f);
        patch({ [uploadTo.current]: name, upstreamId: undefined });
      }
    } catch (err: unknown) {
      patch({ error: errorMessage(err) ?? "上传失败", status: "error" });
    }
  };

  /* ── 内容载体上传辅助（图片 / 影片节点） ──
   * 复用 uploadMediaFile（丢进 ComfyUI 输入目录，返回
   * 文件名）。预览 URL 在渲染时由 mediaPath 推导。 */
  const mediaRef = React.useRef<HTMLInputElement>(null);
  const mediaKindRef = React.useRef<"picture" | "movie">("picture");
  const pickMedia = (k: "picture" | "movie") => {
    mediaKindRef.current = k;
    mediaRef.current?.click();
  };
  const onMediaFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const { name } = await uploadMediaFile(f);
      patch({ mediaPath: name, mediaName: f.name, upstreamId: undefined });
    } catch (err: unknown) {
      patch({ error: errorMessage(err) ?? "上传失败", status: "error" });
    }
  };
  /* 虚线区上的拖放上传。
   *  镜像 onMediaFile，但接收 `File` 而不是 `<input>` change
   *  事件 —— ContentAssetBody 把用户丢下的东西直接
   *  传到这里。隐藏 input + pickMedia + FAB 都保留，
   *  好让右下角「+」仍是唯一的点击上传路径。 */
  const onUploadFile = async (f: File) => {
    try {
      const { name } = await uploadMediaFile(f);
      patch({ mediaPath: name, mediaName: f.name, upstreamId: undefined });
    } catch (err: unknown) {
      patch({ error: errorMessage(err) ?? "上传失败", status: "error" });
    }
  };

  return {
    fileRef,
    pickFile,
    onFile,
    mediaRef,
    pickMedia,
    onMediaFile,
    onUploadFile,
  };
}
