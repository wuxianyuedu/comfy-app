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
import {
  filmRepository,
  filmShotRepository,
  skillRepository,
  taskRepository,
} from "~/lib/core/repository";
import { productionRepository } from "~/lib/core/repository-production";
import { logger } from "~/lib/core/logger";
import { isSchemaReady } from "~/lib/db-schema-ready";
import type { Shot } from "~/lib/workshop/types";
import { cancelTask } from "~/lib/comfyui/enqueue";
import { synthesizeFirstFrame } from "~/lib/comfyui/firstframe";
import { randomSeed } from "~/lib/comfyui/random-seed";
import { createWorkflowRunTask } from "~/lib/workshop/workflow-run.server";
import { parseIdeaToScenes } from "~/lib/workshop/script-parser";
import {
  FILM_COMPOSE_SIZE,
  NATIVE_SHOT_VIDEO_SIZE,
} from "~/lib/film/film-size";
import { z } from "zod";
import { getLLMConfig, completeLLMStructured } from "~/lib/llm/server";
import type { ProjectType } from "~/lib/workshop/types";
import { errorText } from "~/lib/error-message";
/* 镜头尺寸表达 → 像素的折算在读载荷时还要用（合成那半段搬到 compose-film.ts 了）。 */
import { toSizeSpec } from "~/lib/media/size-presets";
/* 状态族的一份定义（视图层与服务端共用，见那份模块的文件头）：这里只 import，不再抄一份。 */
import type { ShotStatus } from "~/lib/film/film-status";
/* 合成与「回写统一项目」是同一格（只搬合成会成环，判据见 compose-film.ts 文件头）；
 * 行日志那一份两侧都要用，所以它在 film-log.ts 这个叶子上。 */
import { appendFilmLog } from "./film-log";
import { composeFilm } from "./compose-film";

