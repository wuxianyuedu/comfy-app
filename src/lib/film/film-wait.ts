/**
 * 成片等待预算的唯一口径（ISSUE #5142）。
 *
 * 监看侧按「底仓 + 每镜一档」估一部片子最多跑多久；自主 run 的等待方此前写死
 * 300 拍（20 分钟），多镜头片子还在正常生成时就先被判超时。两侧必须用同一份
 * 换算，慢的那一侧才不会先放弃。
 */

/** 两处共用的每拍间隔（毫秒）。 */
export const FILM_WATCH_TICK_MS = 4000;

/** 底仓拍数（无镜头时的兜底预算）。 */
export const FILM_WATCH_BASE_MAX_ITER = 240;

/** 每多一个镜头追加的拍数。 */
export const FILM_WATCH_PER_SHOT_ITER = 600;

/** 一部 N 镜片子的等待拍数：底仓 + 每镜一档。 */
export function filmWaitTicksFor(shotCount: number): number {
  const count = Number.isFinite(shotCount) ? Math.max(0, Math.floor(shotCount)) : 0;
  return FILM_WATCH_BASE_MAX_ITER + count * FILM_WATCH_PER_SHOT_ITER;
}
