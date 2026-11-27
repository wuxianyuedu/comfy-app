/**
 * `compose-film.ts` —— 服务端出片那半段：ffmpeg 探测 / 执行 / 合成 / 回写统一项目（ISSUE #1257
 * 从 `orchestrator.ts` 下沉，因它越过 §12.6 行数上限，拆法是把这半段整块搬走。合成与回写一起搬：
 * `syncFilmToProject` 只被 `composeFilm` 调，回写留在编排侧就要反向 import 成环（issue 记着）；方向单向：`orchestrator` → 本模块 → `film-log` / `compose-steps`（共用叶子）。
 */
import "server-only";

import { TRPCError } from "@trpc/server";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { filmRepository, filmShotRepository, taskRepository } from "~/lib/core/repository";
import { productionRepository } from "~/lib/core/repository-production";
import { normalizeProductionProgress } from "~/lib/production/progress";
import { withProductionContentLock } from "~/lib/production/content-write-lock";
import type { Shot } from "~/lib/workshop/types";
import { isFilmShotStatus, type ShotStatus } from "~/lib/film/film-status";
import { sizeSpecDims, toSizeSpec } from "~/lib/media/size-presets";
import { loadSizePresetTable } from "~/lib/media/size-preset-fs.server";
import {
  artifactUrl,
  filmBgmRoot,
  filmsRoot,
  isWithinGeneratedRoot,
} from "~/lib/media/output-paths";
import { isSafeBgmName } from "~/lib/film/bgm-name";
import { errorMessage, errorText } from "~/lib/error-message";
import { withTimeoutResult } from "~/lib/with-timeout";
import { INLINE_SNIPPET_MAX, clampText } from "~/lib/text-clamp";
import {
  buildFilmSrt,
  buildNormalizeArgs,
  buildSegmentVf,
  buildSrtBody,
  clipPathOf,
  subtitleTextOf,
} from "./compose-steps";
import { appendFilmLog } from "./film-log";

/** `filmShot.params`（JSON 列）里的台词。只认字符串，形状不对就当没有——
 *  字幕宁可回退标题，也不把「[object Object]」烧进画面。 */
function dialogueOfParams(params: unknown): string | null {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    return null;
  }
  for (const [key, value] of Object.entries(params)) {
    if (key === "dialogue" && typeof value === "string") {
      return value;
    }
  }
  return null;
}

// ── 回写：成片合成完成 → 统一项目逐镜 clip + 完成状态（Phase 5 / §6.3 + §7）──
/** 合成成片里一个镜头的结果（用于把逐镜视频回写进统一项目的对应 Shot）。 */
export type FilmShotClip = {
  /** 关联的统一镜头 id（production.shots[].id）；自由建片的镜头为 null（跳过）。 */
  shotId: string | null;
  status: ShotStatus;
  videoPath: string | null;
};

// production.shots 是 JSON 列（unknown）：只判「是数组」这层，元素形状由写入端
// 保证、读侧 draft-integrity 判（认不出就丢等于静默删数据）。
function isShotArray(v: unknown): v is Array<Shot> {
  return Array.isArray(v);
}

/** 把「从项目建的片」合成完成后的结果，回写进来源统一项目：
 *   1) 逐镜视频 —— 按 `shotId` 命中 `production.shots` 里的对应 Shot，写入 clipUrl / clipStatus；
 *   2) 完成状态 —— `progress` 读-改-写：`rendered=true`、阶段推进到 `render`，其余字段原样保留。
 *  一次读-改-写完成（progress 与 shots 是同一行的两列，分两次写会互相覆盖，故合并）。
 *  仅对 `filmProject.projectId` 非空（走统一项目建片）生效。 */
export async function syncFilmToProject(
  userId: string,
  projectId: string,
  filmShots: Array<FilmShotClip>,
): Promise<void> {
  /* 整段读-改-写收进 per-project 内容写锁（ISSUE #3864）：与 run 引擎 / 评审器 /
   * 人工裁决的并发修改不再互覆（无慢 IO 在锁内，纯读列-合并-写列）。 */
  await withProductionContentLock(projectId, async () => {
    const row = await productionRepository.getForUser(userId, projectId);
    if (!row) {
      return;
    }
    const progress = normalizeProductionProgress(row.progress);
    const rawShots = isShotArray(row.shots) ? row.shots : [];

    // 按 shotId 索引成片结果（只取有 videoPath 的镜头回写 clip）。
    const clipByShotId = new Map<string, FilmShotClip>();
    for (const fs of filmShots) {
      if (fs.shotId !== null && fs.videoPath !== null) {
        clipByShotId.set(fs.shotId, fs);
      }
    }

    const nextShots: Array<Shot> = rawShots.map((shot) => {
      const clip = clipByShotId.get(shot.id);
      if (!clip) {
        return shot;
      }
      return {
        ...shot,
        clipUrl: clip.videoPath ?? undefined,
        clipStatus: "done",
      };
    });

    /* 只回写自己拥有的两列（ISSUE #3832）：原先把整行读出的旧快照**全部内容列**
     * 原样写回 —— 合成期间工坊自动保存 / run 引擎 / 评审器对剧本、角色、镜头的
     * 任何修改都会被这份旧值回滚。字段所有权：shots/progress 归成片链路。 */
    await productionRepository.patchShotsAndProgress(userId, projectId, {
      shots: nextShots,
      progress: { ...progress, stage: "render", rendered: true },
    });
  });
}

