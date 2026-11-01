// ── 日志面板 store 的性能探针（tools/measure-log-store.ts）────────────────
//
// 用法：pnpm exec tsx tools/measure-log-store.ts [--runs N]
//
// 为什么需要它：日志面板每 2s 轮询六路日志文件，每一路回来都走一次
// `appendFileLogs`——而它内部是**若干层 O(时间线) 的派生**（合并、两级计数、
// 过滤）。时间线到上限（`LOG_STORE_MAX = 5000`）时这些层叠起来是不是一个
// 「主线程长任务」（规范 02 §2.8：> 16ms 就丢帧），只能**量**，不能推。
//
// ISSUE #1782 的结论就出自这条探针（读法见规范 07 §7.14.5）：
//   · 瓶颈在**派生**，不在写入频率——单次成本对批次大小几乎不敏感
//     （batch 1 → 1000 只差约 1ms），却与**时间线大小 × 调用次数**成正比；
//   · 于是「rAF 攒批再 flush」在本仓收益接近零（写入本来就是 2s 一批），
//     该改的是派生里重复/全量的那几层。
// 后续再动日志面板的派生开销时，**先在这里拿到改动前后的两个数**。
//
// 判据说明（为什么它不是一个门禁）：墙钟读数随机器负载漂移，把它做成断言
// 只会造出 flaky 红；这里只**报数**，取舍由读数决定（规范 02 §2.8 的
// 「先量再定」）。
import process from "node:process";

import { parseFileLogs } from "../src/components/studio/logs/log-analysis.ts";
import { LOG_STORE_MAX, useLogStore } from "../src/components/studio/logs/log-store.ts";
import type { LogEntry } from "../src/components/studio/logs/log-types.ts";

/** 一行日志正文的样本：形状取自真实转录（带 tRPC 计时与业务中文），长度典型。 */
function sampleLine(i: number): string {
  return `[2026-01-02 03:04:05.678] [INFO] [trpc] setting.comfyStatus 10457ms {"type":"query","i":${i}} 第 ${i} 条业务日志`;
}

/** 造 `n` 条互不相同的条目（id/seq/time 都单调，保证不会被去重）。 */
function makeEntries(n: number, seqBase: number, timeBase: number): Array<LogEntry> {
  const levels = /* SAFETY: 类型断言已复核 */ [
    "debug",
    "info",
    "info",
    "info",
    "warn",
    "error",
  ] as const;
  const out: Array<LogEntry> = [];
  for (let i = 0; i < n; i += 1) {
    out.push({
      id: `probe-${seqBase + i}`,
      seq: seqBase + i,
      time: timeBase + i,
      level: levels[i % levels.length]!,
      message: sampleLine(i),
      source: "system",
      origin: "app-runtime",
    });
  }
  return out;
}

/** 取中位数（比均值抗机器负载抖动，也比最小值更能反映典型成本）。 */
function medianMs(fn: () => void, runs: number): number {
  fn(); // 预热：让 JIT 与内联缓存先热起来，否则首个样本吞掉一次编译
  const samples: Array<number> = [];
  for (let i = 0; i < runs; i += 1) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

const args = process.argv.slice(2);
const runsArg = args.indexOf("--runs");
const runs = runsArg !== -1 ? Number(args[runsArg + 1] ?? "7") : 7;

/** 一次写入的耗时 vs（时间线大小 × 批次大小）——本探针的主表。 */
function tableAppend(): void {
  const rows: Array<string> = [];
  for (const size of [0, 1000, 2000, LOG_STORE_MAX]) {
    for (const batch of [1, 10, 100, 300, 1000]) {
      const base = makeEntries(size, 0, 1_700_000_000_000);
      useLogStore.setState({ logs: base, filteredLogs: base, revision: 1 });
      let round = 0;
      const cost = medianMs(() => {
        round += 1;
        // 每一轮都换一批全新的 id，避免「重复行被去重」把成本测成零。
        useLogStore
          .getState()
          .appendFileLogs(
            makeEntries(batch, size + round * 1_000_000, 1_700_000_000_000 + round * 1_000_000),
          );
      }, runs);
      rows.push(
        `  时间线 ${String(size).padStart(4)} 条 | 批次 ${String(batch).padStart(4)} 行 | appendFileLogs ${cost.toFixed(2)} ms`,
      );
    }
  }
  console.log("\n【单次写入】appendFileLogs（含一次轮询回来的全部派生）");
  console.log(rows.join("\n"));
}

/** 一轮轮询 = 六路各写一次 —— 决定「每 2s 会不会丢一帧」的那个数。 */
function pollRound(): void {
  const perSource = 300;
  let seq = 0;
  const round = () => {
    for (let s = 0; s < 6; s += 1) {
      seq += 1;
      useLogStore
        .getState()
        .appendFileLogs(makeEntries(perSource, seq * 1_000_000, 1_700_000_000_000 + seq * 1000));
    }
  };
  useLogStore.setState({ logs: [], filteredLogs: [], revision: 0 });
  const growing = medianMs(round, 5);
  const saturated = medianMs(round, 5);
  console.log("\n【一轮轮询】六路来源各写一次（六路 × 300 行）");
  console.log(`  时间线增长中（0 → ${LOG_STORE_MAX}）: ${growing.toFixed(1)} ms`);
  console.log(`  时间线已封顶（${LOG_STORE_MAX} 条）: ${saturated.toFixed(1)} ms`);
  console.log(`  参照：一帧 16.7ms；轮询间隔 2s。读数超过一帧即「每轮丢帧」。`);
}

/** 解析侧的开销：轮询回来的文本要先过 parseFileLogs，它不该被忽略。 */
function parseCost(): void {
  const lines: Array<string> = [];
  for (let i = 0; i < 300; i += 1) {
    lines.push(sampleLine(i));
  }
  const text = lines.join("\n");
  const cost = medianMs(() => void parseFileLogs(text), runs);
  console.log("\n【解析】parseFileLogs（300 行转录文本）");
  console.log(`  ${cost.toFixed(2)} ms`);
}

console.log("日志面板 store 性能探针（ISSUE #1782）");
console.log(`runs=${runs}（中位数）  node=${process.version}`);
tableAppend();
pollRound();
parseCost();
console.log("");
