// ── Film Studio orchestrator ─────────────────────────────────
// One-click complete film pipeline:
//   script → auto storyboard (shots) → per-shot video generation
//   (reusing the ComfyUI video workflow) → ffmpeg concat (+ subtitles / BGM)
//   → a single finished film.
//
// Reuses buildAndValidate + enqueue so each shot goes through the exact same
// pipeline as the manual "video" tab.

import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { getServerUser } from "@/lib/auth-server";
import { buildAndValidate } from "@/lib/comfyui/workflow";
import { getWorkflow } from "@/lib/comfyui/_meta";
import { enqueue, cancelTask } from "@/lib/comfyui/runner";
import { synthesizeFirstFrame } from "@/lib/comfyui/firstframe";
import { getSettingsSync } from "@/lib/app-settings";
import { parseIdeaToScenes } from "@/lib/workshop/script-parser";
import { getLLMConfig, completeLLM } from "@/lib/llm/server";

export type FilmStatus =
  | "PARSING"
  | "GENERATING"
  | "COMPOSING"
  | "DONE"
  | "FAILED"
  | "CANCELLED";

export type ShotStatus = "IDLE" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";

export interface FilmShotInput {
  order: number;
  heading?: string;
  prompt: string;
  negative?: string;
}

export interface CreateFilmInput {
  userId: string;
  title: string;
  script: string;
  type?: string;
  styleSlug?: string | null;
  size?: string;
  fps?: number;
  framesPerShot?: number;
  subtitleOn?: boolean;
  bgmName?: string | null;
}

const FILM_NEGATIVE =
  "low quality, blurry, deformed, watermark, text, distorted, extra limbs, bad anatomy";

const CAMERA_KEYWORDS = [
  "cinematic wide shot",
  "medium shot, waist-up",
  "close-up, detailed face",
  "extreme wide shot, epic scale",
  "low angle shot",
  "high angle shot",
  "tracking shot, dynamic motion",
  "slow drift, dreamy atmosphere",
];

// ── logging ────────────────────────────────────────────────
async function appendFilmLog(
  id: string,
  level: "info" | "progress" | "warn" | "error" | "success",
  msg: string
) {
  const entry = { t: Date.now(), level, msg };
  const film = await prisma.filmProject.findUnique({ where: { id }, select: { logs: true } });
  const arr = (film?.logs as any[]) ?? [];
  arr.push(entry);
  await prisma.filmProject.update({ where: { id }, data: { logs: arr as any } }).catch(() => {});
}

// ── script → storyboard ────────────────────────────────────
async function expandScriptLLM(raw: string, type: string): Promise<
  Array<{ heading: string; action: string; dialogue: string; shotCount: number }>
> {
  const cfg = await getLLMConfig();
  const sys =
    "你是一个影视分镜助手。用户会给出一段创意 / 剧本 / 一句话。请把它拆分成分镜场景，" +
    "每个场景给出标题、画面动作描述、台词旁白、建议镜头数(shotCount 1-4)。只输出 JSON 数组，" +
    "不要解释，格式：[{\"heading\":\"场景1\",\"action\":\"画面描述\",\"dialogue\":\"台词\",\"shotCount\":2}]";
  const content = await completeLLM(cfg, [
    { role: "system", content: sys },
    { role: "user", content: raw },
  ]);
  const m = content.match(/\[[\s\S]*\]/);
  if (!m) throw new Error("llm no json");
  const arr = JSON.parse(m[0]);
  return arr.map((s: any) => ({
    heading: String(s.heading ?? s.scene ?? "场景"),
    action: String(s.action ?? s.description ?? raw),
    dialogue: String(s.dialogue ?? ""),
    shotCount: Math.max(1, Math.min(4, Number(s.shotCount ?? 2) || 2)),
  }));
}

