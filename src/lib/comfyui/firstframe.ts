// Shared helper: synthesize a first frame for local text-to-video by running a
// txt2img pass on the local ComfyUI instance, then uploading the result into
// ComfyUI's input dir so the WAN image-to-video graph can consume it. No cloud,
// no authorization — fully local.

import { promises as fs } from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { buildAndValidate } from "./workflow";
import { enqueue, subscribe } from "./runner";
import { uploadImage } from "./client";

export async function synthesizeFirstFrame(opts: {
  userId: string;
  prompt: string;
  negative?: string;
  size?: string;
}): Promise<string> {
  const { userId, prompt, negative, size } = opts;
  const built = await buildAndValidate("txt2img", {
    prompt,
    negative,
    size: size ?? "832x480",
    steps: 25,
    cfg: 7,
    sampler: "euler",
    scheduler: "normal",
    count: 1,
  });
  if (!built.ok || !built.prompt) throw new Error(built.error ?? "首帧构图失败");

  const task = await prisma.task.create({
    data: {
      userId,
      type: "TXT2IMG",
      prompt,
      negativePrompt: negative ?? null,
      params: {} as object,
      workflowName: "txt2img",
      status: "QUEUED",
    },
  });
  enqueue({ taskId: task.id, prompt: built.prompt });

  const localPath = await waitForImage(task.id);
  const rel = localPath.replace(/^\/api\//, ""); // "generated/<id>/img_0.png"
  const abs = path.join(process.cwd(), "public", rel);
  const buf = await fs.readFile(abs);
  const res = await uploadImage(buf, `ff_${task.id}.png`, "input");
  if (!res.name) throw new Error("首帧上传失败");
  return res.name;
}

// Resolve with the first generated image's local path, or reject on error/timeout.
function waitForImage(taskId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("首帧生成超时")), 5 * 60 * 1000);
    const off = subscribe(taskId, (e) => {
      if (e.type === "done") {
        clearTimeout(timeout);
        off();
        const imgs = (e.images as any[]).filter((im) => im.mediaType === "image");
        if (imgs[0]?.localPath) resolve(imgs[0].localPath);
        else reject(new Error("首帧无图像输出"));
      } else if (e.type === "error") {
        clearTimeout(timeout);
        off();
        reject(new Error(e.error));
      }
    });
  });
}
