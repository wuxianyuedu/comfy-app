// ── 影片工坊编排器 ─────────────────────────────────
// 一键完整影片管线：剧本 → 自动分镜（镜头）→ 逐镜视频生成（复用 ComfyUI 视频工作流）
//  → ffmpeg 拼接（+ 字幕 / BGM）→ 一部成片。
// 每个镜头走与手动「视频」页签同一条库工作流链（工作流库 id + 封装），所以不需要任何内置模板。

import { TRPCError } from "@trpc/server";
import { clamp } from "~/lib/clamp";
import "server-only";
import { db } from "~/lib/db";
import { filmRepository, filmShotRepository, skillRepository } from "~/lib/core/repository";
import { productionRepository } from "~/lib/core/repository-production";
import { logger } from "~/lib/core/logger";
import { characterListInputSchema, isProjectType } from "~/lib/workshop/types";
import type { Shot } from "~/lib/workshop/types";
import { asRecord } from "~/lib/is-record";
import { cancelTask } from "~/lib/comfyui/enqueue";
import { synthesizeFirstFrame } from "~/lib/comfyui/firstframe";
import { randomSeed } from "~/lib/comfyui/random-seed";
import { createWorkflowRunTask } from "~/lib/workshop/workflow-run.server";
import { parseIdeaToScenes } from "~/lib/workshop/script-parser";
import { FILM_COMPOSE_SIZE, NATIVE_SHOT_VIDEO_SIZE, shotSizeFor } from "~/lib/film/film-size";
import { z } from "zod";
import { getLLMConfig, completeLLMStructured } from "~/lib/llm/server";
import { errorText } from "~/lib/error-message";
/* 镜头尺寸表达 → 像素的折算在读载荷时还要用（合成那半段搬到 compose-film.ts 了）。 */
import { toSizeSpec } from "~/lib/media/size-presets";
/* 行日志那一份两侧（编排与监看）都要用，所以它在 film-log.ts 这个叶子上。 */
import { appendFilmLog } from "./film-log";
import { resolveFilmFirstFrame } from "./first-frame";
import { extractTailFrameUrl } from "./tail-frame";
import { resolveVoice, ttsParamsOf, type VoiceBinding } from "./voice-track";
import { ensureShotAudio } from "./audio-task";
/* 监看（无响应看门狗 / 超时收口 / 重启恢复扫描）在 film-watch.ts，这里只取入口。 */
import { watchFilm } from "./film-watch";

export type FilmShotInput = {
  /** 逐镜配音产物地址（ISSUE #5213）：落 params.audioPath，成片合成混入对白轨。 */
  audioUrl?: string;
  /** 角色台词（工坊 Shot.dialogue）：字幕与后续配音的唯一源，落 params.dialogue。 */
  dialogue?: string;
  /** 镜头时长（秒，工坊 Shot.duration）；缺省按 frames / fps 折算。 */
  duration?: number;
  /** 工坊阶段④定稿的镜头图（ISSUE #5141）：进 params.firstFrame，视频首帧不再另合成。 */
  firstFrame?: string;
  heading?: string;
  negative?: string;
  order: number;
  prompt: string;
  /** 关联的统一镜头 id（Phase 5 逐镜回写用）；自由建片（剧本自解析）时无来源，留空。 */
  shotId?: string;
  /** 跨镜接力的上一镜片段地址（ISSUE #5212）：生成时抽尾帧当本镜首帧。 */
  tailFrameFrom?: string;
  /** 已归一的逐镜声音绑定（ISSUE #5213）：随 params 落库，供 TTS 与换集复用。 */
  voice?: VoiceBinding;
};

