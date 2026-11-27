/**
 * 镜头低草图（ISSUE #5216）：复用正式生图通道，只把画幅压到草图预设。
 * 失败返回 null 由调用方记 warn，绝不阻断正式生图——这是廉价试错层，不是判据。
 */
import "server-only";

import { synthesizeFirstFrame } from "~/lib/comfyui/firstframe";
import { randomSeed } from "~/lib/comfyui/random-seed";
import { previewSizeOf } from "~/lib/workshop/storyboard-quality";

export async function generateShotPreview(opts: {
  negative?: string;
  params?: unknown;
  projectId: string;
  prompt: string;
  userId: string;
  workflowId: string;
}): Promise<string | null> {
  try {
    return await synthesizeFirstFrame({
      negative: opts.negative,
      projectId: opts.projectId,
      prompt: opts.prompt,
      seed: randomSeed(),
      size: previewSizeOf(opts.params),
      userId: opts.userId,
      workflowId: opts.workflowId,
    });
  } catch {
    return null;
  }
}
