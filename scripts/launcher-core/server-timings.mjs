/**
 * server-timings — 服务端（Next dev server）的**耗时细分**（#4365）。
 *
 * 「等待服务就绪」此前是一段黑盒：Next 进程启动、健康探针编译各占多少，编排器
 * 不知道——dev server 的 stdout 被直接重定向成文件描述符（无 pipe、无 tee，
 * 规范 launch-and-build.md §4.5.1），编排器看不到行。但编排器**握着这份落盘
 * 文件**：本模块按增量扫描它的尾部，从两类标记反推服务端耗时并补进启动时间线：
 *   · `✓ Ready in <n>` → 「服务进程启动」（dev 拉起 → Next 就绪）；
 *   · `GET /workspace 200 in <t>` → 「首页编译」（该请求的编译+渲染耗时，
 *     发生在就绪之后，此前不在分解里）。
 *
 * 扫描是**增量**的（记住已扫到的字节偏移，只读新增的尾部，带 1KB 重叠防标记
 * 被切在边界上漏扫）；同一标记重复扫描由 timeline.add 的同 key no-op 兜住。
 * 纯 Node、无 React；轮询每 2s 一轮、总预算 5 分钟，两个标记都落地即停。
 */

import { closeSync, openSync, readSync, statSync } from "node:fs";

/**
 * 从 dev server 的 stdout 文本里提取服务端耗时标记。
 * 时间单位两种形态都收（Next 对快请求打 `ms`、慢请求打 `s`），统一成毫秒。
 *
 * @param {string} text 新增的 stdout 内容（增量，可含多轮输出）
 * @returns {{ readyMs: number | null, firstPageMs: number | null }}
 *   `readyMs` = Next 自报的启动耗时；`firstPageMs` = 首个 /workspace 请求的
 *   编译+渲染耗时；没扫到就是 null。
 */
export function scanServerMarkers(text) {
  const ready = text.match(/✓\s*Ready in (?<value>\d+(?:\.\d+)?)(?<unit>ms|s)/);
  const page = text.match(/GET \/workspace 200 in (?<value>\d+(?:\.\d+)?)(?<unit>ms|s)/);
  const toMs = (value, unit) => (unit === "s" ? Math.round(Number(value) * 1000) : Number(value));
  return {
    readyMs: ready ? toMs(ready.groups.value, ready.groups.unit) : null,
    firstPageMs: page ? toMs(page.groups.value, page.groups.unit) : null,
  };
}

/**
 * 构造「读文件新增尾部」的注入件：返回 `readNew(fromOffset)` → `{ text, endOffset }`。
 * 带 1KB 重叠（标记可能恰好骑在上次扫描的边界上）；文件不存在 / 没新增时返回空文本、
 * 偏移原样带回。
 *
 * @param {string} filePath dev server stdout 落盘文件
 */
export function makeFileTailReader(filePath) {
  return function readNew(fromOffset) {
    let size;
    try {
      size = statSync(filePath).size;
    } catch {
      return { text: "", endOffset: fromOffset };
    }
    if (size <= fromOffset) {
      return { text: "", endOffset: fromOffset };
    }
    const start = Math.max(0, fromOffset - 1024);
    const buffer = Buffer.alloc(size - start);
    const fd = openSync(filePath, "r");
    try {
      readSync(fd, buffer, 0, buffer.length, start);
    } finally {
      closeSync(fd);
    }
    return { text: buffer.toString("utf8"), endOffset: size };
  };
}

/**
 * 服务端耗时的**监视器**：每轮从 `readNew` 取新增 stdout、扫标记、把反推出的
 * 两段补进 `timeline` 并经 `refreshStatus` 刷新进度快照（启动页耗时条与应用内
 * 卡片随即可见）。两个标记都落地、dev 退出或预算（默认 5 分钟）用尽即停。
 *
 * @param {object} deps
 * @param {{ add: (key: string, label: string, startMs: number, endMs: number) => void }} deps.timeline
 * @param {() => void} deps.refreshStatus 重写 launch-status 快照（timings 已变化）
 * @param {(fromOffset: number) => { text: string, endOffset: number }} deps.readNew
 * @param {() => number} deps.now 时钟（测试注入）
 * @param {number} deps.startedAt 本次启动起点（`Date.now()`，偏移量口径）
 * @param {() => boolean} [deps.devExited] dev server 是否已退出
 * @param {number} [deps.intervalMs] 轮询间隔
 * @param {number} [deps.budgetMs] 总预算
 * @returns {{ start: () => void, stop: () => void, tick: () => void }}
 */
export function createServerTimingWatcher(deps) {
  const {
    timeline,
    refreshStatus,
    readNew,
    now,
    startedAt,
    devExited = () => false,
    intervalMs = 2000,
    budgetMs = 300_000,
  } = deps;
  let readyRecorded = false;
  let firstPageRecorded = false;
  let scannedUpTo = 0;
  let handle = null;

  const stop = () => {
    if (handle !== null) {
      clearInterval(handle);
      handle = null;
    }
  };

  const tick = () => {
    if ((readyRecorded && firstPageRecorded) || devExited()) {
      stop();
      return;
    }
    if (now() - startedAt > budgetMs) {
      stop();
      return;
    }
    const { text, endOffset } = readNew(scannedUpTo);
    if (endOffset <= scannedUpTo) {
      return;
    }
    scannedUpTo = endOffset;
    const markers = scanServerMarkers(text);
    const nowOffset = now() - startedAt;
    if (!readyRecorded && markers.readyMs !== null) {
      readyRecorded = true;
      timeline.add("next-boot", "服务进程启动", nowOffset - markers.readyMs, nowOffset);
      refreshStatus();
    }
    if (!firstPageRecorded && markers.firstPageMs !== null) {
      firstPageRecorded = true;
      timeline.add("first-page", "首页编译", nowOffset - markers.firstPageMs, nowOffset);
      refreshStatus();
    }
  };

  return {
    /** 立即扫一轮（Ready 标记多半已经躺在文件里），随后按间隔跟进。 */
    start() {
      if (handle !== null) {
        return;
      }
      handle = setInterval(tick, intervalMs);
      tick();
    },
    stop,
    tick,
  };
}