export type CreateFilmInput = {
  bgmName?: string | null;
  fps?: number;
  framesPerShot?: number;
  /** 文生视频镜头合成首帧用的**图类工作流 id**；镜头自带首帧时不需要。 */
  imageWorkflowId?: string | null;
  script: string;
  /** 成片画幅（尺寸表达：比例 + 分辨率 / 比例 + 百万像素 + 倍数）。缺省走视频
   *  场景 16:9 1k；仍传 "1280x720" 这类老字符串时由 `toSizeSpec` 归一。 */
  size?: unknown;
  styleSlug?: string | null;
  subtitleOn?: boolean;
  title: string;
  /** 逐镜对白用的 T2S 工作流 id（ISSUE #5244）；不配则只出字幕不出配音。 */
  ttsWorkflowId?: string | null;
  type?: string;
  userId: string;
  /** 逐镜生成用的**工作流库视频工作流 id**（本地链路唯一来源，内置模板已移除）。 */
  videoWorkflowId?: string | null;
};

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

// production.shots 是 JSON 列（unknown）：只判「是数组」这层，元素形状由写入端
// 保证、读侧 draft-integrity 判（认不出就丢等于静默删数据）。
function isShotArray(v: unknown): v is Array<Shot> {
  return Array.isArray(v);
}

// 执行进度的 resultImages 是 JSON 列（unknown）：只判「是数组」这层，
// 元素字段（mediaType / localPath）按可选字段读，不认的形状回落空数组。

// ── script → storyboard ────────────────────────────────────
const ShotSchema = z.object({
  heading: z.unknown(),
  action: z.unknown(),
  dialogue: z.unknown(),
  shotCount: z.unknown(),
});

