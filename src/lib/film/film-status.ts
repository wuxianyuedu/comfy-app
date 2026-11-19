/**
 * `film-status.ts` —— 成片与镜头的状态族（一份定义，两侧共用）。
 *
 * 为什么在 `src/lib` 而不是 `src/server/film`：这两条联合类型**两侧都要**——
 * 服务端编排（`src/server/film/**`：建片 / 逐镜提交 / 监看 / 合成回写）与视图层
 * （`src/components/studio/film-studio-config.ts` 的状态徽标与阶段文案）。
 * `lib` 是被 `components` / `app` / `server` 共同依赖的地基，方向是单向的；
 * 放进 `server` 就会让视图层为了一个类型去引服务端（`eslint boundaries` 拦的就是这个）。
 *
 * 这一格原本有**两份逐字相同的定义**（§12.12 的形态：一处改状态族、另一处静默落后，
 * 而 TS 只比结构不比名字，两边都是同一组字面量时连编译期都不会报警）。
 * 现在两侧都 import 这一份。
 */

/** 成片状态。`COMPOSING` 是「ffmpeg 正在出片」那一格（服务端合成，不是客户端时间线）。 */
export type FilmStatus = "PARSING" | "GENERATING" | "COMPOSING" | "DONE" | "FAILED" | "CANCELLED";

/** 单个镜头的状态。`IDLE` 与「提交前就崩的 QUEUED」都算「还没有人在跑它」。 */
export const FILM_SHOT_STATUSES = ["IDLE", "QUEUED", "RUNNING", "SUCCEEDED", "FAILED"] as const;
export type ShotStatus = (typeof FILM_SHOT_STATUSES)[number];

/**
 * DB `status` 文本列是外来值：只认词表内的状态，脏值由调用点按 schema 默认
 * `IDLE` 回落（B5 子批 23 起替掉读侧的盲断言，词表与类型保持同源）。
 */
export function isFilmShotStatus(v: unknown): v is ShotStatus {
  return typeof v === "string" && (FILM_SHOT_STATUSES as ReadonlyArray<string>).includes(v);
}
