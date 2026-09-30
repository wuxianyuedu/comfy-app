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
export type FilmStatus =
  "PARSING" | "GENERATING" | "COMPOSING" | "DONE" | "FAILED" | "CANCELLED";

/** 单个镜头的状态。`IDLE` 与「提交前就崩的 QUEUED」都算「还没有人在跑它」。 */
export type ShotStatus = "IDLE" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