async function expandScriptLLM(raw: string): Promise<
  Array<{
    action: string;
    dialogue: string;
    heading: string;
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
): Promise<Array<FilmShotInput>> {
  let scenes: Array<{ action: string; heading: string; shotCount: number }>;
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
      // type 是外来字符串：不在词表回落 "short_video"（parseIdeaToScenes 的既定默认）。
      type: isProjectType(type) ? type : "short_video",
      tone: "",
      logline: "",
    });
    scenes = sc.map((scene) => ({
      heading: scene.heading,
      action: `${scene.action}${scene.dialogue ? ` ${scene.dialogue}` : ""}`,
      shotCount: scene.shotCount,
    }));
  }

  const shots: Array<FilmShotInput> = [];
  let order = 0;
  for (const sc of scenes) {
    for (let i = 0; i < sc.shotCount; i++) {
      const cam = CAMERA_KEYWORDS[order % CAMERA_KEYWORDS.length];
      const base = sc.action.trim() || raw.trim();
      const parts = [base, cam];
      if (stylePrompt !== undefined && stylePrompt !== "") {
        parts.push(stylePrompt);
      }
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
/** 落库一份成片 + 其镜头行。`createFilm`（剧本自解析）与 `createFilmFromProject`
 *  （读统一项目 Shot[]）共用的唯一落点 —— 逐镜 params 的折算只此一处（§12.12）。 */
async function persistFilmWithShots(args: {
  bgmName?: string | null;
  fps: number;
  framesPerShot: number;
  imageWorkflowId: string;
  projectId?: string | null;
  script: string;
  shotInputs: Array<FilmShotInput>;
  sizeSpec: unknown;
  styleSlug?: string | null;
  subtitleOn: boolean;
  title: string;
  ttsWorkflowId?: string | null;
  type: string;
  userId: string;
  videoWorkflowId: string;
}): Promise<string> {
  return db.transaction(
    async (tx) => {
      const film = await filmRepository.create(
        {
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
        },
        tx,
      );
      await filmShotRepository.createMany(
        film.id,
        args.shotInputs.map((shot) => ({
          order: shot.order,
          shotId: shot.shotId ?? null,
          heading: shot.heading ?? null,
          prompt: shot.prompt,
          negative: shot.negative ?? null,
          params: {
            frames: args.framesPerShot,
            fps: args.fps,
            /* 时长口按秒、帧数口按帧：两种单位都随任务落库（ISSUE #5139），
             * 端口挑自己认的那个，监看侧算 -t / 字幕也用同一份秒值。 */
            duration: shot.duration ?? args.framesPerShot / args.fps,
            /* 台词随镜头落 params（ISSUE #5210）：字幕烧录与 SRT 导出都读这一份，
             * 不再让 heading/prompt 冒充对白。 */
            ...(shot.dialogue === undefined || shot.dialogue === ""
              ? {}
              : { dialogue: shot.dialogue }),
            /* 单镜画幅用场景无关档（ISSUE #5138）：出图与视频两侧算出同一组宽高。 */
            size: shotSizeFor(args.sizeSpec),
            videoWorkflowId: args.videoWorkflowId,
            imageWorkflowId: args.imageWorkflowId,
            /* TTS 工作流 id（ISSUE #5244）：逐镜对白任务从 params 读它，不另起配置面。 */
            ttsWorkflowId: args.ttsWorkflowId ?? "",
            ...(shot.firstFrame === undefined || shot.firstFrame === ""
              ? {}
              : { firstFrame: shot.firstFrame }),
            ...(shot.tailFrameFrom === undefined || shot.tailFrameFrom === ""
              ? {}
              : { tailFrameFrom: shot.tailFrameFrom }),
            /* 逐镜配音（ISSUE #5213）：声音绑定与 TTS 载荷在建片时算一次落 params；
             * 已有配音产物的镜头把地址一并落库，成片合成据此混入对白轨。 */
            ...(shot.voice === undefined
              ? {}
              : {
                  voice: shot.voice,
                  ttsParams: ttsParamsOf({
                    dialogue: shot.dialogue ?? "",
                    voice: shot.voice,
                  }),
                }),
            ...(shot.audioUrl === undefined || shot.audioUrl === ""
              ? {}
              : { audioPath: shot.audioUrl }),
          },
        })),
        tx,
      );
      return film.id;
    },
    { behavior: "immediate" },
  );
}

export async function createFilm(input: CreateFilmInput) {
  /* 成片画幅按尺寸表达存（数据库那一列是文本，存 JSON）；镜头侧存同一份尺寸表达
   * （工作流库工作流由封装层逐端口派值，不再折算成 "WxH"）。 */
  const sizeSpec = toSizeSpec(input.size ?? FILM_COMPOSE_SIZE);
  const fps = input.fps ?? 16;
  const framesPerShot = input.framesPerShot ?? 49;

  let stylePrompt: string | undefined;
  let styleNegative: string | undefined;
  if (input.styleSlug !== undefined && input.styleSlug !== null && input.styleSlug !== "") {
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
    ttsWorkflowId: input.ttsWorkflowId ?? null,
    shotInputs: shots,
  });

  await appendFilmLog(filmId, "success", `已生成分镜，共 ${shots.length} 个镜头`);
  return { id: filmId, shots: shots.length };
}

export type CreateFilmFromProjectInput = {
  bgmName?: string | null;
  fps?: number;
  framesPerShot?: number;
  /** 文生视频镜头合成首帧用的图类工作流 id。 */
  imageWorkflowId?: string | null;
  /** 统一项目 id（proj_*）；镜头取自该项目的 production.shots。 */
  projectId: string;
  /** 只生成指定镜头（逐镜 retake）：缺省 = 全部镜头。 */
  shotIds?: Array<string>;
  size?: unknown;
  subtitleOn?: boolean;
  title?: string;
  /** 逐镜对白用的 T2S 工作流 id（ISSUE #5244）。 */
  ttsWorkflowId?: string | null;
  type?: string;
  userId: string;
  /** 逐镜生成用的工作流库视频工作流 id（本地链路唯一来源）。 */
  videoWorkflowId?: string | null;
};

/** 从统一项目的 `production.shots` 直接建片（Phase 5 接入，设计 §6.3）：
 *  工坊已产出的镜头不再走「自建剧本 → LLM 平行分镜」，而是逐条映射为成片镜头。
 *  镜头的 prompt / negative 已是工坊定稿（含风格），这里不二次加工；顺序按镜号 index。 */
export async function createFilmFromProject(input: CreateFilmFromProjectInput) {
  const row = await productionRepository.getForUser(input.userId, input.projectId);
  const rawShots = row && isShotArray(row.shots) ? row.shots : [];
  const only = input.shotIds;
  const shots = [...rawShots]
    .filter((shot) => only === undefined || only.includes(shot.id))
    .sort((a, b) => a.index - b.index);
  if (!shots.length) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "该项目还没有镜头，请先在工坊产出镜头再成片",
    });
  }

  const sizeSpec = toSizeSpec(input.size ?? FILM_COMPOSE_SIZE);
  const fps = input.fps ?? 16;
  const framesPerShot = input.framesPerShot ?? 49;

  /* 角色声音绑定的唯一入口（ISSUE #5213）：草稿里的 characters 是外来 JSON，
   * 用写侧 schema 收一遍再喂归一器；脏数据当没有绑定，不打断建片。 */
  const parsedCharacters = characterListInputSchema.safeParse(row?.characters);
  const characters = parsedCharacters.success ? parsedCharacters.data : [];

  const shotInputs: Array<FilmShotInput> = shots.map((shot, i) => ({
    order: i,
    shotId: shot.id,
    heading: shot.sceneHeading || undefined,
    dialogue: shot.dialogue ?? undefined,
    prompt: shot.prompt,
    negative: shot.negativePrompt || undefined,
    /* 工坊阶段④定稿的镜头图直接接到阶段⑤的首帧输入（ISSUE #5141）。 */
    firstFrame: shot.imageUrl ?? undefined,
    /* 跨镜接力：上一镜已有片段才带来源，生成时抽尾帧覆盖首帧（ISSUE #5212）。 */
    tailFrameFrom: (() => {
      const from = shot.continuityFromShotId;
      if (typeof from !== "string" || from === "") {
        return undefined;
      }
      const prev = rawShots.find((candidate) => candidate.id === from);
      return typeof prev?.clipUrl === "string" && prev.clipUrl !== "" ? prev.clipUrl : undefined;
    })(),
    /* 声音归属：镜头覆写 > 出场角色绑定 > 空绑定（ISSUE #5213）。 */
    voice: resolveVoice(characters, shot.characterIds ?? [], shot.voice),
    audioUrl: shot.audioUrl ?? undefined,
    duration: shot.duration,
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
    ttsWorkflowId: input.ttsWorkflowId ?? null,
    shotInputs,
  });

  await appendFilmLog(filmId, "success", `从项目镜头建片，共 ${shotInputs.length} 个镜头`);
  return { id: filmId, shots: shotInputs.length };
}

