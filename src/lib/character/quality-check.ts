/**
 * 角色立绘质量检查（ISSUE #5009 反馈）：对已生成的立绘做**确定性**质量打分，
 * 找出需要重新生成的失败图（纯色 / 空白 / 低分辨率 / 文件异常）。
 *
 * 打分是规则化的（0~100，越低越差），不依赖外部模型：
 *   - PNG 解码失败               → 0 分（文件损坏或不是 PNG）
 *   - 画面亮度方差极低           → 疑似纯色 / 空白图（重扣）
 *   - 采样色彩过于单一           → 疑似失败图
 *   - 分辨率过低 / 文件过小      → 生成参数异常
 *
 * PNG 解码是纯 JS 实现（node:zlib 解压 + 逐行反滤波），只为质量指标服务：
 * 不引原生图像依赖。只支持 8bit 非隔行的 RGB / RGBA / 灰度（ComfyUI 产物
 * 都是这一档），其余形态返回 null，由调用方按「无法细看、按文件大小判」兜底。
 */

import { inflateSync } from "node:zlib";

import { clampInt } from "~/lib/clamp";

/** 解码结果：像素按行存（RGB 或 RGBA，channels 1/3/4）。 */
export type DecodedPng = {
  channels: number;
  height: number;
  pixels: Uint8Array;
  width: number;
};

/** PNG 签名（固定 8 字节）。 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** 解析 PNG：返回像素；不支持的形态（16bit / 调色板 / 隔行 / 非 PNG）返回 null。 */
export function decodePng(buf: Uint8Array): DecodedPng | null {
  if (buf.length < 57 || PNG_SIGNATURE.some((byte, i) => (buf[i] ?? -1) !== byte)) {
    return null;
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  const interlace = buf[28];
  if (width === 0 || height === 0 || bitDepth !== 8 || interlace !== 0) {
    return null;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (channels === 0) {
    return null;
  }
  const idat: Uint8Array[] = [];
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(
      buf[pos + 4] ?? 0,
      buf[pos + 5] ?? 0,
      buf[pos + 6] ?? 0,
      buf[pos + 7] ?? 0,
    );
    if (type === "IDAT") {
      idat.push(buf.subarray(pos + 8, pos + 8 + len));
    }
    if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  const compressedTotal = idat.reduce((sum, chunk) => sum + chunk.length, 0);
  if (compressedTotal === 0) {
    return null;
  }
  const compressed = new Uint8Array(compressedTotal);
  let offset = 0;
  for (const chunk of idat) {
    compressed.set(chunk, offset);
    offset += chunk.length;
  }
  let raw: Uint8Array;
  try {
    raw = inflateSync(compressed);
  } catch {
    return null;
  }
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) {
    return null;
  }
  const pixels = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y++) {
    const srcStart = y * (stride + 1);
    const filter = raw[srcStart];
    const outStart = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? (pixels[outStart + x - channels] ?? 0) : 0;
      const up = y > 0 ? (pixels[outStart - stride + x] ?? 0) : 0;
      const upLeft = x >= channels && y > 0 ? (pixels[outStart - stride + x - channels] ?? 0) : 0;
      let value = raw[srcStart + 1 + x] ?? 0;
      switch (filter) {
        case 1: {
          value = (value + left) & 0xff;
          break;
        }
        case 2: {
          value = (value + up) & 0xff;
          break;
        }
        case 3: {
          value = (value + ((left + up) >> 1)) & 0xff;
          break;
        }
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          value = (value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 0xff;
          break;
        }
        default: {
          break;
        }
      }
      pixels[outStart + x] = value;
    }
  }
  return { channels, height, pixels, width };
}

export type PortraitQualityMetrics = {
  /** 亮度标准差（0~127 量级，越低越「平」）。 */
  brightnessStddev: number;
  /** 采样像素里不同颜色的占比（0~1，越低越「平」）。 */
  colorRatio: number;
  fileSize: number;
  height: number;
  width: number;
};

export type PortraitQuality = {
  issues: Array<string>;
  metrics: PortraitQualityMetrics | null;
  score: number;
};

/** 分数低于这一档的立绘判为「有问题，需要重新生成」。 */
export const PORTRAIT_REGENERATE_THRESHOLD = 60;

/** 采样的像素上限（大图按步长抽样，解码后只扫一遍）。 */
const SAMPLE_TARGET = 200_000;

/** 对一份 PNG 文件字节打分。非 PNG / 解码失败 → score 0 + 对应 issue。 */
export function scorePortraitPng(file: Uint8Array): PortraitQuality {
  const decoded = decodePng(file);
  if (decoded === null) {
    return {
      issues: ["图片无法解码（不是 PNG、已损坏，或是不支持的像素格式）"],
      metrics: null,
      score: 0,
    };
  }
  const { width, height, channels, pixels } = decoded;
  const total = width * height;
  const stride = Math.max(1, Math.floor(total / SAMPLE_TARGET));
  let sampled = 0;
  let brightnessSum = 0;
  let brightnessSquareSum = 0;
  const colors = new Set<string>();
  for (let p = 0; p < total; p += stride) {
    const base = p * channels;
    const r = pixels[base] ?? 0;
    const g = channels >= 3 ? (pixels[base + 1] ?? 0) : r;
    const b = channels >= 3 ? (pixels[base + 2] ?? 0) : r;
    const brightness = (r + g + b) / 3;
    brightnessSum += brightness;
    brightnessSquareSum += brightness * brightness;
    colors.add(`${r},${g},${b}`);
    sampled += 1;
  }
  const mean = brightnessSum / sampled;
  const variance = Math.max(0, brightnessSquareSum / sampled - mean * mean);
  const stddev = Math.sqrt(variance);
  const colorRatio = colors.size / sampled;

  const metrics: PortraitQualityMetrics = {
    brightnessStddev: Math.round(stddev * 100) / 100,
    colorRatio: Math.round(colorRatio * 10_000) / 10_000,
    fileSize: file.length,
    height,
    width,
  };

  let score = 100;
  const issues: Array<string> = [];
  if (stddev < 6) {
    score -= 70;
    issues.push("画面亮度几乎无变化（疑似纯色 / 空白图）");
  } else if (stddev < 15) {
    score -= 30;
    issues.push("画面对比度极低");
  }
  if (colorRatio < 0.02) {
    score -= 25;
    issues.push("采样色彩过于单一（疑似失败图）");
  }
  if (width < 512 || height < 512) {
    score -= 20;
    issues.push(`分辨率过低（${width}×${height}）`);
  }
  if (file.length < 15_000) {
    score -= 20;
    issues.push("文件过小（疑似近乎空白的图）");
  }
  return { issues, metrics, score: clampInt(score, 0, 100) };
}

/** 一张立绘要不要按这次打分重新生成。 */
export function needsRegeneration(quality: PortraitQuality): boolean {
  return quality.score < PORTRAIT_REGENERATE_THRESHOLD;
}
