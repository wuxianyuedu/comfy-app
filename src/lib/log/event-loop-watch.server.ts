/**
 * `event-loop-watch.server.ts` —— 应用服务进程的事件循环阻塞观测（ISSUE #3369）。
 *
 * ## 为什么要有它
 *
 * 桌面包（standalone）的现场是：应用服务频繁「断开约 20 秒后自行恢复」，进程没死
 * （bootId 不变）、无异常、无慢查询记录——服务端日志里**一个字都没有**，用户与
 * 开发者都无从知道那一刻发生了什么。成因可以是任何一段同步重活（旧版「打包诊断」
 * 的整树复制 + 逐文件同步压缩就是被坐实的一个），而它们在进程外的共同签名只有
 * 一个：**事件循环停走了多久**。
 *
 * 这就是本模块记的那件事。形态是最朴素的心跳漂移检测：`setInterval` 每秒一拍，
 * 每拍算「与上一拍应该相隔多少」——漂移超过阈值即两次心跳之间事件循环被阻塞了
 * 至少那么久。阻塞期间定时器与日志都发不出去，所以记录与日志都发生在**恢复之后**，
 * 带的是估算窗口（起点 = 上一拍时刻 + 一拍，终点 = 恢复后第一拍时刻）。
 *
 * ## 谁消费
 *
 * · pino 一条 warn：进 stdout 转录（`capture-streams.server`）与面板可见日志，
 *   「打包诊断」的 zip 里因此自带这份读数；
 * · `GET /api/dev/loop-blocks`：消息中心在「应用服务已恢复」那一刻读回最近一条，
 *   把恢复消息里「多半是短暂无响应」的猜测换成事实读数（同
 *   `~/lib/shell/app-service-exit` 的「原因只能在恢复后读回」一族）。
 *
 * ## 边界
 *
 * · 它**只**观测本进程（Next 服务）。执行宿主、launcher、壳各自的进程不归它管。
 * · 漂移是**下界**：真实的阻塞可能比漂移更长（心跳可能正好没赶上阻塞的头）。
 *   文案里写「约」与「至少」，不写精确值。
 * · 阈值取 3 秒：探活单拍超时 2.5s、断开确认要连续 2 拍——3 秒以上的阻塞已可能
 *   让用户看到「已断开」；更短的 GC/调度抖动不值得发日志。
 */

import { logger } from "~/lib/core/logger";

/** 心跳间隔。越小对阻塞起点的估算越准，代价是常态空转；1s 足够（读数是秒级）。 */
export const EVENT_LOOP_WATCH_INTERVAL_MS = 1000;

/** 漂移超过这个值才算一次阻塞并记录（理由见文件头「边界」）。 */
export const EVENT_LOOP_BLOCK_REPORT_MS = 3000;

/** 内存里最多留几条：端点只取最近一条，留余量给「恢复后逐条翻看」。 */
export const EVENT_LOOP_BLOCKS_MAX = 20;

/** 一次事件循环阻塞的读数。时刻均为进程内 `Date.now()` 毫秒。 */
export type EventLoopBlock = {
  /** 阻塞时长的下界估计（毫秒）＝ 这一次心跳的漂移。 */
  driftMs: number;
  /** 心跳恢复运行（即观测到阻塞的那一拍）的时刻。 */
  endedAt: number;
  /** 阻塞起点的估算：最后一次按时心跳的时刻 + 一拍。 */
  startedAt: number;
};

let timer: ReturnType<typeof setInterval> | null = null;
let lastBeatAt: number | null = null;
const blocks: EventLoopBlock[] = [];

/** 单拍心跳：算漂移、超阈值则记一条。导出仅为测试可直调（不依赖定时器）。 */
export function eventLoopBeat(now: number): EventLoopBlock | null {
  const previous = lastBeatAt;
  /* 基准先推进再判：记了阻塞的这一拍也是「已经过去的一拍」，不推进的话下一拍的
   * 漂移会从更早的基准起算、把同一次阻塞记成两条。 */
  lastBeatAt = now;
  if (previous !== null) {
    const drift = now - previous - EVENT_LOOP_WATCH_INTERVAL_MS;
    if (drift >= EVENT_LOOP_BLOCK_REPORT_MS) {
      const block: EventLoopBlock = {
        driftMs: drift,
        startedAt: previous + EVENT_LOOP_WATCH_INTERVAL_MS,
        endedAt: now,
      };
      blocks.push(block);
      if (blocks.length > EVENT_LOOP_BLOCKS_MAX) {
        blocks.shift();
      }
      logger.warn(
        {
          driftMs: block.driftMs,
          startedAt: new Date(block.startedAt).toISOString(),
          endedAt: new Date(block.endedAt).toISOString(),
        },
        `[event-loop] 事件循环被阻塞了约 ${Math.round(block.driftMs / 100) / 10}s（起点为估算、时长为下界）——期间所有请求（含探活）都无法处理；恢复调度于 ${block.endedAt}`,
      );
      return block;
    }
  }
  return null;
}

/** 启动心跳（幂等：instrumentation 可能与 route 各触发一次，也防热重载重复挂）。 */
export function startEventLoopWatch(): void {
  if (timer !== null) {
    return;
  }
  lastBeatAt = Date.now();
  timer = setInterval(() => {
    eventLoopBeat(Date.now());
  }, EVENT_LOOP_WATCH_INTERVAL_MS);
  /* 不持有事件循环：观测器自己不该阻止进程退出（回收路径不因它多等一拍）。 */
  timer.unref?.();
  logger.info(
    `[event-loop] 阻塞观测已启动（间隔 ${EVENT_LOOP_WATCH_INTERVAL_MS}ms，阈值 ${EVENT_LOOP_BLOCK_REPORT_MS}ms）`,
  );
}

/** 最近几次阻塞记录（时间序副本；端点与测试用）。 */
export function latestEventLoopBlocks(): EventLoopBlock[] {
  return [...blocks];
}

/** 观测是否在跑（route 的「没启动」档：dev 懒编译窗口里 instrumentation 还没跑）。 */
export function eventLoopWatchRunning(): boolean {
  return timer !== null;
}

/** 测试隔离：清掉定时器与全部状态。生产代码不得调用。 */
export function resetEventLoopWatchForTests(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  lastBeatAt = null;
  blocks.length = 0;
}