// ── 生成一个视频镜头 ──────────────────────────────────────
// 视频这一跳没有内置模板（内置 img2video / txt2video 与 `__PROMPT__` token 替换已移除）：镜头 params
// 必须带**工作流库视频工作流 id**；没有首帧时用同一份 params 的**图类工作流 id** 本地合成一张再喂。
// 种子口径与 Agent 逐镜生图一致：每次自主出图带新随机 seed，且只经「种子」对外参数下发（落已连的
// seed / noise_seed 端口，未连则进 unmatched 用图内 seed），运行期绝不改写工作流节点。
async function generateVideoShot(
  userId: string,
  shot: { negative?: string | null; params?: unknown; prompt: string },
): Promise<string> {
  // params 是外来 JSON：当成宽松对象读，非对象按空对象处理（各字段仍逐字段 typeof 校验）。
  const params: Record<string, unknown> = asRecord(shot.params ?? {}) ?? {};

  const videoWorkflowId = typeof params.videoWorkflowId === "string" ? params.videoWorkflowId : "";
  if (!videoWorkflowId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "镜头缺少「工作流库视频工作流 id」，无法本地生成",
    });
  }

  const size = toSizeSpec(params.size ?? NATIVE_SHOT_VIDEO_SIZE);

  // inputImage 为 "" 等 falsy 值时仍需走下方合成首帧分支：外来值不是字符串时
  // 也按「没有首帧」回落（既有默认分支），不把脏值原样喂给工作流。
  const rawInputImage = params.inputImage ?? params.firstFrame;
  let inputImage: string = typeof rawInputImage === "string" ? rawInputImage : "";
  /* 工坊定稿的分镜图是 `/api/generated/...` 产物地址（ISSUE #5141）：ComfyUI 的
   * LoadImage 只认 input 目录里的文件名，先落盘读字节再上传，换成上传后的名字。 */
  /* 跨镜接力优先于定稿图（ISSUE #5212）：上一镜片段的尾帧作本镜首帧；
   * 抽帧失败回落定稿图，不阻断生成。 */
  const tailFrom = typeof params.tailFrameFrom === "string" ? params.tailFrameFrom : "";
  if (tailFrom !== "") {
    const tail = await extractTailFrameUrl(tailFrom);
    if (tail !== null) {
      inputImage = tail;
    }
  }
  if (inputImage !== "") {
    inputImage = await resolveFilmFirstFrame(inputImage);
  }

  if (!inputImage) {
    const imageWorkflowId =
      typeof params.imageWorkflowId === "string" ? params.imageWorkflowId : "";
    if (!imageWorkflowId) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "镜头缺少首帧，且没有配置「工作流库图类工作流 id」可用于合成首帧",
      });
    }
    inputImage = await synthesizeFirstFrame({
      userId,
      workflowId: imageWorkflowId,
      prompt: shot.prompt,
      negative: shot.negative ?? undefined,
      size,
      seed: randomSeed(),
    });
  }

  const { taskId } = await createWorkflowRunTask({
    userId,
    workflowId: videoWorkflowId,
    values: {
      prompt: shot.prompt,
      ...(shot.negative !== null && shot.negative !== "" ? { negativePrompt: shot.negative } : {}),
      firstFrame: inputImage,
      frames: typeof params.frames === "number" ? params.frames : 81,
      /* 秒制时长口拿秒、帧制口拿帧（ISSUE #5139）；两种单位都随载荷下发，
       * 由端口按自己的落点挑，不再把 49 帧当 49 秒。 */
      duration:
        typeof params.duration === "number"
          ? params.duration
          : (typeof params.frames === "number" ? params.frames : 81) /
            (typeof params.fps === "number" && params.fps > 0 ? params.fps : 16),
      size,
      seed: randomSeed(),
    },
  });

  return taskId;
}