// ── ffmpeg helpers ─────────────────────────────────────────
let _ffmpegOk: boolean | null = null;
/* ffmpeg 可用性缓存的口径（#4226）：**正结果长期有效**（装了不会自己消失），
 * **负结果带 TTL**——环境是可变的（装 ffmpeg / 修 PATH / 改 FFMPEG_BIN），
 * 「首次没装就永远不可用直到重启」是旧形态的坑。TTL 30s：合成是分钟级动作，
 * 探测 8s 超时 + 30s 窗口内不会造成探测风暴。 */
const FFMPEG_PROBE_TTL_MS = 30_000;
let _ffmpegProbedAt = 0;

/** 只给用例：复位探测缓存（模块级状态不跨用例泄漏）。 */
export function resetFFmpegProbeForTest(): void {
  _ffmpegOk = null;
  _ffmpegProbedAt = 0;
}

export async function isFFmpegAvailable(): Promise<boolean> {
  if (_ffmpegOk !== null && (_ffmpegOk || Date.now() - _ffmpegProbedAt < FFMPEG_PROBE_TTL_MS)) {
    return _ffmpegOk;
  }
  try {
    await runFFmpeg(["-version"], undefined, 8000);
    _ffmpegOk = true;
  } catch {
    _ffmpegOk = false;
  }
  _ffmpegProbedAt = Date.now();
  return _ffmpegOk;
}

/** stderr 的**尾部**收集器（#4228）：异常 ffmpeg（坏片循环告警）可以输出 GB 级
 *  stderr，字符串无界增长会顶到 OOM。**保留尾部**——ffmpeg 的结论在最后几行，
 *  progress 刷屏在前。分片淘汰（shift 最旧）而不是每次 slice(-N)，摊销后近似
 *  O(n)。独立成纯助手：上限语义可单测（runFFmpeg 本体要 spawn 真进程）。
 *  上限 256K 与 cnb-cli.ts 同档。 */
export function createStderrTailSink(maxChars = 256 * 1024): {
  sink: (chunk: Buffer) => void;
  text: () => string;
} {
  const parts: Array<string> = [];
  let total = 0;
  return {
    sink: (chunk: Buffer) => {
      const text = chunk.toString();
      parts.push(text);
      total += text.length;
      while (total > maxChars) {
        const dropped = parts.shift();
        if (dropped === undefined) {
          break;
        }
        total -= dropped.length;
      }
    },
    text: () => parts.join(""),
  };
}

function runFFmpeg(
  args: Array<string>,
  cwd?: string,
  timeout = 120_000,
): Promise<{ code: number; stderr: string }> {
  const bin = process.env.FFMPEG_BIN ?? "ffmpeg";
  const cp = spawn(/*turbopackIgnore: true*/ bin, args, { cwd });
  const stderrSink = createStderrTailSink();
  cp.stderr.on("data", stderrSink.sink);
  return withTimeoutResult(
    new Promise<{ code: number; stderr: string }>((resolve) => {
      cp.on("close", (code) => {
        resolve({ code: code ?? -1, stderr: stderrSink.text() });
      });
      cp.on("error", () => {
        resolve({ code: -2, stderr: "spawn error" });
      });
    }),
    timeout,
    /* 超时不是「一种结果」而是「放弃等待」：`code: -1` + `"timeout"` 是调用处
     * 一直在判的哨兵值，故走 `withTimeoutResult`（不给异常）；
     * `onTimeout` 里杀掉子进程 —— 放弃等待之后进程还占着 GPU 才是真问题。 */
    { code: -1, stderr: "timeout" },
    { onTimeout: () => cp.kill("SIGKILL") },
  );
}

