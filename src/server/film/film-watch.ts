// ── 成片监看（#4595 拆分自 orchestrator.ts，文件行数硬闸）──────────
// 职责：GENERATING 影片的无响应看门狗轮询、超时收口（撤在飞任务 + 落失败）、
// 进程重启后的恢复扫描。方向单向：本模块 → compose-film / film-log / 仓储；
// orchestrator 只 import watchFilm 并原样再导出 resumeStalledFilms（外部导入路径不变）。
import "server-only";
import { db } from "~/lib/db";
import { filmRepository, filmShotRepository, taskRepository } from "~/lib/core/repository";
import { logger } from "~/lib/core/logger";
import { isSchemaReady } from "~/lib/db-schema-ready";
import { cancelTask } from "~/lib/comfyui/enqueue";
import { sleep } from "~/lib/with-timeout";
import { errorText } from "~/lib/error-message";
import { asRecord } from "~/lib/is-record";
import type { ShotStatus } from "~/lib/film/film-status";
import { appendFilmLog } from "./film-log";
import { composeFilm } from "./compose-film";

function isResultImages(v: unknown): v is Array<{ localPath?: string; mediaType?: unknown }> {
  return Array.isArray(v);
}

// ── watch + update ──────────────────────────────────────────
/* 监看循环的预算常量。写在一起是因为**给用户看的预算文案必须与判据同源**。
 * 旧口径是「240 轮固定总预算（16 分钟）」，与镜头数无关——本地串行队列下
 * 多镜头的正常生成必被误判「生成超时」，且超时只改影片状态、不撤在飞任务
 * （#4595）。新口径两档：
 * · **无响应看门狗**：连续 WATCH_IDLE_MAX_ITER 轮「镜头状态分布与进度总和
 *   零变化」才判超时——健康的长任务每拍都有进展，不会被这把尺误伤；
 * · **绝对上限**：底仓 + 每镜一档，兜「进度在两档间抖动」这类永不静止的
 *   病态循环，保证收口必然到达。 */
const WATCH_POLL_MS = 4000;
const WATCH_IDLE_MAX_ITER = 900;
const WATCH_BASE_MAX_ITER = 240;
const WATCH_PER_SHOT_ITER = 600;
const WATCH_IDLE_MIN = Math.round((WATCH_POLL_MS * WATCH_IDLE_MAX_ITER) / 60_000);

/** 超时收口（#4595）：与 cancelFilm 同款的补偿——先逐个撤在飞任务，再同一事务
 * 把活跃镜头与影片都落失败。原先只 markFailed 影片：在飞任务继续占住唯一执行槽
 * （期间全应用一切生成排队）、镜头行永远停在 QUEUED/RUNNING，而 startFilm 只领
 * IDLE 镜头 ⇒ 用户连重跑的入口都没有。 */
async function timeoutFinish(id: string, detail: string): Promise<void> {
  const active = await filmShotRepository.listActiveWithTask(id);
  for (const s of active) {
    if (s.taskId !== null && s.taskId !== "") {
      // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：逐个撤，单个失败不拦收口
      await cancelTask(s.taskId).catch((cancelError: unknown) => {
        /* 补偿取消失败要看得见（范式同 #4254 / #4269）：任务仍会在 ComfyUI 侧执行。 */
        logger.warn(
          `[film] 超时收口取消任务失败（task=${s.taskId}）：${errorText(cancelError, "补偿取消失败")}`,
        );
      });
    }
  }
  await db.transaction(
    async (tx) => {
      await filmShotRepository.markAllActiveFailed(id, tx);
      await filmRepository.markFailed(id, detail, tx);
    },
    { behavior: "immediate" },
  );
  await appendFilmLog(
    id,
    "error",
    `${detail}。在飞任务已撤、未完成镜头已落失败：到影片详情再点「开始生成」，只重跑没完成的镜头。`,
  );
}

/* **监看在飞表**（跨模块实例）：`watchFilm` 是被 `void` 起的常驻循环，dev 热重启不杀旧 promise 链，
 * 新实例又会被 boot 扫描起一条 ⇒ 同一部影片两个监看同时写进度、都调 `composeFilm`（`markComposing`
 * 无条件写）⇒ 被 ffmpeg 合成两次。所以必须放在跨 HMR 仍活着的地方。键名带版本号是既定的坑：`??=`
 * 只认键名，不会给旧单例补字段（同 `runner-state`）。 */
declare global {
  var filmWatchInFlight_v1: Map<string, Promise<void>> | undefined;
}