/** Turn a raw script into an ordered list of shot prompts. */
async function parseScriptToShots(
  raw: string,
  type: string,
  stylePrompt?: string,
  styleNegative?: string
): Promise<FilmShotInput[]> {
  let scenes: Array<{ heading: string; action: string; shotCount: number }>;
  try {
    const expanded = await expandScriptLLM(raw, type);
    scenes = expanded.map((s) => ({ heading: s.heading, action: s.action, shotCount: s.shotCount }));
  } catch {
    // offline fallback — reuse the workshop parser
    const sc = parseIdeaToScenes(raw, { title: "", type: (type as any) || "short_video", tone: "", logline: "" });
    scenes = sc.map((s) => ({
      heading: s.heading,
      action: `${s.action}${s.dialogue ? " " + s.dialogue : ""}`,
      shotCount: s.shotCount,
    }));
  }

  const shots: FilmShotInput[] = [];
  let order = 0;
  for (const sc of scenes) {
    for (let i = 0; i < sc.shotCount; i++) {
      const cam = CAMERA_KEYWORDS[order % CAMERA_KEYWORDS.length];
      const base = sc.action.trim() || raw.trim();
      const parts = [base, cam];
      if (stylePrompt) parts.push(stylePrompt);
      const prompt = parts.filter(Boolean).join(", ");
      const negative = [FILM_NEGATIVE, styleNegative].filter(Boolean).join(", ");
      shots.push({
        order: order++,
        heading: sc.heading,
        prompt,
        negative,
      });
    }
  }
  return shots.length ? shots : [{ order: 0, heading: "镜头 1", prompt: raw.trim() }];
}

// ── create ─────────────────────────────────────────────────
export async function createFilm(input: CreateFilmInput) {
  const size = input.size ?? "1280x720";
  const fps = input.fps ?? 16;
  const framesPerShot = input.framesPerShot ?? 49;

  let stylePrompt: string | undefined;
  let styleNegative: string | undefined;
  if (input.styleSlug) {
    const skill = await prisma.skill.findUnique({ where: { slug: input.styleSlug } });
    if (skill) {
      stylePrompt = skill.promptTemplate || undefined;
      styleNegative = skill.negativePrompt || undefined;
    }
  }

  const shots = await parseScriptToShots(
    input.script,
    input.type ?? "short_video",
    stylePrompt,
    styleNegative
  );

  const wf = await pickVideoWorkflow();

  const film = await prisma.filmProject.create({
    data: {
      userId: input.userId,
      title: input.title,
      script: input.script,
      type: input.type ?? "short_video",
      styleSlug: input.styleSlug ?? null,
      size,
      fps,
      framesPerShot,
      subtitleOn: input.subtitleOn ?? true,
      bgmName: input.bgmName ?? null,
      status: "PARSING",
    },
  });

  await prisma.filmShot.createMany({
    data: shots.map((s) => {
      const params: Record<string, any> = { frames: framesPerShot, fps, size, workflow: wf };
      return {
        filmId: film.id,
        order: s.order,
        heading: s.heading ?? null,
        prompt: s.prompt,
        negative: s.negative ?? null,
        status: "IDLE",
        params: params as any,
      };
    }),
  });

  await appendFilmLog(film.id, "success", `已生成分镜，共 ${shots.length} 个镜头`);
  return { id: film.id, shots: shots.length };
}

// ── pick the video workflow ───────────────────────────────
// Local-only: the machine ships with a WAN image-to-video checkpoint but no
// text-to-video checkpoint, so text-to-video auto-synthesizes a first frame
// and feeds it to the same I2V graph. An explicit choice in app settings wins.
async function pickVideoWorkflow(): Promise<"txt2video" | "img2video"> {
  const pref = getSettingsSync().defaultVideoWorkflow;
  if (pref === "txt2video" || pref === "img2video") return pref;
  // default "auto" → text-to-video (first frame is synthesized locally)
  return "txt2video";
}

// ── generate one video shot via the existing pipeline ──────
// Both text-to-video and image-to-video run through the local WAN I2V graph.
// Text-to-video shots without a supplied first frame get one synthesized from
// the prompt via a local txt2img pass (no cloud, no authorization).
async function generateVideoShot(
  userId: string,
  shot: { prompt: string; negative?: string | null; params?: any }
): Promise<string> {
  const p = (shot.params ?? {}) as Record<string, any>;
  const wf: "txt2video" | "img2video" =
    p.workflow === "img2video" ? "img2video" : "txt2video";
  const meta = getWorkflow("img2video")!;

  let inputImage = (p.inputImage as string) ?? (p.firstFrame as string) ?? null;
  if (!inputImage) {
    inputImage = await synthesizeFirstFrame({
      userId,
      prompt: shot.prompt,
      negative: shot.negative ?? undefined,
      size: (p.size as string) ?? "832x480",
    });
  }

  const built = await buildAndValidate("img2video", {
    prompt: shot.prompt,
    negative: shot.negative ?? undefined,
    inputImage,
    frames: (p.frames as number) ?? 81,
    fps: (p.fps as number) ?? 16,
    size: (p.size as string) ?? "832x480",
    steps: 25,
    cfg: 6,
    sampler: "euler",
    scheduler: "unipc",
    count: 1,
  });
  if (!built.ok || !built.prompt) throw new Error(built.error ?? "工作流构建失败");

  const task = await prisma.task.create({
    data: {
      userId,
      type: meta.taskType,
      prompt: shot.prompt,
      negativePrompt: shot.negative ?? null,
      params: { workflow: wf, ...p } as object,
      workflowName: wf,
      status: "QUEUED",
    },
  });
  enqueue({ taskId: task.id, prompt: built.prompt });
  return task.id;
}

