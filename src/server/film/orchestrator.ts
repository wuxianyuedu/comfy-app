// ── 影片工坊编排器 ─────────────────────────────────
// 一键完整影片管线：
//   剧本 → 自动分镜（镜头）→ 逐镜头视频生成
//  （复用 ComfyUI 视频工作流）→ ffmpeg 拼接（+ 字幕 / BGM）
//   → 一部成片。
//
// 每个镜头走与手动「视频」页签同一条库工作流链（工作流库 id +
// 封装），所以不需要任何内置模板。

import { clamp } from "~/lib/clamp";
import { sleep } from "~/lib/with-timeout";
import "server-only";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import {
  filmRepository,
  filmShotRepository,
  skillRepository,
  taskRepository,
} from "~/lib/core/repository";
import { productionRepository } from "~/lib/core/repository-production";
import { normalizeProductionProgress } from "~/lib/production/progress";
import type { Shot } from "~/lib/workshop/types";
import { cancelTask } from "~/lib/comfyui/enqueue";
import { synthesizeFirstFrame } from "~/lib/comfyui/firstframe";
import { createWorkflowRunTask } from "~/lib/workshop/workflow-run.server";
import { parseIdeaToScenes } from "~/lib/workshop/script-parser";
import { sizeSpecDims, toSizeSpec } from "~/lib/media/size-presets";
import {
  FILM_COMPOSE_SIZE,
  NATIVE_SHOT_VIDEO_SIZE,
} from "~/lib/film/film-size";
import { z } from "zod";
import { getLLMConfig, completeLLMStructured } from "~/lib/llm/server";
import type { ProjectType } from "~/lib/workshop/types";
import { errorMessage, errorText } from "~/lib/error-message";
import { withTimeoutResult } from "~/lib/with-timeout";
import { normalizeSlashes } from "~/lib/path-display";
import { INLINE_SNIPPET_MAX, clampText } from "~/lib/text-clamp";
import { fixed } from "~/lib/number-format";

export type FilmStatus =
  "PARSING" | "GENERATING" | "COMPOSING" | "DONE" | "FAILED" | "CANCELLED";

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
  /** 成片画幅（尺寸表达：比例 + 分辨率 / 比例 + 百万像素 + 倍数）。缺省走视频
   *  场景 16:9 1k；仍传 "1280x720" 这类老字符串时由 `toSizeSpec` 归一。 */
  size?: unknown;
  fps?: number;
  framesPerShot?: number;
  subtitleOn?: boolean;
  bgmName?: string | null;
  /** 逐镜生成用的**工作流库视频工作流 id**（本地链路唯一来源，内置模板已移除）。 */
  videoWorkflowId?: string | null;
  /** 文生视频镜头合成首帧用的**图类工作流 id**；镜头自带首帧时不需要。 */
  imageWorkflowId?: string | null;
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
/** unknown → string：与原 `String(x)` / 模板插值行为逐值一致。 */
const toStr = (v: unknown): string => String(v);

async function appendFilmLog(
  id: string,
  level: "info" | "progress" | "warn" | "error" | "success",
  msg: string,
) {
  await filmRepository.appendLog(id, { t: Date.now(), level, msg });
}

// ── script → storyboard ────────────────────────────────────
const ShotSchema = z.object({
  heading: z.unknown(),
  action: z.unknown(),
  dialogue: z.unknown(),
  shotCount: z.unknown(),
});

async function expandScriptLLM(raw: string): Promise<
  Array<{
    heading: string;
    action: string;
    dialogue: string;
    shotCount: number;
  }>
