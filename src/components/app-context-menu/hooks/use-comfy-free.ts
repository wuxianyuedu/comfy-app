"use client";

/**
 * 右键菜单「ComfyUI」组的卸载动作（ISSUE #4822）：同一端点
 * （`setting.comfyFree` → ComfyUI `POST /free`）的两档力度 —— `freeMemory=false`
 * 只卸显存里的模型权重；`true` 连执行缓存 / 非图像内存一起释放（更彻底，
 * 下一次出图要重新加载）。
 *
 * 逻辑按 §16.2.1 收在第②层（hooks/，UI/逻辑分离守卫的豁免位）：
 * 视图只拿「两颗可点动作 + 忙态」。反馈与 `useComfyuiControl.freeMemory`
 * 同一口径 —— 服务端信封的 `detail` 进 toast（成功「已卸载模型…」、
 * 「ComfyUI 未在运行…」这类可预期失败都由端点给），两项共享 busy 态防并发双发。
 */

import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { runAsyncAction } from "~/lib/async-action";
import { useToast } from "~/components/studio/ToastProvider";
import { useTRPC } from "~/trpc/react";

export function useComfyFree() {
  const trpc = useTRPC();
  const toast = useToast();
  const comfyFreeM = useMutation(trpc.setting.comfyFree.mutationOptions());
  const [freeing, setFreeing] = useState(false);

  const freeMemory = useCallback(
    async (freeMemory: boolean) => {
      setFreeing(true);
      try {
        await runAsyncAction(async () => comfyFreeM.mutateAsync({ freeMemory }), {
          report: (kind, text) => (kind === "ok" ? toast.success(text) : toast.error(text)),
          failureText: freeMemory ? "卸载模型和执行缓存失败" : "卸载模型失败",
        });
      } finally {
        setFreeing(false);
      }
    },
    [comfyFreeM, toast],
  );

  /* 对外只给「动作」不给 Promise：视图层的 onClick 不经意悬空 Promise
   * 会被 no-floating-promises 拦下，`void` 在这一层显式收口。 */
  const unloadModels = useCallback(() => {
    void freeMemory(false);
  }, [freeMemory]);
  const unloadModelsWithCache = useCallback(() => {
    void freeMemory(true);
  }, [freeMemory]);

  return { freeing, unloadModels, unloadModelsWithCache };
}