// ── start (autopilot) ───────────────────────────────────────
export async function startFilm(id: string) {
  const film = await prisma.filmProject.findUnique({ where: { id } });
  if (!film) throw new Error("影片不存在");
  if (film.status === "GENERATING" || film.status === "COMPOSING") return;

  const shots = await prisma.filmShot.findMany({ where: { filmId: id, status: "IDLE" }, orderBy: { order: "asc" } });
  if (!shots.length) throw new Error("没有可生成的镜头，请重新创建");

  await prisma.filmProject.update({ where: { id }, data: { status: "GENERATING", progress: 0, error: null } });
  await appendFilmLog(id, "info", `开始逐镜生成（共 ${shots.length} 镜）`);

  for (const shot of shots) {
    try {
      const taskId = await generateVideoShot(film.userId, {
        prompt: shot.prompt,
        negative: shot.negative,
        params: shot.params,
      });
      await prisma.filmShot.update({
        where: { id: shot.id },
        data: { taskId, status: "QUEUED", progress: 0 },
      });
    } catch (e: any) {
      await prisma.filmShot.update({ where: { id: shot.id }, data: { status: "FAILED" } });
      await appendFilmLog(id, "error", `镜头 ${shot.order + 1} 提交失败：${e?.message ?? ""}`);
    }
  }

  // background watch → compose
  void watchFilm(id);
}

// ── watch + update ──────────────────────────────────────────
async function watchFilm(id: string) {
  const MAX_ITER = 240; // ~16 min at 4s
  for (let i = 0; i < MAX_ITER; i++) {
    const film = await prisma.filmProject.findUnique({ where: { id } });
    if (!film || film.status === "CANCELLED" || film.status === "FAILED") return;
    if (film.status !== "GENERATING") {
      // already moved on (e.g. compose started)
    }

    const shots = await prisma.filmShot.findMany({ where: { filmId: id }, orderBy: { order: "asc" } });
    let pending = 0;
    let done = 0;
    let failed = 0;

    for (const shot of shots) {
      if (!shot.taskId) {
        pending++;
        continue;
      }
      if (shot.status === "SUCCEEDED" || shot.status === "FAILED") {
        shot.status === "SUCCEEDED" ? done++ : failed++;
        continue;
      }
      const task = await prisma.task.findUnique({
        where: { id: shot.taskId },
        select: { status: true, progress: true, resultImages: true },
      });
      if (!task) {
        pending++;
        continue;
      }
      const map: Record<string, ShotStatus> = {
        QUEUED: "QUEUED",
        RUNNING: "RUNNING",
        SUCCEEDED: "SUCCEEDED",
        FAILED: "FAILED",
        CANCELLED: "FAILED",
      };
      const next = map[task.status] ?? "QUEUED";
      let videoPath: string | undefined;
      let duration: number | undefined;
      if (next === "SUCCEEDED") {
        const imgs = (task.resultImages as any[]) ?? [];
        const vid = imgs.find((v) => v.mediaType === "video") ?? imgs[0];
        videoPath = vid?.localPath;
        const p = (shot.params as any) ?? {};
        duration = typeof p.duration === "number" ? p.duration : ((p.frames ?? 49) as number) / ((p.fps ?? 16) as number);
      }
      await prisma.filmShot.update({
        where: { id: shot.id },
        data: {
          status: next,
          progress: task.progress,
          videoPath: videoPath ?? undefined,
          duration: duration ?? null,
        },
      });
      if (next === "SUCCEEDED") done++;
      else if (next === "FAILED") failed++;
      else pending++;
    }

    const total = shots.length;
    const progress = Math.round(((done + failed) / total) * 100);
    await prisma.filmProject.update({ where: { id }, data: { progress } });

    if (pending === 0) {
      if (failed > 0 && done === 0) {
        await prisma.filmProject.update({ where: { id }, data: { status: "FAILED", error: `${failed} 个镜头生成失败` } });
        await appendFilmLog(id, "error", `影片生成失败：${failed} 个镜头失败`);
        return;
      }
      // success (or partial) → compose
      await composeFilm(id);
      return;
    }
    await sleep(4000);
  }
  await prisma.filmProject.update({ where: { id }, data: { status: "FAILED", error: "生成超时" } });
  await appendFilmLog(id, "error", "影片生成超时（超过 16 分钟）");
}

