/**
 * 成片镜头首帧的落点转换（ISSUE #5141）。
 *
 * 工坊阶段④定稿的分镜图存的是应用产物地址（`/api/generated/...`），而 ComfyUI 的
 * `LoadImage` 只认 input 目录里的文件名。本模块是这段转换的唯一落点：
 * 产物地址 → 本地盘 → 读字节 → 上传 input → 换回上传后的文件名；
 * 已经是 input 文件名的（旧任务 / Agent 自己合成的首帧）原样返回，不重复上传。
 */
import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { uploadImage } from "~/lib/comfyui/client";
import { ARTIFACT_URL_PREFIX, artifactDiskPath } from "~/lib/media/output-paths";
import { uniqueStamp } from "~/lib/unique-id";

/** 产物地址形态：`/api/generated/...`（及历史 `/generated/...`）。
 *  前缀判定复用唯一出处的常量（`ARTIFACT_URL_PREFIX`），不另写正则形状（台账 A8）。 */
function isArtifactUrl(value: string): boolean {
  const legacyPrefix = ARTIFACT_URL_PREFIX.slice("/api".length);
  return value.startsWith(`${ARTIFACT_URL_PREFIX}/`) || value.startsWith(`${legacyPrefix}/`);
}

/**
 * 把镜头首帧折成 ComfyUI 可消费的 input 文件名。
 * 非产物地址（已经是文件名 / 远端 URL）原样返回；产物地址非法或读不到时抛，
 * 让失败在任务行里可读，不静默换成「另合成一张」。
 */
export async function resolveFilmFirstFrame(value: string): Promise<string> {
  if (!isArtifactUrl(value)) {
    return value;
  }
  const abs = artifactDiskPath(value);
  if (abs === null) {
    throw new Error(`成片首帧的产物地址不合法：${value}`);
  }
  const buffer = await readFile(abs);
  const ext = path.extname(abs).slice(1).toLowerCase() || "png";
  const uploaded = await uploadImage(buffer, `${uniqueStamp("film_ff_")}.${ext}`, "input");
  if (uploaded.name === undefined || uploaded.name === "") {
    throw new Error("成片首帧上传失败");
  }
  return uploaded.name;
}
