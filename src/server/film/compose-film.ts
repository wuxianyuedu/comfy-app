/**
 * `compose-film.ts` —— 服务端出片那半段：ffmpeg 探测 / 执行 / 合成 / 回写统一项目
 * （ISSUE #1257 从 `orchestrator.ts` 下沉出来：那个文件已经涨到越过规范 §12.6 的文件行数上限，拆法是「把出片那半段整块搬走」）。
 *
 * 为什么是「合成 + 回写」一起搬：`syncFilmToProject` 只被 `composeFilm` 调（合成完成
 * 才谈得上回写）。只搬 `composeFilm` 而把回写留在编排侧，新模块就要反向 import
 * `./orchestrator`，而编排要 import 合成 —— 直接成环。这条坑在 issue 里记着，别再试。
 *
 * 方向因此是单向的一条链：`orchestrator`（剧本 → 分镜 → 建片 → 逐镜 → 监看）
 * → `compose-film`（出片 + 回写）→ `film-log` / `compose-steps`（两侧共用的叶子）。
 */
import "server-only";

import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { filmRepository, filmShotRepository } from "~/lib/core/repository";
import { productionRepository } from "~/lib/core/repository-production";
import { normalizeProductionProgress } from "~/lib/production/progress";
import type { Shot } from "~/lib/workshop/types";
import { sizeSpecDims, toSizeSpec } from "~/lib/media/size-presets";
import { errorMessage, errorText } from "~/lib/error-message";
import { withTimeoutResult } from "~/lib/with-timeout";
import { INLINE_SNIPPET_MAX, clampText } from "~/lib/text-clamp";
import type { ShotStatus } from "~/lib/film/film-status";
import {
  buildNormalizeArgs,
  buildSegmentVf,
  buildSrtBody,
  clipPathOf,
} from "./compose-steps";
import { appendFilmLog } from "./film-log";

// ── 回写：成片合成完成 → 统一项目逐镜 clip + 完成状态（Phase 5 / §6.3 + §7）──
/** 合成成片里一个镜头的结果（用于把逐镜视频回写进统一项目的对应 Shot）。 */
export interface FilmShotClip {
  /** 关联的统一镜头 id（production.shots[].id）；自由建片的镜头为 null（跳过）。 */
  shotId: string | null;
  videoPath: string | null;
  status: ShotStatus;
}

/** 把「从项目建的片」合成完成后的结果，回写进来源统一项目：
 *   1) 逐镜视频 —— 按 `shotId` 命中 `production.shots` 里的对应 Shot，写入 clipUrl / clipStatus；
 *   2) 完成状态 —— `progress` 读-改-写：`rendered=true`、阶段推进到 `render`，其余字段原样保留。
 *  一次读-改-写完成（progress 与 shots 是同一行的两列，分两次写会互相覆盖，故合并）。
 *  仅对 `filmProject.projectId` 非空（走统一项目建片）生效。 */
export async function syncFilmToProject(
  userId: string,
  projectId: string,
  filmShots: FilmShotClip[],
): Promise<void> {
  const row = await productionRepository.getForUser(userId, projectId);
  if (!row) return;
  const progress = normalizeProductionProgress(row.progress);
  const rawShots = Array.isArray(row.shots) ? (row.shots as Shot[]) : [];

  // 按 shotId 索引成片结果（只取有 videoPath 的镜头回写 clip）。
  const clipByShotId = new Map<string, FilmShotClip>();
  for (const fs of filmShots) {
    if (fs.shotId && fs.videoPath) clipByShotId.set(fs.shotId, fs);
  }

  const nextShots: Shot[] = rawShots.map((shot) => {
    const clip = clipByShotId.get(shot.id);
    if (!clip) return shot;
    return {
      ...shot,
      clipUrl: clip.videoPath ?? undefined,
      clipStatus: "done",
    };
  });

  await productionRepository.upsertForUser(userId, {
    id: row.id,
    title: row.title,
    type: row.type,
    tone: row.tone,
    logline: row.logline,
    scriptMarkdown: row.scriptMarkdown,
    scenes: row.scenes,
    characters: row.characters,
    shots: nextShots,
    progress: { ...progress, stage: "render", rendered: true },
  });
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
    for (const [i, shot] of shots.entries()) {
      const { videoPath } = shot;
      if (!videoPath) {
        // 镜头未出片（videoPath 为空）是真实故障，不是可静默跳过的分支：
        // 抛明确文案，交给外层 catch 落 markFailed + 面板日志（硬规则 4），
        // 不再用 `shot.videoPath!` 让脏数据在 path.join 里崩成栈噪声。
        throw new Error(`镜头 ${i + 1} 缺少视频文件，无法合成`);
      }
      const clip = clipPathOf(cwd, videoPath);
      const segOut = path.join(tmpDir, `seg_${i}.mp4`);
      const dur = shot.duration ?? film.framesPerShot / fps;
      const fadeOut = Math.max(0, dur - 0.3);
      const vf = buildSegmentVf({ width: W, height: H, fps, fadeOut });

      const srtPath = path.join(tmpDir, `seg_${i}.srt`);
      if (film.subtitleOn) {
        // 空串标题也要回落到 prompt（|| 语义），沿用既有行为。
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        const srtText = (shot.heading || shot.prompt).slice(0, 80);
        await fs.writeFile(
          srtPath,
          buildSrtBody({ text: srtText, dur }),
          "utf-8",
        );
      }

      const tryWithSub = film.subtitleOn;
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
        await appendFilmLog(
          id,
          "warn",
          `镜头 ${i + 1} 字幕烧录失败，重试（无字幕）`,
        );
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

    /* 回写闭环（Phase 5 / §6.3 + §7）：从统一项目建的片，合成完成后把逐镜视频与项目进度
     * 回写来源项目 —— 工坊 / 画布据此共读到「哪一镜出片了 / 已出片」。回写失败不影响成片
     * 本身（已 markDone），只记一条 warn。 */
    if (film.projectId) {
      try {
        const finalShots = await filmShotRepository.listByFilm(id);
        await syncFilmToProject(
          film.userId,
          film.projectId,
          finalShots.map((s) => ({
            shotId: s.shotId ?? null,
            videoPath: s.videoPath ?? null,
            status: s.status as ShotStatus,
          })),
        );
      } catch (e) {
        await appendFilmLog(
          id,
          "warn",
          `已合成，但回写项目失败：${errorText(e, "未知错误")}`,
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
