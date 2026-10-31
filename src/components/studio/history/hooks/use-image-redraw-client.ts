"use client";

// ── 重绘 / 放大的组装层（规范 17 §17.2 第②层）────────────────
// 把 vanillaApi（模板清单）、上传（prepareLocalInputImage）与提交
// （startLocalGenerate）注进 useImageRedraw 的逻辑层——视图组件
// （ImageRedrawPanel）不直接触碰网络出口（S2 硬闸的面）。
import { vanillaApi } from "~/trpc/vanilla";
import { prepareLocalInputImage, startLocalGenerate } from "~/lib/workshop/generation-client";
import type { ActionReport } from "~/lib/async-action";

import { useImageRedraw, type ImageRedrawController } from "./use-image-redraw";

export interface ImageRedrawClientInput {
  parentTaskId: string;
  projectId?: string | null;
  prompt: string;
}

/** 视图层唯一入口：给提示词 / 归属 / 反馈通道，拿回完整控制器。 */
export function useImageRedrawClient(
  initial: ImageRedrawClientInput,
  report: ActionReport,
): ImageRedrawController {
  return useImageRedraw(
    {
      listTemplates: async () => {
        const res = await vanillaApi.workflow.list.query(undefined);
        return res.workflows.map((w) => ({
          id: w.id,
          name: w.name,
          taskType: w.taskType ?? null,
        }));
      },
      prepareImage: prepareLocalInputImage,
      submit: startLocalGenerate,
      report,
    },
    {
      prompt: initial.prompt,
      projectId: initial.projectId,
      parentId: initial.parentTaskId,
    },
  );
}
