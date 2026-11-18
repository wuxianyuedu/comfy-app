"use client";

// ── 镜头参考图上传（#4355）────────────────────────────────────────────
// 选中的本地文件先读成 data URL、经 /api/workshop-local/prepare 上传进
// ComfyUI 输入目录；镜头草稿里只存**文件名**（草稿体积可控，缩略图经
// /api/images?type=input 回读显示）。单张失败不拖垮整批：计入失败数并提示，
// 成功的照常返回（规范 10 §10.3.1，降级不得静默）。

import { useCallback, useState } from "react";

import { readFileAsDataUrl } from "~/lib/file-io";
import { prepareLocalInputImage } from "~/lib/workshop/generation-client";

export function useShotReferenceUpload(onError: (text: string) => void): {
  busy: boolean;
  /** 逐张上传，返回**成功**的文件名列表（失败的跳过并已提示）。 */
  upload: (files: Array<File>) => Promise<Array<string>>;
} {
  const [busy, setBusy] = useState(false);
  const upload = useCallback(
    async (files: Array<File>): Promise<Array<string>> => {
      setBusy(true);
      try {
        const filenames: Array<string> = [];
        let failed = 0;
        for (const file of files) {
          try {
            // oxlint-disable-next-line no-await-in-loop -- 逐张上传，单张失败不拖垮整批
            const dataUrl = await readFileAsDataUrl(file);
            // oxlint-disable-next-line no-await-in-loop -- 同上
            filenames.push(await prepareLocalInputImage(dataUrl));
          } catch {
            failed += 1;
          }
        }
        if (failed > 0) {
          onError(`${failed} 张参考图上传失败，本次未计入`);
        }
        return filenames;
      } finally {
        setBusy(false);
      }
    },
    [onError],
  );
  return { busy, upload };
}