// ── start (autopilot) ───────────────────────────────────────
export async function startFilm(id: string, opts: { skipCompose?: boolean } = {}) {
  const film = await filmRepository.findById(id);
  if (!film) {
    throw new TRPCError({ code: "NOT_FOUND", message: "影片不存在" });
  }

  /* 重跑恢复口（#4595）：影片被判 FAILED（含监看超时）后，把失败镜头重置回
   * IDLE 再领——已 SUCCEEDED 的镜头保留视频不重跑，只补没完成的那些。 */
  if (film.status === "FAILED") {
    await filmShotRepository.markFailedShotsIdle(id);
  }
  const shots = await filmShotRepository.listByFilm(id, { status: "IDLE" });
  if (!shots.length) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "没有可生成的镜头，请重新创建",
    });
  }

  /* 条件抢占（ISSUE #3836）：原先「读 status → 判断 → 无条件 markGenerating」
   * 在双击 / 并发下会双双通过，给每个镜头排两批视频任务（重复算力）。改成
   * 单语句条件写：抢不到（已在 GENERATING/COMPOSING）就直接让位。 */
  const claimed = await filmRepository.claimGenerating(id);
  if (!claimed) {
    return;
  }

  await appendFilmLog(id, "info", `开始逐镜生成（共 ${shots.length} 镜）`);

  for (const shot of shots) {
    /* 每轮先重读影片状态（ISSUE #3867）：用户在逐镜提交中途取消（或影片已因
     * 异常离场）时，剩余镜头不再向 ComfyUI 提交——原先不看状态一路提交完，
     * 取消后这些任务照常执行、白烧算力且无人取消。 */
    // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：提交下一镜之前必须拿到最新状态
    const current = await filmRepository.findById(id);
    if (current?.status !== "GENERATING") {
      // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：退出前留痕
      await appendFilmLog(id, "warn", "影片已不在生成中，停止提交剩余镜头");
      return;
    }
    try {
      // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
      const taskId = await generateVideoShot(film.userId, {
        prompt: shot.prompt,
        negative: shot.negative,
        params: shot.params,
      });
      try {
        // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
        await filmShotRepository.markQueued(shot.id, taskId);
        /* 逐镜对白（ISSUE #5244）：有 ttsParams 才起任务，失败只记日志、不改视频镜头态。 */
        // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：视频任务排队后再起对白任务
        await ensureShotAudio(film.userId, id, shot.id, shot.params);
      } catch (error) {
        /* 记账失败的补偿（ISSUE #3867）：任务行已真实建立、会被执行器领取——
         * 只把镜头标 FAILED 会留下一个照跑的孤儿任务。先取消它再记账。 */
        // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
        await filmShotRepository.markFailed(shot.id);
        // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
        await cancelTask(taskId).catch((cancelError: unknown) => {
          /* 补偿取消失败要看得见（ISSUE #4254）：任务行还是 QUEUED、会被
           * 派发照常执行——「已补偿取消任务」的日志不能掩盖这次失败。 */
          const detail = errorText(cancelError, "补偿取消失败");
          logger.warn(`[film] 补偿取消任务失败（task=${taskId}）：${detail}`);
          void appendFilmLog(
            id,
            "error",
            `${errorText(error, `镜头 ${shot.order + 1} 记账失败`)}；补偿取消任务 ${taskId} 也失败（${detail}）——任务可能仍会被执行，请到 ComfyUI 侧手动中断。`,
          ).catch(() => undefined);
        });
        // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
        await appendFilmLog(
          id,
          "error",
          `${errorText(error, `镜头 ${shot.order + 1} 记账失败`)}（已补偿取消任务 ${taskId}）`,
        );
      }
    } catch (error) {
      // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
      await filmShotRepository.markFailed(shot.id);
      // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
      await appendFilmLog(id, "error", errorText(error, `镜头 ${shot.order + 1} 提交失败`));
    }
  }

  // 后台监看 → 合成（循环 rejection 的就地收口在 watchFilm 里那道 .catch，#4216；
  // 交接重读段的守卫见 watchFilm 开头，#4220 —— 两段合起来 watchFilm 不 reject）。
  void watchFilm(id, { skipCompose: opts.skipCompose === true });
}

