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
import { FIRST_FRAME_WAIT, backoffDelayMs } from "~/lib/retry-policy";
import { isTerminalTaskStatus } from "~/lib/task-state";
import { taskRepository } from "../core/repository-task";
import { createWorkflowRunTask } from "~/lib/workshop/workflow-run.server";
import { uploadImage } from "./client";

export async function synthesizeFirstFrame(opts: {
  userId: string;
  /** 用来合成首帧的**图类**工作流库工作流 id。 */
  workflowId: string;
  prompt: string;
  negative?: string;
  size?: SizeSpec;
  projectId?: string | null;
  /** 采样种子：给了就落到工作流的「种子」口上（作者没连这一口则落不下去、用图内 seed）。
   *  「抽卡重生成」传一个新的随机值，让同提示词也能换图。 */
  seed?: number;
}): Promise<string> {
  const { userId, workflowId, prompt, negative, size, projectId, seed } = opts;
  const { taskId } = await createWorkflowRunTask({
    userId,
    workflowId,
    projectId: projectId ?? null,
    values: {
      prompt,
      ...(negative !== undefined ? { negativePrompt: negative } : {}),
      ...(size !== undefined ? { size } : {}),
      ...(seed !== undefined ? { seed } : {}),
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
// 成功时以第一张生成图的本地路径 resolve；出错/超时 reject。
//
// **读库里那一行，而不是订阅进程内事件**（P3 §5 ADR §14 D1 摘掉的第一个进程内
// 依赖）：emitter 只在写它的那个进程里响，`COMFY_EXECUTOR=host` 下执行的是宿主
// 进程，Next 这一侧永远等不到 `done` 帧——旧写法的表现是「文生视频」的第一跳
// 挂满 5min 超时后整条失败。DB 行是两种宿主共同的收口源（SSE 自 3-C 起也走
// 同一条），所以这里与 `/api/tasks/[id]/stream` 的轮询同形。
async function waitForImage(taskId: string): Promise<string> {
  for (let attempt = 0; attempt < FIRST_FRAME_WAIT.maxAttempts; attempt++) {
    const row = await taskRepository.findExecutionProgress(taskId);
    /* 行读不到 = 这一跳的任务已被删（用户清了历史）。不静默续等：那样只会
     * 变成「首帧生成超时」，把一个明确的删除问题伪装成性能问题。 */
    if (!row) throw new Error("首帧任务已不存在（可能被删除）");
    if (isTerminalTaskStatus(row.status)) {
      if (row.status !== "SUCCEEDED") {
        throw new Error(row.error ?? `首帧生成失败（${row.status}）`);
      }
      const outputs =
        (row.resultImages as Array<{
          mediaType?: string;
          localPath?: string;
        }> | null) ?? [];
      const first = outputs.find((im) => im.mediaType === "image");
      if (!first?.localPath) throw new Error("首帧无图像输出");
      return first.localPath;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, backoffDelayMs({ ...FIRST_FRAME_WAIT, attempt })),
    );
  }
  throw new Error("首帧生成超时");
}
