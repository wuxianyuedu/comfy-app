// ── 成片合成（MCP 本地）──────────────────────────────────────────
// 复用界面 FinalComposer 的「合成清单」语义：把分镜按序拼成时间线，写出 JSON
// 清单（data/workshop-compositions/<sessionId>.json）。当 ffmpeg 可用且片段为
// 本地文件时，可额外调用 ffmpeg 把片段（视频）或静帧（图片按 duration 占位）
// 合成为最终 mp4。不依赖 server-only，纯 Node 可跑。
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import {
  DEFAULT_SIZE_SPEC,
  sizeSpecToWxH,
  type SizeSpec,
} from "@/lib/size-presets";
import type { Shot } from "@/lib/workshop/types";

const COMPOSE_DIR = path.join(process.cwd(), "data", "workshop-compositions");
const execFileP = promisify(execFile);

/** 成片画幅：视频场景的 16:9 1k（= 1280×720）。
 *
 *  尺寸只在 `lib/size-presets` 里定义，这里不写像素字面量 —— 用户在「尺寸表配置」
 *  里改过视频场景的 16:9 1k，合成出来的片子跟着改。 */
const COMPOSE_SIZE: SizeSpec = { ...DEFAULT_SIZE_SPEC, ratio: "16:9 横屏" };
/** ffmpeg 的 `scale` 过滤器用 `W:H` 写法（不是 WxH）。 */
const COMPOSE_SCALE = sizeSpecToWxH(COMPOSE_SIZE, "video").replace("x", ":");

export interface CompositionSegment {
  order: number;
  shotId: string;
  scene: string;
  shotType: string;
  prompt: string;
  imageUrl: string | null;
  clipUrl: string | null;
  durationSec: number;
  motion: string;
  transition: string;
  dialogue: string;
}

export interface CompositionPlan {
  project: string;
  exportedAt: string;
  totalShots: number;
  totalDurationSec: number;
  segments: CompositionSegment[];
}

export interface RenderResult {
  ok: boolean;
  outputPath?: string;
  note?: string;
}

/** 由分镜构建有序合成清单（与界面 FinalComposer.exportPlan 对齐）。 */
export function buildCompositionPlan(
  title: string,
  shots: Shot[],
): CompositionPlan {
  const segments: CompositionSegment[] = shots.map((shot, i) => ({
    order: i + 1,
    shotId: shot.id,
    scene: shot.sceneHeading,
    shotType: shot.shotType,
    prompt: shot.prompt,
    imageUrl: shot.imageUrl ?? null,
    clipUrl: shot.clipUrl ?? null,
    durationSec:
      typeof shot.duration === "number" && shot.duration > 0
        ? shot.duration
        : 4,
    motion: shot.motion ?? "medium",
    transition: shot.transition ?? "cut",
    dialogue: shot.dialogue ?? "",
  }));
  const totalDurationSec = segments.reduce((acc, s) => acc + s.durationSec, 0);
  return {
    project: title,
    exportedAt: new Date().toISOString(),
    totalShots: segments.length,
    totalDurationSec: Number(totalDurationSec.toFixed(1)),
    segments,
  };
}

export async function writeCompositionPlan(
  sessionId: string,
  plan: CompositionPlan,
): Promise<string> {
  await fs.mkdir(COMPOSE_DIR, { recursive: true });
  const file = path.join(COMPOSE_DIR, `${sessionId}.json`);
  await fs.writeFile(file, JSON.stringify(plan, null, 2), "utf-8");
  return file;
}

function localPathOf(ref: string | null): string | null {
  if (!ref) return null;
  if (ref.startsWith("file://")) return ref.slice("file://".length);
  if (/^https?:\/\//i.test(ref)) return null; // 远程引用暂不处理
  return ref;
}

/**
 * 用 ffmpeg 把本地片段合成为成片 mp4（最佳努力）：
 *  - 视频片段 → 按 duration 截断、缩放到成片画幅
 *  - 仅图片的镜头 → 按 duration 以静帧占位
 * 任一片段不可用则跳过；无可用本地片段则仅返回清单。
 */
export async function renderComposition(
  plan: CompositionPlan,
  outputName: string,
): Promise<RenderResult> {
  const ff = process.env.FFMPEG_PATH ?? "ffmpeg";
  try {
    await execFileP(ff, ["-version"], { timeout: 5000 });
  } catch {
    return {
      ok: false,
      note: "未找到 ffmpeg（配置 FFMPEG_PATH 或加入 PATH 后可合成成片），本次仅产出合成清单",
    };
  }

  await fs.mkdir(COMPOSE_DIR, { recursive: true });
  const tmpDir = path.join(COMPOSE_DIR, `.tmp-${outputName}`);
  await fs.mkdir(tmpDir, { recursive: true });

  const segs: string[] = [];
  for (const s of plan.segments) {
    const clip = localPathOf(s.clipUrl);
    const img = localPathOf(s.imageUrl);
    const src = clip ?? img;
    if (!src) continue;
    const tmp = path.join(tmpDir, `seg-${s.order}.mp4`);
    const scale = `scale=${COMPOSE_SCALE}`;
    const args = clip
      ? [
          "-i",
          src,
          "-t",
          String(s.durationSec),
          "-vf",
          scale,
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-an",
          tmp,
        ]
      : [
          "-loop",
          "1",
          "-i",
          src,
          "-t",
          String(s.durationSec),
          "-r",
          "25",
          "-vf",
          scale,
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-an",
          tmp,
        ];
    try {
      await execFileP(ff, args, { timeout: 120_000 });
      segs.push(tmp);
    } catch {
      /* 单片段渲染失败 → 跳过 */
    }
  }

  if (segs.length === 0) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    return {
      ok: false,
      note: "没有可用的本地片段（clipUrl/imageUrl 需为本地路径），仅产出合成清单",
    };
  }

  const listFile = path.join(tmpDir, "list.txt");
  await fs.writeFile(
    listFile,
    segs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
    "utf-8",
  );
  const out = path.join(COMPOSE_DIR, `${outputName}.mp4`);
  try {
    await execFileP(
      ff,
      ["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", out],
      {
        timeout: 300_000,
      },
    );
  } catch (e) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    return {
      ok: false,
      note: `ffmpeg 合成失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
  return { ok: true, outputPath: out };
}
