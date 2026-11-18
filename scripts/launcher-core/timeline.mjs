/**
 * 启动耗时时间线（ISSUE #4185）：把「启动耗时分解」从三段粗粒度日志行升级成
 * **逐阶段**的结构化读数，回答「启动耗时都花费在了哪里」。
 *
 * 同一份读数进三个出口（写一次，三处同源，不许各自再算一遍）：
 *   · `run/launch-status.json` 的 `timings` 字段 —— 启动页据此画耗时条，
 *     启动过程中就随每次进度快照刷新（等在哪一段，看条形比例即知）；
 *   · `dev-launcher.log` 的「启动耗时分解」一行 —— 成功 / 超时 / 失败路径都打，
 *     排障时不必对着行首时间戳手工做减法（#4137 三段行的逐阶段化后继）；
 *   · `current/run.json` 的 `timings` 字段 —— 随运行包归档进 `log/runs/`，
 *     给「后续优化」留跨运行可比的基线（秒数带出处）。
 *
 * 纯 Node、无平台判据、无模块级状态：编排器每次 `run()` 建一份。
 * 阶段之间允许重叠（后台建表、执行器宿主与就绪等待并行），span 各自独立
 * 记录；「合计」取墙钟（最后一刻 − 最早一刻），不做求和（会重复计并行段）。
 */

/**
 * 单个阶段的耗时读数。
 *
 * @typedef {object} LaunchTimingSpan
 * @property {string} key 阶段键（稳定标识，供测试与对账；展示用 label）
 * @property {string} label 阶段名（中文，直接进日志与启动页）
 * @property {number} startMs 距本次启动起点的偏移（毫秒）
 * @property {number | null} endMs 结束偏移；null = 仍在进行（启动页画「进行中」段）
 * @property {number} durationMs 已用时长（未结束的按「现在」计）
 */

/**
 * 启动时间线句柄（阶段模块经 `ctx.timeline` 拿到的形状）。
 *
 * @typedef {object} LaunchTimeline
 * @property {(key: string, label: string) => void} begin 开始一个阶段
 * @property {(key: string) => void} end 结束一个阶段
 * @property {(key: string, label: string, startMs: number, endMs: number) => void} add
 *   事后推算一段**已完成**的 span（#4365：服务端耗时从 stdout 标记反推）；
 *   同 key 重复追加是 no-op。
 * @property {() => LaunchTimingSpan[]} snapshot 当前读数
 */

/**
 * 建一份启动时间线。
 *
 * @param {number} startedAt 本次启动起点（`Date.now()`，与 launch-status 的
 *   `startedAt` 同一时刻 —— 偏移量口径必须一致，否则启动页两套时间对不上）。
 * @returns {LaunchTimeline}
 */
export function createLaunchTimeline(startedAt) {
  /** @type {LaunchTimingSpan[]} */
  const spans = [];
  return {
    /** 开始一个阶段（同键重复 begin = 记两段，end 收最近那段）。 */
    begin(key, label) {
      spans.push({ key, label, startMs: Date.now() - startedAt, endMs: null, durationMs: 0 });
    },
    /** 结束一个阶段；没有打开中的同键段时是 no-op（早退路径不许它抛错）。 */
    end(key) {
      for (let i = spans.length - 1; i >= 0; i -= 1) {
        const span = spans[i];
        if (span?.key !== key || span.endMs !== null) {
          continue;
        }
        span.endMs = Date.now() - startedAt;
        span.durationMs = Math.max(0, span.endMs - span.startMs);
        return;
      }
    },
    /** 当前读数：结束段给定值，进行中段按「现在」补时长（endMs 仍为 null）。 */
    snapshot() {
      const nowMs = Date.now() - startedAt;
      return spans.map((span) => ({
        key: span.key,
        label: span.label,
        startMs: span.startMs,
        endMs: span.endMs,
        durationMs: span.endMs === null ? Math.max(0, nowMs - span.startMs) : span.durationMs,
      }));
    },
    /**
     * 追加一段**事后推算**的完成段（#4365）：起点/终点是相对启动起点的毫秒偏移。
     * 供「从 dev server 的 stdout 标记反推」的服务端细分使用——Next 进程启动、
     * 首页编译这些时刻不在编排器的 begin/end 调用点上，只能由标记出现的时间与
     * 标记自述的耗时反推。同 key 重复追加是 no-op（监视器每轮都会看到同一批
     * 标记，幂等由这里兜住）。
     */
    add(key, label, startMs, endMs) {
      if (spans.some((span) => span.key === key)) {
        return;
      }
      const start = Math.max(0, startMs);
      const end = Math.max(start, endMs);
      spans.push({ key, label, startMs: start, endMs: end, durationMs: end - start });
    },
  };
}

/** 毫秒 → 人读时长（与 #4137 三段行同一粒度：秒一位小数）。 */
/**
 * @param {number} ms
 * @returns {string}
 */
export function formatSpanDuration(ms) {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

/**
 * 把时间线渲染成一行日志：`启动耗时分解（合计 15.2s）：预检 2.1s · 等待就绪 12.4s`。
 *
 * 「合计」取**墙钟**（最晚结束 − 最早开始），不是各段之和 —— 后台建表 /
 * 执行器宿主与就绪等待并行，求和会重复计数。空时间线返回空串（调用方据此
 * 跳过日志，不产出一行只有标题的空话）。
 *
 * @param {LaunchTimingSpan[]} spans
 * @param {{ nowMs?: number }} [options] nowMs：判定「进行中」段的当下时刻
 *   （相对启动起点的毫秒偏移）；缺省按调用时刻计。
 * @returns {string}
 */
export function formatLaunchTimeline(spans, options = {}) {
  if (!Array.isArray(spans) || spans.length === 0) {
    return "";
  }
  const nowMs = typeof options.nowMs === "number" ? options.nowMs : null;
  const parts = spans.map((span) => `${span.label} ${formatSpanDuration(span.durationMs)}`);
  const lastEnd = spans.reduce(
    (acc, span) => Math.max(acc, span.endMs ?? nowMs ?? span.startMs + span.durationMs),
    0,
  );
  const firstStart = spans.reduce(
    (acc, span) => Math.min(acc, span.startMs),
    Number.POSITIVE_INFINITY,
  );
  const totalMs = Math.max(0, lastEnd - firstStart);
  return `启动耗时分解（合计 ${formatSpanDuration(totalMs)}）：${parts.join(" · ")}`;
}