// ── watch + update：拆到 film-watch.ts（文件行数硬闸，#4595）─────────
export { resumeStalledFilms } from "./film-watch";

// ── cancel ──────────────────────────────────────────────────
export async function cancelFilm(id: string) {
  const film = await filmRepository.findById(id);
  if (!film) {
    return;
  }
  const shots = await filmShotRepository.listActiveWithTask(id);
  for (const s of shots) {
    if (s.taskId !== null && s.taskId !== "") {
      // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
      await cancelTask(s.taskId).catch((cancelError: unknown) => {
        /* 补偿取消失败要看得见（ISSUE #4269，范式同 #4254）：取消影片时子任务
         * 撤单失败，任务仍会在 ComfyUI 侧继续执行烧 GPU——不能静默。 */
        logger.warn(
          `[film] cancelFilm 补偿取消任务失败（task=${s.taskId}）：${errorText(cancelError, "补偿取消失败")}`,
        );
      });
    }
  }
  /* 两步收进同一事务（ISSUE #3867）：「镜头染 FAILED」与「影片置 CANCELLED」
   * 分两次提交时，中途失败会留下「镜头已失败、影片还 GENERATING」的半态，
   * 只能靠监看超时兜底。 */
  await db.transaction(
    async (tx) => {
      await filmShotRepository.markAllActiveFailed(id, tx);
      await filmRepository.markCancelled(id, tx);
    },
    { behavior: "immediate" },
  );
  await appendFilmLog(id, "warn", "影片已取消");
}