// ── compose ────────────────────────────────────────────────
export async function composeFilm(id: string) {
  const film = await filmRepository.findById(id);
  if (!film) {
    return;
  }
  /* 条件抢占（ISSUE #3836）：双击「重新合成」此前会双双通过读态判断，
   * 两个 ffmpeg 同时写同一个临时目录与最终 mp4。改成单语句条件写：
   * 抢不到（已在 COMPOSING/DONE）就让位。 */
  const claimed = await filmRepository.claimComposing(id);
  if (!claimed) {
    return;
  }
  /* 知情交付（ISSUE #4609）：监看侧只在「全部失败」才判 FAILED，部分镜头失败
   * 的影片照样进合成。缺段的片子必须让用户知道缺了哪几镜、为什么——失败镜头
   * 的序号与原因（task.error）在合成前写进影片日志 warn，成片面板另有同源提示。 */
  const failedShots = await filmShotRepository.listByFilm(id, { status: "FAILED" });
  if (failedShots.length > 0) {
    const taskIds = failedShots
      .map((shot) => shot.taskId)
      .filter((taskId): taskId is string => taskId !== null && taskId !== "");
    const reasonById = new Map(
      (await taskRepository.findExecutionProgressMany(taskIds)).map((row) => [row.id, row.error]),
    );
    const detail = failedShots
      .map((shot) => {
        const reason =
          shot.taskId !== null && shot.taskId !== "" ? reasonById.get(shot.taskId) : undefined;
        return `第 ${shot.order + 1} 镜（${reason ?? "原因未记录"}）`;
      })
      .join("、");
    await appendFilmLog(id, "warn", `部分镜头生成失败：${detail}；将使用其余镜头合成成片`);
    await appendFilmLog(id, "info", "开始合成影片…");
  } else {
    await appendFilmLog(id, "info", "所有镜头完成，开始合成影片…");
  }

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
   * ffmpeg 要的是像素 —— 在这里按**生效的**尺寸表折算（ISSUE #3972：设置里改过
   * 视频场景的表，合成画幅跟着变，不再用编译进包的默认快照）。 */
  const sizeTable = await loadSizePresetTable();
  const { width: W, height: H } = sizeSpecDims(toSizeSpec(film.size), "video", sizeTable);
  const fps = film.fps;
  const tmpDir = path.join(filmsRoot(), `_tmp_${id}`);
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.mkdir(filmsRoot(), { recursive: true });

  try {
    for (const [i, shot] of shots.entries()) {
      const { videoPath } = shot;
      if (videoPath === null || videoPath === "") {
        // 镜头未出片（videoPath 为空）是真实故障，不是可静默跳过的分支：
        // 抛明确文案，交给外层 catch 落 markFailed + 面板日志（硬规则 4），
        // 不再用 `shot.videoPath!` 让脏数据在 path.join 里崩成栈噪声。
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `镜头 ${i + 1} 缺少视频文件，无法合成`,
        });
      }
      const clip = clipPathOf(cwd, videoPath);
      if (clip === null) {
        // 地址解不出落在产物根内的文件 = 这一条镜头不可能合成成功：
        // 在起 ffmpeg 之前就说清是哪一条、存的是哪个地址，别让它变成一句
        // 「No such file or directory」的 stderr 片段（硬规则 4）。
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `镜头 ${i + 1} 的视频地址不在产物目录内：${clampText(videoPath, { maxLength: INLINE_SNIPPET_MAX, marker: "" })}`,
        });
      }
      const segOut = path.join(tmpDir, `seg_${i}.mp4`);
      const dur = shot.duration ?? film.framesPerShot / fps;
      const fadeOut = Math.max(0, dur - 0.3);
      const vf = buildSegmentVf({ width: W, height: H, fps, fadeOut });

      const srtPath = path.join(tmpDir, `seg_${i}.srt`);
      const srtText = subtitleTextOf({
        heading: shot.heading,
        prompt: shot.prompt,
        dialogue: dialogueOfParams(shot.params),
      });
      if (film.subtitleOn) {
        // 台词优先 → 标题 → 提示词，口径与导出的整片 SRT 完全同源（ISSUE #5210）。
        // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
        await fs.writeFile(srtPath, buildSrtBody({ text: srtText, dur }), "utf8");
      }

      const tryWithSub = film.subtitleOn;
      // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
      let res = await runFFmpeg(
        buildNormalizeArgs({
          clip,
          vf,
          dur,
          out: segOut,
          srtPath: tryWithSub ? srtPath : null,
        }),
        tmpDir,
      );
      if (res.code !== 0 && tryWithSub) {
        // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
        await appendFilmLog(id, "warn", `镜头 ${i + 1} 字幕烧录失败，重试（无字幕）`);
        // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
        res = await runFFmpeg(
          buildNormalizeArgs({ clip, vf, dur, out: segOut, srtPath: null }),
          tmpDir,
        );
      }
      if (res.code !== 0) {
        throw new Error(
          `镜头 ${i + 1} 归一化失败：${clampText(res.stderr, { maxLength: INLINE_SNIPPET_MAX, marker: "" })}`,
        );
      }
      // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
      await appendFilmLog(id, "info", `镜头 ${i + 1}/${shots.length} 已就绪`);
    }

    // concat
    const list = shots.map((_, i) => `file 'seg_${i}.mp4'`).join("\n");
    const listPath = path.join(tmpDir, "segs.txt");
    await fs.writeFile(listPath, list, "utf8");
    const concatPath = path.join(tmpDir, "concat.mp4");
    const cres = await runFFmpeg(
      ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", concatPath],
      tmpDir,
    );
    if (cres.code !== 0) {
      throw new Error(
        `拼接失败：${clampText(cres.stderr, { maxLength: INLINE_SNIPPET_MAX, marker: "" })}`,
      );
    }

    const finalPath = path.join(filmsRoot(), `${id}.mp4`);
    /* 地址与磁盘同一处派生：写进 Film 行的这条就是前端 `<video src>` 拿到的那条，
     * 自己拼一份前缀就会与 `taskOutputUrl()` 的形状分叉（台账 A8 的同一族）。 */
    const localPath = artifactUrl(["films", `${id}.mp4`]);

    if (film.bgmName !== null && film.bgmName !== "") {
      /* 根内包含校验（ISSUE #4738）：bgmName 形状不安全（带路径分隔符 / `.` / `..`）
       * 或解析结果落在 films/bgm 之外时**拒绝读取**——宁可无配乐，也不把根外文件
       * 混进音轨。路由侧的 isSafeBgmName 是第一道闸，这里对历史行与绕过路由的
       * 调用方兜底；判据与路由共用同一份（~/lib/film/bgm-name.ts）。 */
      const bgm = path.resolve(filmBgmRoot(), film.bgmName);
      const bgmAllowed = isSafeBgmName(film.bgmName) && isWithinGeneratedRoot(bgm, filmBgmRoot());
      const bgmExists = bgmAllowed
        ? await fs
            .stat(bgm)
            .then(() => true)
            .catch(() => false)
        : false;
      if (!bgmAllowed) {
        await appendFilmLog(
          id,
          "warn",
          `BGM 文件名越界，已跳过配乐：${clampText(film.bgmName, { maxLength: INLINE_SNIPPET_MAX, marker: "" })}`,
        );
      }
      if (bgmAllowed && bgmExists) {
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
        if (mres.code === 0) {
          await appendFilmLog(id, "success", "已混入背景音乐");
        } else {
          await appendFilmLog(id, "warn", "BGM 混音失败，使用无配乐版本");
          await fs.copyFile(concatPath, finalPath);
        }
      } else {
        await fs.copyFile(concatPath, finalPath);
      }
    } else {
      await fs.copyFile(concatPath, finalPath);
    }

    /* 整片 SRT 与逐镜烧录用同一份文本/时长口径（ISSUE #5210）：既能烧录也能下载校对，
     * 不再出现「画面字幕一个来源、导出字幕另一个来源」。 */
    const fullSrt = buildFilmSrt(
      shots.map((shot) => ({
        dur: shot.duration ?? film.framesPerShot / film.fps,
        text: subtitleTextOf({
          heading: shot.heading,
          prompt: shot.prompt,
          dialogue: dialogueOfParams(shot.params),
        }),
      })),
    );
    if (fullSrt !== "") {
      await fs.writeFile(path.join(filmsRoot(), `${id}.srt`), fullSrt, "utf8");
    }

    await filmRepository.markDone(id, localPath);
    await appendFilmLog(id, "success", `🎬 影片合成完成：${localPath}`);

    /* 回写闭环（Phase 5 / §6.3 + §7）：从统一项目建的片，合成完成后把逐镜视频与项目进度
     * 回写来源项目 —— 工坊 / 画布据此共读到「哪一镜出片了 / 已出片」。回写失败不影响成片
     * 本身（已 markDone），只记一条 warn。 */
    if (film.projectId !== null) {
      try {
        const finalShots = await filmShotRepository.listByFilm(id);
        await syncFilmToProject(
          film.userId,
          film.projectId,
          finalShots.map((s) => ({
            shotId: s.shotId ?? null,
            videoPath: s.videoPath ?? null,
            status: isFilmShotStatus(s.status) ? s.status : "IDLE",
          })),
        );
      } catch (error) {
        await appendFilmLog(id, "warn", `已合成，但回写项目失败：${errorText(error, "未知错误")}`);
      }
    }
  } catch (error) {
    await filmRepository.markFailed(id, errorMessage(error, "合成失败"));
    await appendFilmLog(id, "error", errorText(error, "合成失败"));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