export interface FilmShotInput {
  order: number;
  /** 关联的统一镜头 id（Phase 5 逐镜回写用）；自由建片（剧本自解析）时无来源，留空。 */
  shotId?: string;
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
      shotId: shot.shotId ?? null,
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
    shotId: shot.id,
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

// ── 生成一个视频镜头 ──────────────────────────────────────
// 视频这一跳没有内置模板（内置 img2video / txt2video 与 `__PROMPT__` 系列
// token 替换已移除）：镜头 params 里必须带**工作流库视频工作流 id**。
// 没有首帧时，用同一份 params 里的**图类工作流 id** 本地合成一张再喂给视频图。
// 种子口径与 Agent 逐镜生图一致：这条 autopilot 每次自主出图都带一个新的随机
// seed，且只经「种子」对外参数下发（落作者连的 seed / noise_seed 端口，没连则
// 进 unmatched、用工作流图内 seed），运行期绝不改写工作流节点。
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
      seed: randomSeed(),
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
      seed: randomSeed(),
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
/* 监看循环的两项常量。写在一起是因为**给用户看的预算文案必须与判据同源**：
 * 上一版把「~16 min」写在注释里、把「超过 16 分钟」写在报错文案里，改一个
 * 另一个不会跟着改。 */
const WATCH_POLL_MS = 4000;
const WATCH_MAX_ITER = 240;
const WATCH_BUDGET_MIN = Math.round((WATCH_POLL_MS * WATCH_MAX_ITER) / 60000);

/* **监看在飞表**（跨模块实例）。`watchFilm` 是被 `void` 起来的常驻循环，而
 * dev 的热重启不会杀掉旧模块那条 promise 链 —— 旧循环还在跑，本模块的新实例
 * 又会被下面的 boot 扫描再起一条，于是同一部影片有两个监看同时在写进度、
 * 并且都会调 `composeFilm`（`markComposing` 是无条件写）⇒ 同一部片被 ffmpeg
 * 合成两次。所以「谁在监看这部影片」必须放在跨 HMR 仍然活着的地方。
 * 键名带版本号是既定的坑：`??=` 只认键名，不会给旧单例补字段（同 `runner-state`）。 */
declare global {
  var filmWatchInFlight_v1: Set<string> | undefined;
}

function inFlightFilms(): Set<string> {
  globalThis.filmWatchInFlight_v1 ??= new Set<string>();
  return globalThis.filmWatchInFlight_v1;
}

/** 监看一部影片直到出片 / 判失败；同一部影片在本进程内**至多一条**循环。 */
async function watchFilm(id: string, opts: { resumed?: boolean } = {}) {
  const inFlight = inFlightFilms();
  if (inFlight.has(id)) return;
  inFlight.add(id);
  try {
    await watchLoop(id, opts);
  } finally {
    inFlight.delete(id);
  }
}

async function watchLoop(id: string, opts: { resumed?: boolean }) {
  if (opts.resumed) {
    /* 续跑要在行日志里留痕：否则用户看到的是「重启之后它自己动起来了」，
     * 而支持现场需要据这一行判断「是 boot 扫描接上的，还是原循环还活着」。 */
    await appendFilmLog(
      id,
      "info",
      `进程重启后续跑监看（本轮预算 ${WATCH_BUDGET_MIN} 分钟）`,
    );
  }
  for (let i = 0; i < WATCH_MAX_ITER; i++) {
    const film = await filmRepository.findById(id);
    if (!film || film.status === "CANCELLED" || film.status === "FAILED")
      return;
    if (film.status !== "GENERATING") {
      // 已经走掉了（例如合成已开始）
    }

    const shots = await filmShotRepository.listByFilm(id);
    /* 一行镜头都没有的 GENERATING 只可能是「`markGenerating` 之后、逐镜提交之前」
     * 崩在这里。这条状态在本刀之前不可达（监看只由 `startFilm` 起，那时 shots 必然
     * 非空），而 boot 续跑扫描会把它捡起来 —— 不判掉就是 `0/0` 的 NaN 进度，
     * 然后带着一条空时间线去合成。 */
    if (!shots.length) {
      await filmRepository.markFailed(id, "没有可继续的镜头");
      await appendFilmLog(
        id,
        "error",
        "监看发现这部影片一个镜头都没有（在逐镜提交之前就中断了），已判失败：请重新创建镜头后再点「开始生成」。",
      );
      return;
    }
    let pending = 0;
    let done = 0;
    let failed = 0;

    /* 先把「不用再问数据库」的镜头结清（没有 taskId 的、已终态的），剩下的
     * **一次性**批量取进度：原先是逐镜头 `await findExecutionProgress`，一轮
     * 就是 2N 次往返（N = 镜头数），跑满 240 轮是上万次查询。 */
    const awaiting: (typeof shots)[number][] = [];
    for (const shot of shots) {
      /* **先判终态、再判有没有 taskId**，顺序是判据不是风格：这一趟原先是
       * `if (!shot.taskId) { pending++; continue }` 打头，于是「已终态但没有任务」
       * 的镜头被数成还在等 —— 而那种行是真实存在的：逐镜提交时 `catch` 落的是
       * `markFailed(shot.id)`（没有 taskId），成片重跑/续跑时也可能带着已完成的旧镜头。
       * 后果不是显示不准，是**永不收口**：`pending` 永远不为 0，于是既不合成、
       * 也不判失败，一路轮询到预算耗尽才落一句「生成超时」（实测：夹具里一个
       * SUCCEEDED 无 taskId 的镜头就让影片停在 progress 50）。
       * 真正「没任务又不是终态」的（IDLE / 提交前就崩的 QUEUED）照旧算等待。 */
      if (shot.status === "SUCCEEDED" || shot.status === "FAILED") {
        if (shot.status === "SUCCEEDED") done++;
        else failed++;
        continue;
      }
      if (!shot.taskId) {
        pending++;
        continue;
      }
      awaiting.push(shot);
    }

    const taskIds: string[] = [];
    for (const shot of awaiting) {
      if (shot.taskId) taskIds.push(shot.taskId);
    }
    const progressById = new Map(
      (await taskRepository.findExecutionProgressMany(taskIds)).map(
        (row) => [row.id, row] as const,
      ),
    );

    for (const shot of awaiting) {
      const task = shot.taskId ? progressById.get(shot.taskId) : undefined;
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

      /* 只在真的变了才写：原先每轮对每个在跑的镜头都无条件 UPDATE，绝大多数
       * 轮次写进去的是与库里一模一样的值。 */
      const nextProgress = task.progress ?? 0;
      if (shot.status !== next || (shot.progress ?? 0) !== nextProgress) {
        await filmShotRepository.updateFromTask(shot.id, {
          status: next,
          progress: nextProgress,
          videoPath: videoPath ?? undefined,
          duration: duration ?? null,
        });
      }
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
    await sleep(WATCH_POLL_MS);
  }
  await filmRepository.markFailed(id, "生成超时");
  await appendFilmLog(
    id,
    "error",
    `影片生成超时（本轮监看超过 ${WATCH_BUDGET_MIN} 分钟）`,
  );
}

/**
 * 进程重启后的恢复扫描：把丢了监看主体的影片接回去（P3 §5 ADR 的 5-A）。
 *
 * 为什么需要它：`startFilm` 末尾那条 `void watchFilm()` 只活在**当前进程**里，
 * 而 dev 的热重启与桌包的重启都会让它消失 —— 镜头对应的任务却还在库里由执行侧
 * 推进（宿主不跟着 Next 一起死，ADR §14 D1）。没人监看 ⇒ 影片永远停在
 * `GENERATING`：既不出片也不失败，界面上是一个转不完的圈。返回值只给日志与用例
 * 用，调用方不据它做决策。
 */
export async function resumeStalledFilms(): Promise<{
  resumed: string[];
  abandoned: string[];
}> {
  /* 表还没建就整轮跳过，与回收器同一口径（`sweepOnce` 也判这一条）。哨兵表是
   * `task`，而首启是一次把整套 DDL 应用上去的 ⇒ `task` 在时 `filmProject` 也在。
   * 「表在、查询失败」不在这里被吞：那走下面的 catch，Warn 出来但仍不炸启动。
   *
   * 这条扫描是**一次性**的（不像回收器每 30s 一轮），跳过了就得等下一次重启才有人
   * 接片，所以必须留痕 —— 否则现场只能看到「影片停在生成中」而读不到任何原因。 */
  if (!isSchemaReady()) {
    logger.info("[film] 重启恢复扫描跳过（表还没建就绪）");
    return { resumed: [], abandoned: [] };
  }

  const resumed: string[] = [];
  const abandoned: string[] = [];

  try {
    for (const film of await filmRepository.listByStatus(["GENERATING"])) {
      /* 本进程已有循环在跑（HMR 之后旧循环还活着）就不再起第二条 ——
       * 判据与 `watchFilm` 内部那道是同一份在飞表，两处各自判就会漂开。 */
      if (inFlightFilms().has(film.id)) continue;
      resumed.push(film.id);
      void watchFilm(film.id, { resumed: true });
    }

    /* COMPOSING **不**续跑，直接判掉。`composeFilm` 一见到 COMPOSING 就早退
     * （`status === "COMPOSING" || "DONE"` 那条），而它是**无条件**写进去的状态，
     * 于是崩在合成中的影片连界面上「重新合成」这个唯一出口都被自己挡住 ——
     * 判成 FAILED 才把出口接回来（FAILED 是 `composeFilm` 允许重跑的状态），
     * 而不是开机时静默重跑 ffmpeg（用户没要求却开始占 CPU 写文件）。 */
    for (const film of await filmRepository.listByStatus(["COMPOSING"])) {
      await filmRepository.markFailed(
        film.id,
        "合成中断（进程在合成期间退出）",
      );
      await appendFilmLog(
        film.id,
        "error",
        "合成在进程重启时被打断，已判失败。镜头视频仍在，点「重新合成」可再来一次（需要本机装有 ffmpeg）。",
      );
      abandoned.push(film.id);
    }
  } catch (err) {
    logger.warn(
      `[film] ${errorText(err, "resumeStalledFilms 失败（重启恢复扫描）")}`,
    );
  }

  if (resumed.length || abandoned.length) {
    logger.info(
      `[film] 重启恢复扫描：续跑监看 ${resumed.length} 部，合成中断判失败 ${abandoned.length} 部`,
    );
  }
  return { resumed, abandoned };
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
