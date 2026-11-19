"use client";

// ── 测试模型页的参考图组（#3949 需求 6/7）────────────────────────────────
// 多张取值（data URL）+ 追加 / 移除 / 清空。从 use-model-test 拆出
// （§12.13：useModelTest 越过函数长度硬闸前的第一刀），只服务于测试页表单。

import { useCallback, useState } from "react";

import { readFileAsDataUrl } from "~/lib/file-io";
import { runAsyncAction } from "~/lib/async-action";

/** 参考图组上限：多参考图统一支持 1~16 张（#4355，含工坊镜头与测试页）。 */
export const REFERENCE_IMAGE_MAX = 16;

/** 参考图组（#3949 需求 6/7）的子 hook：多张取值（data URL）+ 追加 / 移除 /
 * 清空。 */
export function useReferenceImageGroup(onError: (text: string) => void): {
  add: (files: Array<File>) => Promise<void>;
  images: Array<string>;
  remove: (index: number) => void;
  reset: () => void;
} {
  const [images, setImages] = useState<Array<string>>([]);
  const add = useCallback(
    async (files: Array<File>) => {
      await runAsyncAction(
        async () => {
          const urls: Array<string> = [];
          for (const file of files) {
            // oxlint-disable-next-line no-await-in-loop -- 顺序读文件，失败即停
            urls.push(await readFileAsDataUrl(file));
          }
          /* 上限 16 张（#4355：多参考图统一 1~16）。 */
          setImages((prev) => [...prev, ...urls].slice(0, REFERENCE_IMAGE_MAX));
          return { ok: true as const };
        },
        {
          report: (k, text) => {
            if (k === "err") {
              onError(text);
            }
          },
          failureText: "读取参考图失败",
        },
      );
    },
    [onError],
  );
  const remove = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);
  const reset = useCallback(() => {
    setImages([]);
  }, []);
  return { add, images, remove, reset };
}
