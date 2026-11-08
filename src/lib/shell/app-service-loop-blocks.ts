/* ── 「最近一次事件循环阻塞」的读回（ISSUE #3369）──
 *
 * 与 `~/lib/shell/app-service-exit` 同一族的事实：探活走的是应用服务自己的 HTTP，
 * 服务无响应期间谁也问不到，**读回只能发生在恢复应答之后**。数据由进程内的心跳
 * 观测（`~/lib/log/event-loop-watch.server`）记着，`GET /api/dev/loop-blocks` 读出。
 *
 * 消费方是 `use-app-service-message-log`：恢复那条消息在「服务已可应答」之后读一次，
 * 拿到与本次断开窗口重叠的阻塞记录，就把「多半是短暂无响应」的猜测换成事实读数。
 */

import { isPlainRecord } from "~/lib/is-record";

export const LOOP_BLOCKS_ENDPOINT = "/api/dev/loop-blocks";

/** 一次阻塞读数（与服务端 `EventLoopBlock` 同形，字段收紧到消费方用的三个）。 */
export type AppServiceLoopBlock = {
  /** 阻塞时长的下界估计（毫秒）。 */
  driftMs: number;
  /** 阻塞起点的估算。 */
  startedAt: number;
  /** 心跳恢复运行（观测到阻塞的那一拍）的时刻。 */
  endedAt: number;
};

function parseBlock(value: unknown): AppServiceLoopBlock | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  const { driftMs, startedAt, endedAt } = value;
  return typeof driftMs === "number" &&
    Number.isFinite(driftMs) &&
    typeof startedAt === "number" &&
    Number.isFinite(startedAt) &&
    typeof endedAt === "number" &&
    Number.isFinite(endedAt)
    ? { driftMs, startedAt, endedAt }
    : null;
}

/**
 * 读最近几次阻塞记录，取**与断开窗口重叠**的最近一条；没有则 null。
 *
 * 全程不抛（`fetchAppServiceExit` 同纪律）：这一刻刚出过一次故障，任何异常都只会
 * 让现场更难查。窗口重叠判据：阻塞的 `[startedAt, endedAt]` 与断开的
 * `[offlineAt, recoveredAt]` 有交集——不重叠的阻塞（更早发生的、或恢复之后才记的）
 * 解释不了这次断开，不往消息里塞。
 */
export async function fetchLoopBlockForOffline(
  offlineAt: number,
  recoveredAt: number,
): Promise<AppServiceLoopBlock | null> {
  try {
    const res = await fetch(LOOP_BLOCKS_ENDPOINT, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) {
      return null;
    }
    const payload: unknown = await res.json();
    if (!isPlainRecord(payload) || !Array.isArray(payload.blocks)) {
      return null;
    }
    /* 倒着找最近的一条：服务端按时间序 append。 */
    for (let i = payload.blocks.length - 1; i >= 0; i--) {
      const block = parseBlock(payload.blocks[i]);
      if (block !== null && block.endedAt >= offlineAt && block.startedAt <= recoveredAt) {
        return block;
      }
    }
    return null;
  } catch {
    return null;
  }
}
