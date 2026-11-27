/**
 * 成片质量闸（ISSUE #5214）：合成前后用 ffprobe 数产物——缺片、无视频流、时长为 0、
 * 分辨率与目标不符都不许静默出片。借鉴 NovelVids 的「成片质量检查」路线图。
 * 这里只做只读判据：不修产物、不改判据，硬错抛出让合成链 markFailed。
 */
import "server-only";

import { spawn } from "node:child_process";

import { asRecord } from "~/lib/is-record";

/** ffprobe 的流读数（外部 JSON 形状，逐字段 typeof 校验） */
export type StreamProbe = {
  codec_type?: unknown;
  duration?: unknown;
  height?: unknown;
  width?: unknown;
};

export type FilmProbe = {
  duration: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
  height: number | null;
  width: number | null;
};

/** ffprobe 参数（纯函数）。 */
export function ffprobeArgs(file: string): Array<string> {
  return ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", file];
}

/** 外部 JSON → 受控读数；形状不对的字段落 null/false，不猜。 */
export function parseProbe(json: unknown): FilmProbe {
  const root = asRecord(json) ?? {};
  const streams: Array<unknown> = Array.isArray(root.streams)
    ? root.streams.map((item: unknown) => item)
    : [];
  const video = streams.find((s) => asRecord(s)?.codec_type === "video");
  const audio = streams.some((s) => asRecord(s)?.codec_type === "audio");
  const videoRec = asRecord(video);
  const num = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value)
      ? value
      : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))
        ? Number(value)
        : null;
  const format = asRecord(root.format) ?? {};
  return {
    duration: num(videoRec?.duration) ?? num(format.duration),
    hasAudio: audio,
    hasVideo: videoRec !== null,
    height: num(videoRec?.height),
    width: num(videoRec?.width),
  };
}

/**
 * 质量检查：返回人类可读的问题清单。
 * `missingClips` 是合成前就已经发现的缺片（按镜头序号），一并写进读数。
 */
export function checkFilmQuality(
  probe: FilmProbe,
  expected: { height: number; width: number },
  missingClips: Array<number> = [],
): Array<string> {
  const issues: Array<string> = [];
  if (missingClips.length > 0) {
    issues.push(`缺片：第 ${missingClips.join("、")} 镜没有视频片段`);
  }
  if (!probe.hasVideo) {
    issues.push("成片没有视频流");
  }
  if (probe.duration === null || probe.duration <= 0) {
    issues.push("成片时长为 0（没有可播放内容）");
  }
  if (probe.width !== null && probe.width !== expected.width) {
    issues.push(`宽度 ${probe.width} ≠ 目标 ${expected.width}`);
  }
  if (probe.height !== null && probe.height !== expected.height) {
    issues.push(`高度 ${probe.height} ≠ 目标 ${expected.height}`);
  }
  return issues;
}

/** 真跑 ffprobe；拿不到 JSON 返回 null（区分「没量到」与「量到有问题」）。 */
export async function probeFilm(file: string): Promise<FilmProbe | null> {
  const bin = process.env.FFPROBE_BIN ?? "ffprobe";
  return new Promise((resolve) => {
    const cp = spawn(/*turbopackIgnore: true*/ bin, ffprobeArgs(file), { stdio: "ignore" });
    let out = "";
    cp.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    cp.on("error", () => {
      resolve(null);
    });
    cp.on("close", (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      try {
        resolve(parseProbe(JSON.parse(out) as unknown));
      } catch {
        resolve(null);
      }
    });
  });
}