function inFlightFilms(): Map<string, Promise<void>> {
  globalThis.filmWatchInFlight_v1 ??= new Map<string, Promise<void>>();
  return globalThis.filmWatchInFlight_v1;
}

/** 监看一部影片直到出片 / 判失败；同一部影片在本进程内**至多一条**循环。
 *
 *  「取消后立刻重新开始」的交接（ISSUE #3867）：旧循环要等下一拍轮询才发现
 *  CANCELLED 退场，此时新 startFilm 的监看若直接早退，旧循环退场后就**没有
 *  任何人**在监看这部重新置为 GENERATING 的影片——进度永停、不合成也不判
 *  失败，只能等进程重启被恢复扫描捡回。改为「等旧循环退场 → 重读状态 →
 *  仍 GENERATING 才起新循环」的交接语义。 */
export async function watchFilm(id: string, opts: { resumed?: boolean } = {}): Promise<void> {
  const inFlight = inFlightFilms();
  const previous = inFlight.get(id);
  if (previous) {
    await previous.catch(() => undefined);
    /* 交接重读失败（DB 撞锁等）只让位退场，不把 rejection 冒给调用点（#4220）：
     * 本条循环不起最坏也只是影片停在 GENERATING，boot 恢复扫描会接回；
     * 让 rejection 打崩进程的代价不成比例。 */
    try {
      const film = await filmRepository.findById(id);
      if (film?.status !== "GENERATING") {
        return;
      }
    } catch (error) {
      logger.warn(`[film] ${errorText(error, "监看交接重读失败，本条循环让位")}`);
      return;
    }
  }
  if (inFlightFilms().has(id)) {
    /* 等旧循环退场期间，别的调用方已经起新循环：让位。 */
    return;
  }
  const loop = watchLoop(id, opts)
    .catch(async (error: unknown) => {
      /* 监看循环的任何 rejection 都就地收口（ISSUE #4216）：这是 `void` 起的
       * 常驻后台链，冒出去就是 unhandledRejection（进程级事故，#4146 那类
       * 「服务莫名断开」的又一来源）。失败要让用户看见：影片日志记 error、
       * 影片判 FAILED（不留 GENERATING 假活）。收口自身可能正踩在故障路径上
       * （DB BUSY / 磁盘），再各兜一层，不让收口自己变成新的漏网口。 */
      const detail = errorText(error, "成片监看循环异常终止");
      logger.error(`[film] 监看循环异常终止（film=${id}）：${detail}`);
      try {
        await appendFilmLog(id, "error", `监看循环异常终止：${detail}`);
      } catch {
        /* 日志路径本身失败时不再冒泡 */
      }
      try {
        await filmRepository.markFailed(id, detail);
      } catch {
        /* 同上 */
      }
    })
    .finally(() => {
      if (inFlightFilms().get(id) === loop) {
        inFlightFilms().delete(id);
      }
    });
  inFlightFilms().set(id, loop);
  return loop;
}