> {
  // 结构化 JSON 解析：低温度（code 任务）+ Zod 校验，避免手写正则/JSON.parse 不稳。
  const cfg = await getLLMConfig({ taskType: "code" });

  const sys =
    "你是一个影视分镜助手。用户会给出一段创意 / 剧本 / 一句话。请把它拆分成分镜场景，" +
    "每个场景给出标题、画面动作描述、台词旁白、建议镜头数(shotCount 1-4)。只输出 JSON 数组，" +
    '不要解释，格式：[{"heading":"场景1","action":"画面描述","dialogue":"台词","shotCount":2}]';

  const shots = await completeLLMStructured(
    cfg,
    [
      { role: "system", content: sys },
      { role: "user", content: raw },
    ],
    z.array(ShotSchema),
  );

  return shots.map((rec) => ({
    heading: toStr(rec.heading ?? "场景"),
    action: toStr(rec.action ?? raw),
    dialogue: toStr(rec.dialogue ?? ""),
    shotCount: clamp(Number(rec.shotCount ?? 2) || 2, 1, 4),
  }));
}

/** 把原始剧本变成有序的镜头提示词列表。 */
async function parseScriptToShots(
  raw: string,
  type: string,
  stylePrompt?: string,
  styleNegative?: string,
): Promise<FilmShotInput[]> {
  let scenes: Array<{ heading: string; action: string; shotCount: number }>;
  try {
    const expanded = await expandScriptLLM(raw);
    scenes = expanded.map((expanded) => ({
      heading: expanded.heading,
      action: expanded.action,
      shotCount: expanded.shotCount,
    }));
  } catch {
    // 离线兜底 —— 复用工坊解析器
    const sc = parseIdeaToScenes(raw, {
      title: "",
      type: (type as ProjectType) ?? "short_video",
      tone: "",
      logline: "",
    });
    scenes = sc.map((scene) => ({
      heading: scene.heading,
      action: `${scene.action}${scene.dialogue ? " " + scene.dialogue : ""}`,
      shotCount: scene.shotCount,
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
      const negative = [FILM_NEGATIVE, styleNegative]
        .filter(Boolean)
        .join(", ");
      shots.push({
        order: order++,
        heading: sc.heading,
        prompt,
        negative,
      });
    }
  }
  return shots.length
    ? shots
    : [{ order: 0, heading: "镜头 1", prompt: raw.trim() }];
}

// ── create ─────────────────────────────────────────────────
/** 落库一份成片 + 其镜头行。`createFilm`（剧本自解析）与 `createFilmFromProject`
 *  （读统一项目 Shot[]）共用的唯一落点 —— 逐镜 params 的折算只此一处（§12.12）。 */
async function persistFilmWithShots(args: {
  userId: string;
  projectId?: string | null;
  title: string;
  script: string;
  type: string;
  styleSlug?: string | null;
  sizeSpec: unknown;
  fps: number;
  framesPerShot: number;
  subtitleOn: boolean;
  bgmName?: string | null;
  videoWorkflowId: string;
  imageWorkflowId: string;
  shotInputs: FilmShotInput[];
}): Promise<string> {
  const film = await filmRepository.create({
    userId: args.userId,
    projectId: args.projectId ?? null,
    title: args.title,
    script: args.script,
    type: args.type,
    styleSlug: args.styleSlug ?? null,
    size: JSON.stringify(args.sizeSpec),
    fps: args.fps,
    framesPerShot: args.framesPerShot,
    subtitleOn: args.subtitleOn,
    bgmName: args.bgmName ?? null,
  });
  await filmShotRepository.createMany(
    film.id,
    args.shotInputs.map((shot) => ({
      order: shot.order,
      heading: shot.heading ?? null,
      prompt: shot.prompt,
      negative: shot.negative ?? null,
      params: {
        frames: args.framesPerShot,
        fps: args.fps,
        size: args.sizeSpec,
        videoWorkflowId: args.videoWorkflowId,
        imageWorkflowId: args.imageWorkflowId,
      },
    })),
  );
  return film.id;
}

export async function createFilm(input: CreateFilmInput) {
  /* 成片画幅按尺寸表达存（数据库那一列是文本，存 JSON）；镜头侧存同一份尺寸表达
   * （工作流库工作流由封装层逐端口派值，不再折算成 "WxH"）。 */
  const sizeSpec = toSizeSpec(input.size ?? FILM_COMPOSE_SIZE);
  const fps = input.fps ?? 16;
  const framesPerShot = input.framesPerShot ?? 49;

  let stylePrompt: string | undefined;
  let styleNegative: string | undefined;
  if (input.styleSlug) {
    const skill = await skillRepository.findBySlug(input.styleSlug);
    if (skill) {
      stylePrompt = skill.promptTemplate || undefined;
      styleNegative = skill.negativePrompt ?? undefined;
    }
  }

  const shots = await parseScriptToShots(
    input.script,
    input.type ?? "short_video",
    stylePrompt,
    styleNegative,
  );

  const filmId = await persistFilmWithShots({
    userId: input.userId,
    title: input.title,
    script: input.script,
    type: input.type ?? "short_video",
    styleSlug: input.styleSlug ?? null,
    sizeSpec,
    fps,
    framesPerShot,
    subtitleOn: input.subtitleOn ?? true,
    bgmName: input.bgmName ?? null,
    videoWorkflowId: input.videoWorkflowId ?? "",
    imageWorkflowId: input.imageWorkflowId ?? "",
    shotInputs: shots,
  });

  await appendFilmLog(
    filmId,
    "success",
    `已生成分镜，共 ${shots.length} 个镜头`,
  );
  return { id: filmId, shots: shots.length };
}

export interface CreateFilmFromProjectInput {
  userId: string;
  /** 统一项目 id（proj_*）；镜头取自该项目的 production.shots。 */
  projectId: string;
  /** 逐镜生成用的工作流库视频工作流 id（本地链路唯一来源）。 */
  videoWorkflowId?: string | null;
  /** 文生视频镜头合成首帧用的图类工作流 id。 */
  imageWorkflowId?: string | null;
  title?: string;
  type?: string;
  size?: unknown;
  fps?: number;
  framesPerShot?: number;
  subtitleOn?: boolean;
  bgmName?: string | null;
}

/** 从统一项目的 `production.shots` 直接建片（Phase 5 接入，设计 §6.3）：
 *  工坊已产出的镜头不再走「自建剧本 → LLM 平行分镜」，而是逐条映射为成片镜头。
 *  镜头的 prompt / negative 已是工坊定稿（含风格），这里不二次加工；顺序按镜号 index。 */
export async function createFilmFromProject(input: CreateFilmFromProjectInput) {
  const row = await productionRepository.getForUser(
    input.userId,
    input.projectId,
  );
  const rawShots = row && Array.isArray(row.shots) ? (row.shots as Shot[]) : [];
  const shots = [...rawShots].sort((a, b) => a.index - b.index);
  if (!shots.length) {
    throw new Error("该项目还没有镜头，请先在工坊产出镜头再成片");
  }

  const sizeSpec = toSizeSpec(input.size ?? FILM_COMPOSE_SIZE);
  const fps = input.fps ?? 16;
  const framesPerShot = input.framesPerShot ?? 49;

  const shotInputs: FilmShotInput[] = shots.map((shot, i) => ({
    order: i,
    heading: shot.sceneHeading || undefined,
    prompt: shot.prompt,
    negative: shot.negativePrompt || undefined,
  }));

  const filmId = await persistFilmWithShots({
    userId: input.userId,
    projectId: input.projectId,
    title: input.title ?? row?.title ?? "未命名成片",
    script: row?.scriptMarkdown ?? "",
    type: input.type ?? row?.type ?? "short_video",
    sizeSpec,
    fps,
    framesPerShot,
    subtitleOn: input.subtitleOn ?? true,
    bgmName: input.bgmName ?? null,
    videoWorkflowId: input.videoWorkflowId ?? "",
    imageWorkflowId: input.imageWorkflowId ?? "",
    shotInputs,
  });

  await appendFilmLog(
    filmId,
    "success",
    `从项目镜头建片，共 ${shotInputs.length} 个镜头`,
  );
  return { id: filmId, shots: shotInputs.length };
}

// ── 回写：成片合成完成 → 统一项目完成状态（Phase 5 / §6.3 + §7 film 状态源收敛）──
/** 把「从项目建的片」在合成完成后，回写来源项目的 `production.progress` 为已合成。
 *  production 行的 progress 是两侧共读的唯一来源（`src/lib/production/progress.ts`）；
 *  这里读-改-写：只把 `rendered` 置真、阶段推进到 `render`，其余字段（剧本/场景/角色/
 *  镜头/其它进度）原样保留。仅对 `filmProject.projectId` 非空（走统一项目建片）生效。 */
export async function markProductionRendered(
  userId: string,
  projectId: string,
): Promise<void> {
  const row = await productionRepository.getForUser(userId, projectId);
  if (!row) return;
  const progress = normalizeProductionProgress(row.progress);
  await productionRepository.upsertForUser(userId, {
    id: row.id,
    title: row.title,
    type: row.type,
    tone: row.tone,
    logline: row.logline,
    scriptMarkdown: row.scriptMarkdown,
    scenes: row.scenes,
    characters: row.characters,
    shots: row.shots,
    progress: { ...progress, stage: "render", rendered: true },
  });
}

// ── 生成一个视频镜头 ──────────────────────────────────────
// 视频这一跳没有内置模板（内置 img2video / txt2video 与 `__PROMPT__` 系列
// token 替换已移除）：镜头 params 里必须带**工作流库视频工作流 id**。
// 没有首帧时，用同一份 params 里的**图类工作流 id** 本地合成一张再喂给视频图。
async function generateVideoShot(
  userId: string,
  shot: { prompt: string; negative?: string | null; params?: unknown },
): Promise<string> {
  const params = (shot.params ?? {}) as Record<string, unknown>;

  const videoWorkflowId =
    typeof params.videoWorkflowId === "string" ? params.videoWorkflowId : "";
  if (!videoWorkflowId) {
    throw new Error("镜头缺少「工作流库视频工作流 id」，无法本地生成");
  }

  const size = toSizeSpec(params.size ?? NATIVE_SHOT_VIDEO_SIZE);

  // 断言仅收口类型（运行时擦除）：inputImage 为 "" 等 falsy 值时仍需走
  // 下方合成首帧分支。
  let inputImage = (params.inputImage ?? params.firstFrame ?? null) as string;

  if (!inputImage) {
    const imageWorkflowId =
      typeof params.imageWorkflowId === "string" ? params.imageWorkflowId : "";
    if (!imageWorkflowId) {
      throw new Error(
        "镜头缺少首帧，且没有配置「工作流库图类工作流 id」可用于合成首帧",
      );
    }
    inputImage = await synthesizeFirstFrame({
      userId,
      workflowId: imageWorkflowId,
      prompt: shot.prompt,
      negative: shot.negative ?? undefined,
      size,
    });
  }

  const { taskId } = await createWorkflowRunTask({
    userId,
    workflowId: videoWorkflowId,
    values: {
      prompt: shot.prompt,
      ...(shot.negative ? { negativePrompt: shot.negative } : {}),
      firstFrame: inputImage,
      frames: (params.frames ?? 81) as number,
      size,
    },
  });

  return taskId;
}

// ── start (autopilot) ───────────────────────────────────────
export async function startFilm(id: string) {
  const film = await filmRepository.findById(id);
  if (!film) throw new Error("影片不存在");
  if (film.status === "GENERATING" || film.status === "COMPOSING") return;

  const shots = await filmShotRepository.listByFilm(id, { status: "IDLE" });
  if (!shots.length) throw new Error("没有可生成的镜头，请重新创建");

  await filmRepository.markGenerating(id);
  await appendFilmLog(id, "info", `开始逐镜生成（共 ${shots.length} 镜）`);

  for (const shot of shots) {
    try {
      const taskId = await generateVideoShot(film.userId, {
        prompt: shot.prompt,
        negative: shot.negative,
        params: shot.params,
      });
      await filmShotRepository.markQueued(shot.id, taskId);
    } catch (e) {
      await filmShotRepository.markFailed(shot.id);
      await appendFilmLog(
        id,
        "error",
        errorText(e, `镜头 ${shot.order + 1} 提交失败`),
      );
    }
  }

  // 后台监看 → 合成
  void watchFilm(id);
}

// ── watch + update ──────────────────────────────────────────
async function watchFilm(id: string) {
  const MAX_ITER = 240; // ~16 min at 4s
  for (let i = 0; i < MAX_ITER; i++) {
    const film = await filmRepository.findById(id);
    if (!film || film.status === "CANCELLED" || film.status === "FAILED")
      return;
    if (film.status !== "GENERATING") {
      // 已经走掉了（例如合成已开始）
    }

    const shots = await filmShotRepository.listByFilm(id);
    let pending = 0;
    let done = 0;
    let failed = 0;

    for (const shot of shots) {
      if (!shot.taskId) {
        pending++;
        continue;
      }
      if (shot.status === "SUCCEEDED" || shot.status === "FAILED") {
        if (shot.status === "SUCCEEDED") done++;
        else failed++;
        continue;
      }
      const task = await taskRepository.findExecutionProgress(shot.taskId);
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
        const imgs =
          (task.resultImages as Array<{
            mediaType?: unknown;
            localPath?: string;
          }> | null) ?? [];

        const vid = imgs.find((img) => img.mediaType === "video") ?? imgs[0];

        videoPath = vid?.localPath;

        const params = (shot.params ?? {}) as Record<string, unknown>;

        duration =
          typeof params.duration === "number"
            ? params.duration
            : ((params.frames ?? 49) as number) /
              ((params.fps ?? 16) as number);
      }

      await filmShotRepository.updateFromTask(shot.id, {
        status: next,
        progress: task.progress,
        videoPath: videoPath ?? undefined,
        duration: duration ?? null,
      });
      if (next === "SUCCEEDED") done++;
      else if (next === "FAILED") failed++;
      else pending++;
    }

    const total = shots.length;
    const progress = Math.round(((done + failed) / total) * 100);
    await filmRepository.updateProgress(id, progress);

    if (pending === 0) {
      if (failed > 0 && done === 0) {
        await filmRepository.markFailed(id, `${failed} 个镜头生成失败`);
        await appendFilmLog(id, "error", `影片生成失败：${failed} 个镜头失败`);
        return;
      }
      // 成功（或部分成功）→ 合成
      await composeFilm(id);
      return;
    }
    await sleep(4000);
  }
  await filmRepository.markFailed(id, "生成超时");
  await appendFilmLog(id, "error", "影片生成超时（超过 16 分钟）");
}

// ── ffmpeg helpers ─────────────────────────────────────────
let _ffmpegOk: boolean | null = null;
export async function isFFmpegAvailable(): Promise<boolean> {
  if (_ffmpegOk !== null) return _ffmpegOk;
  try {
    await runFFmpeg(["-version"], undefined, 8000);
    _ffmpegOk = true;
  } catch {
    _ffmpegOk = false;
  }
  return _ffmpegOk;
}

function runFFmpeg(
  args: string[],
  cwd?: string,
  timeout = 120000,
): Promise<{ code: number; stderr: string }> {
  const bin = process.env.FFMPEG_BIN ?? "ffmpeg";
  const cp = spawn(/*turbopackIgnore: true*/ bin, args, { cwd });
  let stderr = "";
  cp.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  return withTimeoutResult(
    new Promise<{ code: number; stderr: string }>((resolve) => {
      cp.on("close", (code) => resolve({ code: code ?? -1, stderr }));
      cp.on("error", () => resolve({ code: -2, stderr: "spawn error" }));
    }),
    timeout,
    /* 超时不是「一种结果」而是「放弃等待」：`code: -1` + `"timeout"` 是调用处
     * 一直在判的哨兵值，故走 `withTimeoutResult`（不给异常）；
     * `onTimeout` 里杀掉子进程 —— 放弃等待之后进程还占着 GPU 才是真问题。 */
    { code: -1, stderr: "timeout" },
    { onTimeout: () => cp.kill("SIGKILL") },
  );
}

function escapeFilter(s: string): string {
  return s.replace(/'/g, "\\'").replace(/:/g, "\\:");
}

// ── compose ────────────────────────────────────────────────
export async function composeFilm(id: string) {
  const film = await filmRepository.findById(id);
  if (!film) return;
  if (film.status === "COMPOSING" || film.status === "DONE") return;

  await filmRepository.markComposing(id);
  await appendFilmLog(id, "info", "所有镜头完成，开始合成影片…");

  const ok = await isFFmpegAvailable();
  if (!ok) {
    await filmRepository.markFailed(
      id,
      "未检测到 ffmpeg，无法合成。请安装 ffmpeg 后点「重新合成」",
    );
    await appendFilmLog(
      id,
      "error",
      "未检测到 ffmpeg。请安装 ffmpeg 并设置环境变量 FFMPEG_BIN（或确保 ffmpeg 在 PATH 中），然后点击「重新合成」。",
    );
    return;
  }

  const shots = await filmShotRepository.listByFilm(id, {
    status: "SUCCEEDED",
    onlyWithVideo: true,
  });
  if (!shots.length) {
    await filmRepository.markFailed(id, "没有可用的镜头视频");
    return;
  }

  const cwd = process.cwd();
  /* 成片画幅：列里存的是尺寸表达（老行是 "1280x720" 字符串，`toSizeSpec` 兼容），
   * ffmpeg 要的是像素 —— 在这里折算。 */
  const { width: W, height: H } = sizeSpecDims(toSizeSpec(film.size), "video");
  const fps = film.fps;
  const tmpDir = path.join(cwd, "public", "generated", "films", `_tmp_${id}`);
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.mkdir(path.join(cwd, "public", "generated", "films"), {
    recursive: true,
  });

  try {
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      const clip = path.join(
        cwd,
        "public",
        shot!.videoPath!.replace(/^\//, ""),
      );
      const segOut = path.join(tmpDir, `seg_${i}.mp4`);
      const dur = shot!.duration ?? film.framesPerShot / fps;
      const fadeOut = Math.max(0, dur - 0.3);

      const vf =
        `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
        `pad=${W}:${H}:(${W}-iw)/2:(${H}-ih)/2,setsar=1,` +
        `fps=${fps},` +
        `fade=t=in:st=0:d=0.3,fade=t=out:st=${fixed(fadeOut, 2) ?? "0"}:d=0.3`;

      const srtPath = path.join(tmpDir, `seg_${i}.srt`);
      if (film.subtitleOn) {
        await fs.writeFile(
          srtPath,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          `1\n00:00:00,000 --> 00:00:${String(Math.floor(dur)).padStart(2, "0")},000\n${(shot!.heading || shot!.prompt).slice(0, 80)}\n`,
          "utf-8",
        );
      }

      const tryWithSub = film.subtitleOn;
      let args: string[] = [
        "-y",
        "-i",
        clip,
        "-vf",
        vf +
          (tryWithSub
            ? `,subtitles='${escapeFilter(normalizeSlashes(srtPath))}'`
            : ""),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-t",
        /* ffmpeg 的 `-t` 与 fade 时刻按两位小数写（`~/lib/number-format`）。 */
        fixed(dur, 2) ?? "0",
        segOut,
      ];
      let res = await runFFmpeg(args, tmpDir);
      if (res.code !== 0 && tryWithSub) {
        await appendFilmLog(
          id,
          "warn",
          `镜头 ${i + 1} 字幕烧录失败，重试（无字幕）`,
        );
        args = [
          "-y",
          "-i",
          clip,
          "-vf",
          vf,
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-t",
          fixed(dur, 2) ?? "0",
          segOut,
        ];
        res = await runFFmpeg(args, tmpDir);
      }
      if (res.code !== 0) {
        throw new Error(
          `镜头 ${i + 1} 归一化失败：${clampText(res.stderr, { maxLength: INLINE_SNIPPET_MAX, marker: "" })}`,
        );
      }
      await appendFilmLog(id, "info", `镜头 ${i + 1}/${shots.length} 已就绪`);
    }

    // concat
    const list = shots.map((_, i) => `file 'seg_${i}.mp4'`).join("\n");
    const listPath = path.join(tmpDir, "segs.txt");
    await fs.writeFile(listPath, list, "utf-8");
    const concatPath = path.join(tmpDir, "concat.mp4");
    const cres = await runFFmpeg(
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-c",
        "copy",
        concatPath,
      ],
      tmpDir,
    );
    if (cres.code !== 0)
      throw new Error(
        `拼接失败：${clampText(cres.stderr, { maxLength: INLINE_SNIPPET_MAX, marker: "" })}`,
      );

    const finalPath = path.join(
      cwd,
      "public",
      "generated",
      "films",
      `${id}.mp4`,
    );
    const localPath = `/api/generated/films/${id}.mp4`;

    if (film.bgmName) {
      const bgm = path.join(
        cwd,
        "public",
        "generated",
        "films",
        "bgm",
        film.bgmName,
      );
      const bgmExists = await fs
        .stat(bgm)
        .then(() => true)
        .catch(() => false);
      if (bgmExists) {
        const mres = await runFFmpeg(
          [
            "-y",
            "-i",
            concatPath,
            "-i",
            bgm,
            "-filter_complex",
            "[0:a][1:a]amix=inputs=2:duration=shortest:dropout_transition=0[a]",
            "-map",
            "0:v",
            "-map",
            "[a]",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-shortest",
            finalPath,
          ],
          tmpDir,
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

    await filmRepository.markDone(id, localPath);
    await appendFilmLog(id, "success", `🎬 影片合成完成：${localPath}`);

    /* 回写闭环（Phase 5 / §6.3 + §7）：从统一项目建的片，合成完成后把该项目进度标为
     * 已合成 —— 工坊 / 画布据此共读到「已出片」。回写失败不影响成片本身（已 markDone），
     * 只记一条 warn。 */
    if (film.projectId) {
      try {
        await markProductionRendered(film.userId, film.projectId);
      } catch (e) {
        await appendFilmLog(
          id,
          "warn",
          `已合成，但回写项目进度失败：${errorText(e, "未知错误")}`,
        );
      }
    }
  } catch (e) {
    await filmRepository.markFailed(id, errorMessage(e, "合成失败"));
    await appendFilmLog(id, "error", errorText(e, "合成失败"));
  } finally {
    await fs
      .rm(tmpDir, { recursive: true, force: true })
      .catch(() => undefined);
  }
}

// ── cancel ──────────────────────────────────────────────────
export async function cancelFilm(id: string) {
  const film = await filmRepository.findById(id);
  if (!film) return;
  const shots = await filmShotRepository.listActiveWithTask(id);
  for (const s of shots) {
    if (s.taskId) await cancelTask(s.taskId).catch(() => undefined);
  }
  await filmShotRepository.markAllActiveFailed(id);
  await filmRepository.markCancelled(id);
  await appendFilmLog(id, "warn", "影片已取消");
}
