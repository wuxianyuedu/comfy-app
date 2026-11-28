/**
 * 成片交付承诺自检 + 观感只读判据（ISSUE #5276，借鉴 OpenMontage 的合成前/渲染后自审）：
 * ffprobe 只回答「文件能不能播」，本模块回答「是否兑现了这次请求」与「画面/声音是否像成片」。
 * 黑帧 / 静音 / 冻结段都由 ffmpeg 的现成滤镜给出，不引入图像解码依赖。
 * 纯函数不碰 IO；`runFilmAudit` 是唯一的外部调用点。
 */
import "server-only";

import { spawn } from "node:child_process";

export type FilmAudit = {
  /** 黑帧累计秒数。 */
  blackSeconds: number;
  /** 最长一段冻结（画面几乎不动）秒数——幻灯片风险的主要读数。 */
  frozenLongest: number;
  /** 静音累计秒数。 */
  silentSeconds: number;
};

/** 用户请求兑现与否的受控快照；expectedDuration 由镜头时长累加得出。 */
export type DeliveryPromise = {
  expectedDuration: number;
  expectSubtitle: boolean;
  hasSubtitle: boolean;
  height: number;
  width: number;
};

export type AuditVerdict = {
  errors: Array<string>;
  warnings: Array<string>;
};

/** ffmpeg 滤镜参数：视频侧 blackdetect + freezedetect，音频侧 silencedetect。 */
export function auditArgs(file: string): Array<string> {
  return [
    "-y",
    "-i",
    file,
    "-vf",
    "blackdetect=d=0.2:pix_th=0.10,freezedetect=n=-60dB:d=1.5",
    "-af",
    "silencedetect=noise=-50dB:d=0.6",
    "-f",
    "null",
    "-",
  ];
}

/** ffmpeg stderr 里的检测行 → 秒数（只认有限非负数，形状不对当 0）。 */
export function parseAudit(stderr: string): FilmAudit {
  const numbers = (pattern: RegExp): Array<number> =>
    [...stderr.matchAll(pattern)]
      .map((match) => Number(match.groups?.seconds))
      .filter((value) => Number.isFinite(value) && value >= 0);
  const sum = (pattern: RegExp): number =>
    Math.round(numbers(pattern).reduce((total, value) => total + value, 0) * 100) / 100;
  const freezes = numbers(/freeze_duration:\s*(?<seconds>[\d.]+)/g);
  return {
    blackSeconds: sum(/black_duration:\s*(?<seconds>[\d.]+)/g),
    frozenLongest: freezes.length === 0 ? 0 : Math.round(Math.max(...freezes) * 100) / 100,
    silentSeconds: sum(/silence_duration:\s*(?<seconds>[\d.]+)/g),
  };
}

/**
 * 交付承诺：时长与请求同量级（允许 15% 或 2 秒的编码误差），字幕开关与实际产物一致。
 * 画幅的精确比对仍由 `checkFilmQuality` 承担，这里不重复。
 */
export function checkDeliveryPromise(
  probe: { duration: number | null },
  promise: DeliveryPromise,
): AuditVerdict {
  const errors: Array<string> = [];
  const warnings: Array<string> = [];
  const tolerance = Math.max(2, promise.expectedDuration * 0.15);
  if (probe.duration !== null && Math.abs(probe.duration - promise.expectedDuration) > tolerance) {
    errors.push(
      `成片时长 ${probe.duration}s 与请求 ${promise.expectedDuration}s 不符（允许误差 ${Math.round(tolerance)}s）`,
    );
  }
  if (promise.expectSubtitle && !promise.hasSubtitle) {
    errors.push("请求开启字幕，但成片没有字幕内容");
  }
  if (promise.hasSubtitle && !promise.expectSubtitle) {
    warnings.push("请求未开字幕，但成片带了字幕内容");
  }
  return { errors, warnings };
}

/**
 * 观感判据：整片几乎全黑 / 全程静音才硬拦（转场淡入淡出的短黑短静音只记告警）；
 * 冻结段占比高只告警——静态构图是合法创作选择，不该把导演的选择当错误。
 */
export function checkFilmAudit(
  audit: FilmAudit,
  duration: number | null,
  opts: { hasAudio: boolean },
): AuditVerdict {
  const errors: Array<string> = [];
  const warnings: Array<string> = [];
  const total = duration !== null && duration > 0 ? duration : 0;
  const ratio = (seconds: number): number => (total === 0 ? 0 : seconds / total);

  if (ratio(audit.blackSeconds) > 0.8) {
    errors.push(`成片 ${audit.blackSeconds}s 几乎全黑，不是可交付画面`);
  } else if (audit.blackSeconds > 0) {
    warnings.push(`检测到黑帧累计 ${audit.blackSeconds}s（转场或收尾，请人工确认）`);
  }
  if (ratio(audit.silentSeconds) > 0.8 && opts.hasAudio) {
    errors.push(`成片 ${audit.silentSeconds}s 几乎全程静音，音轨可能没有内容`);
  } else if (audit.silentSeconds > 0 && opts.hasAudio) {
    warnings.push(`检测到静音累计 ${audit.silentSeconds}s（请人工确认对白/配乐）`);
  }
  if (ratio(audit.frozenLongest) > 0.5 || audit.frozenLongest > 5) {
    warnings.push(
      `最长 ${audit.frozenLongest}s 画面几乎不动，有成片「幻灯片感」风险（请人工确认）`,
    );
  }
  return { errors, warnings };
}

/** 真跑 ffmpeg 自检；拿不到 stderr 返回 null（区分「没量到」与「量到有问题」）。 */
export async function runFilmAudit(file: string): Promise<FilmAudit | null> {
  const bin = process.env.FFMPEG_BIN ?? "ffmpeg";
  return new Promise((resolve) => {
    const cp = spawn(/*turbopackIgnore: true*/ bin, auditArgs(file), {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    cp.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    cp.on("error", () => {
      resolve(null);
    });
    cp.on("close", (code) => {
      resolve(code === 0 ? parseAudit(stderr) : null);
    });
  });
}
