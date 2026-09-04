"use client";

/* 2026-08-30: extracted from CanvasNode — file-upload plumbing.
 *  Three cohesive upload paths share this hook: the generator nodes'
 *  image input picker (fileRef + uploadTo), the content-carrier media
 *  picker (mediaRef + pickMedia/onMediaFile, incl. the write-only
 *  mediaKindRef kept verbatim) and the drag-and-drop upload handed over
 *  by ContentAssetBody (onUploadFile). The hidden <input> elements stay
 *  in CanvasNode's JSX; only the refs/handlers live here. */
import React from "react";
import { type CanvasNodeData } from "@/lib/project-canvas/canvas-types";
import { uploadImageFile, uploadMediaFile } from "@/lib/project-canvas/canvas-api";

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
  /* file upload helper */
  const fileRef = React.useRef<HTMLInputElement>(null);
  const uploadTo = React.useRef<"inputImage" | "firstFrame" | "lastFrame" | "media">("inputImage");
  const pickFile = (target: "inputImage" | "firstFrame" | "lastFrame" | "media") => {
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

  /* ── content-carrier upload helper (picture / movie nodes) ──
   * Reuses uploadMediaFile (drops into ComfyUI input dir, returns the
   * filename). The preview URL is derived in-render from mediaPath. */
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
  /* R-ardot101 (2026-08-17): drag-and-drop upload on the dashed area.
   *  Mirrors onMediaFile but takes a `File` instead of a `<input>` change
   *  event — the ContentAssetBody passes whatever the user dropped straight
   *  here.  The hidden input + pickMedia + FAB stay intact so the bottom-
   *  right "+" remains the only click-to-upload path. */
  const onUploadFile = async (f: File) => {
    try {
      const { name } = await uploadMediaFile(f);
      patch({ mediaPath: name, mediaName: f.name, upstreamId: undefined });
    } catch (err: unknown) {
      patch({ error: errorMessage(err) ?? "上传失败", status: "error" });
    }
  };

  return { fileRef, pickFile, onFile, mediaRef, pickMedia, onMediaFile, onUploadFile };
}
