/**
 * 首尾帧跨镜接力（ISSUE #5212）：上一镜片段的尾帧抽出来当下一镜首帧，
 * 借鉴 LocalMiniDrama 的「抽尾帧接首帧」与 MiniMax H3 Director 的 seam-aware 续接。
 * 抽帧失败或上一镜没有片段时**回落既有首帧**，不阻断生成（这是增强，不是判据）。
 */
import "server-only";

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { artifactDiskPath, artifactUrl, generatedRoot } from "~/lib/media/output-paths";
import { uniqueStamp } from "~/lib/unique-id";

/** ffmpeg 抽最后一帧的参数（纯函数，便于用例钉住形状）。 */
export function tailFrameArgs(clip: string, out: string): Array<string> {
  return ["-y", "-sseof", "-0.15", "-i", clip, "-frames:v", "1", "-q:v", "2", out];
}

function runFfmpeg(args: Array<string>): Promise<{ code: number }> {
  const bin = process.env.FFMPEG_BIN ?? "ffmpeg";
  return new Promise((resolve) => {
    const cp = spawn(/*turbopackIgnore: true*/ bin, args, { stdio: "ignore" });
    cp.on("error", () => {
      resolve({ code: -1 });
    });
    cp.on("close", (code) => {
      resolve({ code: code ?? -1 });
    });
  });
}

/**
 * 从上一镜片段抽尾帧，返回可喂 `resolveFilmFirstFrame` 的产物地址；
 * 地址非法、ffmpeg 不在、抽帧失败都返回 null（调用方回落静态首帧）。
 */
export async function extractTailFrameUrl(
  clipUrl: string,
  root: string = process.cwd(),
): Promise<string | null> {
  const clip = artifactDiskPath(clipUrl, generatedRoot(root));
  if (clip === null) {
    return null;
  }
  const dir = path.join(generatedRoot(root), "films", "tail");
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    return null;
  }
  const name = `${uniqueStamp("tail_")}.jpg`;
  const out = path.join(dir, name);
  const res = await runFfmpeg(tailFrameArgs(clip, out));
  return res.code === 0 ? artifactUrl(["films", "tail", name]) : null;
}

/**
 * 从镜头里读「接力来源镜号」。只认字符串，形状不对就当没开接力。
 */
export function continuityFromOf(shot: { continuityFromShotId?: unknown }): string | null {
  const value = shot.continuityFromShotId;
  return typeof value === "string" && value !== "" ? value : null;
}