async function watchLoop(id: string, opts: { resumed?: boolean }) {
  if (opts.resumed === true) {
    /* 续跑要在行日志里留痕：否则用户看到的是「重启之后它自己动起来了」，
     * 而支持现场需要据这一行判断「是 boot 扫描接上的，还是原循环还活着」。 */
    await appendFilmLog(id, "info", `进程重启后续跑监看（无进展 ${WATCH_IDLE_MIN} 分钟判超时）`);
  }
  /* 绝对上限在首轮拿到镜头数后补足（底仓 + 每镜一档）；无响应看门狗从
   * 第二轮起判（首轮是基线，lastSnapshot 为 null 恒不等 ⇒ 先归零）。 */
  let maxIter = WATCH_BASE_MAX_ITER;
  let idleIter = 0;
  let lastSnapshot: string | null = null;
  for (let i = 0; i < maxIter; i++) {
    // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
    const film = await filmRepository.findById(id);
    if (!film || film.status === "CANCELLED" || film.status === "FAILED") {
      return;
    }
    if (film.status !== "GENERATING") {
      // 已经走掉了（例如合成已开始）
    }

    // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
    const shots = await filmShotRepository.listByFilm(id);
    /* 一行镜头都没有的 GENERATING 只可能是「`markGenerating` 之后、逐镜提交之前」
     * 崩在这里。这条状态在本刀之前不可达（监看只由 `startFilm` 起，那时 shots 必然
     * 非空），而 boot 续跑扫描会把它捡起来 —— 不判掉就是 `0/0` 的 NaN 进度，
     * 然后带着一条空时间线去合成。 */
    if (!shots.length) {
      // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
      await filmRepository.markFailed(id, "没有可继续的镜头");
      // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
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
    /* 在跑镜头的进度总和：看门狗的快照成分——单镜长渲染时 done/failed/pending
     * 可以几十分钟不变，进度总和仍在动（#4595 的「健康长任务不误判」就靠它）。 */
    let progressSum = 0;

    /* 先把「不用再问数据库」的镜头结清（没有 taskId 的、已终态的），剩下的
     * **一次性**批量取进度：原先是逐镜头 `await findExecutionProgress`，一轮
     * 就是 2N 次往返（N = 镜头数），跑满 240 轮是上万次查询。 */
    const awaiting: Array<(typeof shots)[number]> = [];
    for (const shot of shots) {
      /* **先判终态、再判 taskId**，顺序是判据：原先是 `if (!shot.taskId) { pending++; continue }` 打头，
       * 于是「已终态但没有任务」的镜头被数成还在等 —— 那种行真实存在（提交 catch 落的 `markFailed`
       * 无 taskId、重跑也带已完成旧镜头）。后果是**永不收口**：pending 恒非 0 ⇒ 不合成也不判失败，
       * 轮询到预算耗尽才落「生成超时」（实测一个 SUCCEEDED 无 taskId 就让影片停在 progress 50）。 */
      if (shot.status === "SUCCEEDED" || shot.status === "FAILED") {
        if (shot.status === "SUCCEEDED") {
          done++;
        } else {
          failed++;
        }
        continue;
      }
      if (shot.taskId === null || shot.taskId === "") {
        pending++;
        continue;
      }
      awaiting.push(shot);
    }

    const taskIds: Array<string> = [];
    for (const shot of awaiting) {
      if (shot.taskId !== null && shot.taskId !== "") {
        taskIds.push(shot.taskId);
      }
    }
    const progressById = new Map(
      // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
      (await taskRepository.findExecutionProgressMany(taskIds)).map(
        /* SAFETY: 类型断言已复核 */
        (row) => [row.id, row] as const,
      ),
    );

    for (const shot of awaiting) {
      const task =
        shot.taskId !== null && shot.taskId !== "" ? progressById.get(shot.taskId) : undefined;
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
        const imgs = isResultImages(task.resultImages) ? task.resultImages : [];

        const vid = imgs.find((img) => img.mediaType === "video") ?? imgs[0];

        videoPath = vid?.localPath;

        // 同 generateVideoShot：params 当成宽松对象读，帧数/fps 逐字段 typeof 校验。
        const params: Record<string, unknown> = asRecord(shot.params ?? {}) ?? {};

        const frames = typeof params.frames === "number" ? params.frames : 49;
        const fps = typeof params.fps === "number" ? params.fps : 16;
        duration = typeof params.duration === "number" ? params.duration : frames / fps;
      }

      /* 只在真的变了才写：原先每轮对每个在跑的镜头都无条件 UPDATE，绝大多数
       * 轮次写进去的是与库里一模一样的值。 */
      const nextProgress = task.progress;
      progressSum += nextProgress;
      if (shot.status !== next || shot.progress !== nextProgress) {
        // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
        await filmShotRepository.updateFromTask(shot.id, {
          status: next,
          progress: nextProgress,
          videoPath: videoPath ?? undefined,
          duration: duration ?? null,
        });
      }
      if (next === "SUCCEEDED") {
        done++;
      } else if (next === "FAILED") {
        failed++;
      } else {
        pending++;
      }
    }

    const total = shots.length;
    const progress = Math.round(((done + failed) / total) * 100);
    /* 续写/收口前重读影片状态（ISSUE #3867）：拍首读到的还不是 CANCELLED，
     * 用户可能在取进度期间点了取消——取消是用户终态，不再续写进度、
     * 也不进入判失败/合成那一段。 */
    // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：收口动作前必须拿到最新状态
    const current = await filmRepository.findById(id);
    const status = current?.status;
    if (status === undefined || status === "CANCELLED" || status === "FAILED") {
      return;
    }
    // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
    await filmRepository.updateProgress(id, progress);

    if (pending === 0) {
      if (failed > 0 && done === 0) {
        // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
        await filmRepository.markFailed(id, `${failed} 个镜头生成失败`);
        // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
        await appendFilmLog(id, "error", `影片生成失败：${failed} 个镜头失败`);
        return;
      }
      // 成功（或部分成功）→ 合成
      // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
      await composeFilm(id);
      return;
    }
    /* 看门狗（#4595）：状态分布与进度总和连续 WATCH_IDLE_MAX_ITER 轮零变化
     * = 执行链没有任何进展，判超时并撤在飞任务；绝对上限在首轮按镜头数补足。 */
    const snapshot = `${done}/${failed}/${pending}/${progressSum}`;
    if (i === 0) {
      maxIter = WATCH_BASE_MAX_ITER + total * WATCH_PER_SHOT_ITER;
    } else if (snapshot === lastSnapshot) {
      idleIter += 1;
      if (idleIter >= WATCH_IDLE_MAX_ITER) {
        // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：收口必须在退场前完成（与既有串行路径同口径）
        await timeoutFinish(id, `生成超时：连续 ${WATCH_IDLE_MIN} 分钟没有任何进展`);
        return;
      }
    } else {
      idleIter = 0;
    }
    lastSnapshot = snapshot;
    // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
    await sleep(WATCH_POLL_MS);
  }
  await timeoutFinish(
    id,
    `生成超时：监看达到绝对上限（约 ${Math.round((maxIter * WATCH_POLL_MS) / 60_000)} 分钟）`,
  );
}