// ── ffmpeg helpers ─────────────────────────────────────────
let _ffmpegOk: boolean | null = null;
export async function isFFmpegAvailable(): Promise<boolean> {
  if (_ffmpegOk !== null) return _ffmpegOk;
  const bin = process.env.FFMPEG_BIN || "ffmpeg";
  try {
    await runFFmpeg(["-version"], undefined, 8000);
    _ffmpegOk = true;
  } catch {
    _ffmpegOk = false;
  }
  return _ffmpegOk;
}

function runFFmpeg(args: string[], cwd?: string, timeout = 120000): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const bin = process.env.FFMPEG_BIN || "ffmpeg";
    const cp = spawn(bin, args, { cwd });
    let stderr = "";
    const to = setTimeout(() => {
      cp.kill("SIGKILL");
      resolve({ code: -1, stderr: "timeout" });
    }, timeout);
    cp.stderr.on("data", (d) => (stderr += d.toString()));
    cp.on("close", (code) => {
      clearTimeout(to);
      resolve({ code: code ?? -1, stderr });
    });
    cp.on("error", () => {
      clearTimeout(to);
      resolve({ code: -2, stderr: "spawn error" });
    });
  });
}

function escapeFilter(s: string): string {
  return s.replace(/'/g, "\\'").replace(/:/g, "\\:");
}

// ── compose ────────────────────────────────────────────────
export async function composeFilm(id: string) {
  const film = await prisma.filmProject.findUnique({ where: { id } });
  if (!film) return;
  if (film.status === "COMPOSING" || film.status === "DONE") return;

  await prisma.filmProject.update({ where: { id }, data: { status: "COMPOSING", progress: 90, error: null } });
  await appendFilmLog(id, "info", "所有镜头完成，开始合成影片…");

  const ok = await isFFmpegAvailable();
  if (!ok) {
    await prisma.filmProject.update({
      where: { id },
      data: { status: "FAILED", error: "未检测到 ffmpeg，无法合成。请安装 ffmpeg 后点「重新合成」" },
    });
    await appendFilmLog(
      id,
      "error",
      "未检测到 ffmpeg。请安装 ffmpeg 并设置环境变量 FFMPEG_BIN（或确保 ffmpeg 在 PATH 中），然后点击「重新合成」。"
    );
    return;
  }

  const shots = await prisma.filmShot.findMany({
    where: { filmId: id, status: "SUCCEEDED", NOT: { videoPath: null } },
    orderBy: { order: "asc" },
  });
  if (!shots.length) {
    await prisma.filmProject.update({ where: { id }, data: { status: "FAILED", error: "没有可用的镜头视频" } });
    return;
  }

  const cwd = process.cwd();
  const [W, H] = (film.size.split("x").map(Number) as number[]) ?? [1280, 720];
  const fps = film.fps;
  const tmpDir = path.join(cwd, "public", "generated", "films", `_tmp_${id}`);
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.mkdir(path.join(cwd, "public", "generated", "films"), { recursive: true });

  try {
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      const clip = path.join(cwd, "public", (shot.videoPath as string).replace(/^\//, ""));
      const segOut = path.join(tmpDir, `seg_${i}.mp4`);
      const dur = shot.duration ?? (film.framesPerShot / fps);
      const fadeOut = Math.max(0, dur - 0.3);

      let vf =
        `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
        `pad=${W}:${H}:(${W}-iw)/2:(${H}-ih)/2,setsar=1,` +
        `fps=${fps},` +
        `fade=t=in:st=0:d=0.3,fade=t=out:st=${fadeOut.toFixed(2)}:d=0.3`;

      const srtPath = path.join(tmpDir, `seg_${i}.srt`);
      if (film.subtitleOn) {
        await fs.writeFile(
          srtPath,
          `1\n00:00:00,000 --> 00:00:${String(Math.floor(dur)).padStart(2, "0")},000\n${(shot.heading || shot.prompt).slice(0, 80)}\n`,
          "utf-8"
        );
      }

      const tryWithSub = film.subtitleOn;
      let args: string[] = [
        "-y",
        "-i", clip,
        "-vf", vf + (tryWithSub ? `,subtitles='${escapeFilter(srtPath.replace(/\\/g, "/"))}'` : ""),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        "-c:a", "aac", "-b:a", "128k",
        "-t", dur.toFixed(2),
        segOut,
      ];
      let res = await runFFmpeg(args, tmpDir);
      if (res.code !== 0 && tryWithSub) {
        await appendFilmLog(id, "warn", `镜头 ${i + 1} 字幕烧录失败，重试（无字幕）`);
        args = [
          "-y", "-i", clip,
          "-vf", vf,
          "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
          "-c:a", "aac", "-b:a", "128k",
          "-t", dur.toFixed(2),
          segOut,
        ];
        res = await runFFmpeg(args, tmpDir);
      }
      if (res.code !== 0) {
        throw new Error(`镜头 ${i + 1} 归一化失败：${res.stderr.slice(0, 200)}`);
      }
      await appendFilmLog(id, "info", `镜头 ${i + 1}/${shots.length} 已就绪`);
    }

    // concat
    const list = shots.map((_, i) => `file 'seg_${i}.mp4'`).join("\n");
    const listPath = path.join(tmpDir, "segs.txt");
    await fs.writeFile(listPath, list, "utf-8");
    const concatPath = path.join(tmpDir, "concat.mp4");
    const cres = await runFFmpeg(
      ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", concatPath],
      tmpDir
    );
    if (cres.code !== 0) throw new Error(`拼接失败：${cres.stderr.slice(0, 200)}`);

    const finalPath = path.join(cwd, "public", "generated", "films", `${id}.mp4`);
    const localPath = `/api/generated/films/${id}.mp4`;

    if (film.bgmName) {
      const bgm = path.join(cwd, "public", "generated", "films", "bgm", film.bgmName);
      const bgmExists = await fs.stat(bgm).then(() => true).catch(() => false);
      if (bgmExists) {
        const mres = await runFFmpeg(
          [
            "-y", "-i", concatPath, "-i", bgm,
            "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=shortest:dropout_transition=0[a]",
            "-map", "0:v", "-map", "[a]",
            "-c:v", "copy", "-c:a", "aac", "-shortest", finalPath,
          ],
          tmpDir
        );
        if (mres.code !== 0) {
          await appendFilmLog(id, "warn", "BGM 混音失败，使用无配乐版本");
          await fs.copyFile(concatPath, finalPath);
        } else {
          await appendFilmLog(id, "success", "已混入背景音乐");
        }
      } else {
        await fs.copyFile(concatPath, finalPath);
      }
    } else {
      await fs.copyFile(concatPath, finalPath);
    }

    await prisma.filmProject.update({
      where: { id },
      data: { status: "DONE", progress: 100, finalVideo: localPath, error: null },
    });
    await appendFilmLog(id, "success", `🎬 影片合成完成：${localPath}`);
  } catch (e: any) {
    await prisma.filmProject.update({
      where: { id },
      data: { status: "FAILED", error: e?.message ?? "合成失败" },
    });
    await appendFilmLog(id, "error", `合成失败：${e?.message ?? ""}`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── cancel ──────────────────────────────────────────────────
export async function cancelFilm(id: string) {
  const film = await prisma.filmProject.findUnique({ where: { id } });
  if (!film) return;
  const shots = await prisma.filmShot.findMany({
    where: { filmId: id, status: { in: ["QUEUED", "RUNNING"] }, NOT: { taskId: null } },
  });
  for (const s of shots) {
    if (s.taskId) await cancelTask(s.taskId).catch(() => {});
  }
  await prisma.filmShot.updateMany({
    where: { filmId: id, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "FAILED" },
  });
  await prisma.filmProject.update({ where: { id }, data: { status: "CANCELLED", error: "已取消" } });
  await appendFilmLog(id, "warn", "影片已取消");
}

// ── misc ───────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
