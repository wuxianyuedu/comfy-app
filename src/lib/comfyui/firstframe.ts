/* 共享助手：为本机文生视频合成首帧 —— 先在本机 ComfyUI 上跑一遍文生图，
 * 再把结果上传进 ComfyUI 的 input 目录，供图生视频的工作流消费。
 * 不走云、不需要授权 —— 全程本地。 */
//
// 图片这一跳没有内置模板（内置 txt2img 与 `__PROMPT__` 系列 token 替换已移除）：
// 调用方必须给一个**工作流库工作流 id**（图类、配好对外参数），本模块按工坊
// 的封装口径下发 提示词 / 尺寸，其余参数用工作流默认值。

import "server-only";
import { promises as fs } from "fs";
import path from "path";
import type { SizeSpec } from "~/lib/media/size-presets";
import { createWorkflowRunTask } from "~/lib/workshop/workflow-run.server";
import { subscribe } from "./enqueue";
import { uploadImage } from "./client";

export async function synthesizeFirstFrame(opts: {
  userId: string;
  /** 用来合成首帧的**图类**工作流库工作流 id。 */
  workflowId: string;
  prompt: string;
  negative?: string;
  size?: SizeSpec;
  projectId?: string | null;
}): Promise<string> {
  const { userId, workflowId, prompt, negative, size, projectId } = opts;
  const { taskId } = await createWorkflowRunTask({
    userId,
    workflowId,
    projectId: projectId ?? null,
    values: {
      prompt,
      ...(negative !== undefined ? { negativePrompt: negative } : {}),
      ...(size !== undefined ? { size } : {}),
    },
  });

  const localPath = await waitForImage(taskId);
  const rel = localPath.replace(/^\/api\//, ""); // "generated/<id>/img_0.png"
  const abs = path.join(process.cwd(), "public", rel);
  const buf = await fs.readFile(abs);
  const res = await uploadImage(buf, `ff_${taskId}.png`, "input");
  if (!res.name) throw new Error("首帧上传失败");
  return res.name;
}
// 成功时以第一张生成图的本地路径 resolve；出错或超时则 reject。
function waitForImage(taskId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("首帧生成超时")),
      5 * 60 * 1000,
    );
    const off = subscribe(taskId, (event) => {
      if (event.type === "done") {
        clearTimeout(timeout);
        off();
        const imgs = (
          event.images as Array<{ mediaType?: string; localPath?: string }>
        ).filter((im) => im.mediaType === "image");
        const first = imgs[0];
        if (first?.localPath) resolve(first.localPath);
        else reject(new Error("首帧无图像输出"));
      } else if (event.type === "error") {
        clearTimeout(timeout);
        off();
        reject(new Error(event.error));
      }
    });
  });
}