/**
 * 进程重启后的恢复扫描：把丢了监看主体的影片接回去（P3 §5 ADR 的 5-A）。`startFilm` 末尾的
 * `watchFilm` 起的循环只活在**当前进程**，dev 热重启与桌包重启都会让它消失 —— 而任务还在库里由执行侧
 * 推进（宿主不跟 Next 一起死，ADR §14 D1）。没人监看 ⇒ 影片永远停在 `GENERATING`；返回值只给日志与用例。
 */
export async function resumeStalledFilms(): Promise<{
  abandoned: Array<string>;
  resumed: Array<string>;
}> {
  /* 表还没建就整轮跳过，与回收器同一口径（`sweepOnce` 也判这条）：哨兵表是 `task`，首启一次应用整套
   * DDL ⇒ `task` 在时 `filmProject` 也在。「表在、查询失败」不在这里吞，走下面的 catch、Warn 但仍不炸
   * 启动。这条扫描是**一次性**的，跳过了要等下次重启才有人接片，所以必须留痕，否则现场只看到影片停在生成中。 */
  if (!isSchemaReady()) {
    logger.info("[film] 重启恢复扫描跳过（表还没建就绪）");
    return { resumed: [], abandoned: [] };
  }

  const resumed: Array<string> = [];
  const abandoned: Array<string> = [];

  try {
    for (const film of await filmRepository.listByStatus(["GENERATING"])) {
      /* 本进程已有循环在跑（HMR 之后旧循环还活着）就不再起第二条 ——
       * 判据与 `watchFilm` 内部那道是同一份在飞表，两处各自判就会漂开。 */
      if (inFlightFilms().has(film.id)) {
        continue;
      }
      resumed.push(film.id);
      void watchFilm(film.id, { resumed: true });
    }

    /* COMPOSING **不**续跑，直接判掉。`composeFilm` 一见到 COMPOSING 就早退
     * （`status === "COMPOSING" || "DONE"` 那条），而它是**无条件**写进去的状态，
     * 于是崩在合成中的影片连界面上「重新合成」这个唯一出口都被自己挡住 ——
     * 判成 FAILED 才把出口接回来（FAILED 是 `composeFilm` 允许重跑的状态），
     * 而不是开机时静默重跑 ffmpeg（用户没要求却开始占 CPU 写文件）。 */
    for (const film of await filmRepository.listByStatus(["COMPOSING"])) {
      // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
      await filmRepository.markFailed(film.id, "合成中断（进程在合成期间退出）");
      // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
      await appendFilmLog(
        film.id,
        "error",
        "合成在进程重启时被打断，已判失败。镜头视频仍在，点「重新合成」可再来一次（需要本机装有 ffmpeg）。",
      );
      abandoned.push(film.id);
    }
  } catch (error) {
    logger.warn(`[film] ${errorText(error, "resumeStalledFilms 失败（重启恢复扫描）")}`);
  }

  if (resumed.length || abandoned.length) {
    logger.info(
      `[film] 重启恢复扫描：续跑监看 ${resumed.length} 部，合成中断判失败 ${abandoned.length} 部`,
    );
  }
  return { resumed, abandoned };
}
