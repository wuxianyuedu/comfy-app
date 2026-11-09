#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本：无类型消费方，tsc 面在 src/**
/**
 * affected-launch-isolated-timing.mjs — 「逐份单跑取台账读数」那一档（ISSUE #3030）。
 *
 * 干什么：台账（`scripts/.test-file-timing.json`）要的是「**这一份自己要多久**」，而 junit 里
 * 只有批跑墙钟（`--maxWorkers=N` 时几份同时在跑，读数随同块里还有谁一起漂）。所以
 * `--update-timing --isolated` 这一档真的逐份跑一遍，把各自的墙钟当读数记进台账。
 *
 * 为什么单成一份文件：`run-affected-tests.mjs` 已贴住 900 行硬闸（基线 897），
 * 而这一档与那一层**变化方向不同** —— 它只产出**读数**，不参与任何判决（红不红、退几）。
 * 混在那份里时，「读数档」与「判决链」共用一个函数，读的人得自己分辨哪几行会改退出码。
 *
 * 三条边界：
 *   1. **不改退出码**：任何一份非零退出都只影响它自己那一格账 —— 台账是启发式，
 *      判据红不红由常态那一跑给（见 `affected-launch-duration-order.mjs` 文件头）。
 *   2. **不另写一套 spawn**：怎么起一次 vitest 的唯一出处是 `affected-launch-spawn.mjs`，
 *      这里只做编排（一份一次、串行、量墙钟）。第二份实现会在下一次改动里漂开。
 *   3. **不静默**：每一份的读数与退出码都打出来，落盘失败与「没覆盖」都点名。
 *
 * @param {{files: string[], entry: string, spawn: (entry: string, args: string[], options?: {timeoutMs?: number}) => {status: number | null}, merge: (root: string, readings: {name: string, ms: number, source: "isolated"}[]) => {written: boolean, rejected: string[]}, cwd: string, write: (text: string) => void}} deps
 *   全部依赖注入（用例不真起进程、不写仓库台账）
 * @returns {0} 恒 0 —— 这是读数档
 */
export function runIsolatedTiming({ files, entry, spawn, merge, cwd, write }) {
  write(
    `[affected-launch] --update-timing --isolated：逐份单跑 ${files.length} 份` +
      "（一份一次、串行，取各自的墙钟当台账读数）…\n",
  );
  /** @type {{name: string, ms: number, source: "isolated"}[]} */
  const readings = [];
  let failed = 0;
  for (const file of files) {
    const startedAt = Date.now();
    /* `timeoutMs: undefined` 是刻意的：读数档不加界 —— 加界会把「这份很慢」记成一个
     * 掐断值，而那个值恰恰是这一档要量出来的东西（量不准的读数比没有读数更坏）。 */
    const one = spawn(entry, ["run", "--no-file-parallelism", file], { timeoutMs: undefined });
    const ms = Date.now() - startedAt;
    readings.push({ name: file, ms, source: "isolated" });
    if (one.status !== 0) {
      failed += 1;
    }
    write(
      `[affected-launch]   ${(ms / 1000).toFixed(2)}s ${file}` +
        `${one.status === 0 ? "" : `（退出码 ${one.status} —— 读数照记，本档不改退出码）`}\n`,
    );
  }
  const { written, rejected } = merge(cwd, readings);
  write(
    written
      ? `[affected-launch] ${readings.length} 份的**隔离单跑**读数已并进台账（来源 isolated）—— 提交它\n`
      : "[affected-launch] 台账没落盘（无读数或写失败）—— 排序退化为原序，不阻断\n",
  );
  if (rejected.length > 0) {
    write(`[affected-launch] ${rejected.length} 份没覆盖（不该发生：这一档是最强的来源）\n`);
  }
  write(
    `[affected-launch] 退出码：0 —— 这是**读数档**，${failed} 份非零退出不改变它` +
      "（判据红不红由常态那一跑给）。\n",
  );
  return 0;
}

/**
 * `--isolated` 独自出现时那句话（没有 `--update-timing` 就没有出口）。
 *
 * 收在这里而不是调用点：它的内容是「这一档改的是什么」—— 那件事的出处是这一份文件
 * （量纲与来源），写在 `main()` 里就成了第二份描述。常量而不是函数，是因为调用点只有
 * 一个、也没有参数要拼。
 */
export const ORPHAN_ISOLATED_FLAG_NOTE =
  "[affected-launch] `--isolated` 只与 `--update-timing` 连用（它改的是**记进台账那一档**的来源），\n" +
  "  单独给它没有任何出口 ⇒ 这一跑照旧，台账一个字都不写。\n";

/**
 * 把这一跑的**批跑**读数并进台账（`--update-timing` 的执行体，ISSUE #3030）。
 *
 * 为什么与 `runIsolatedTiming` 住同一份文件：它们是同一件事的两个来源，而「来源」这件事
 * 必须由一个人同时管住——分开写就会漂成「一个在写 batch、一个在覆盖 isolated」。
 *
 * ⚠️ 这里的读数来源恒为 `batch`：junit 的 `time` 是「那份文件在那次并行运行里的墙钟」，
 * 拿它当单份成本就是本单要修的那个错。它只能覆盖同来源的旧值（跨来源由 `mergeTimingLedger`
 * 按量纲挡），被拒的那几份**点名**输出。
 *
 * @param {{readings: {name: string, ms: number}[], cwd: string,
 *   merge: (root: string, readings: {name: string, ms: number, source: "batch"}[]) => {written: boolean, rejected: string[]}}} deps
 * @returns {string} 要打到 stderr 的正文（调用点只负责 write）
 */
export function recordBatchTiming({ readings, cwd, merge }) {
  const { written, rejected } = merge(
    cwd,
    (readings ?? []).map((r) => ({ ...r, source: "batch" })),
  );
  const head = written
    ? "[affected-launch] 逐份用时已并进入库台账（scripts/.test-file-timing.json）—— 提交它，下次排块就按这次的实测耗时来\n"
    : "[affected-launch] 台账没落盘（无读数或写失败）—— 排序退化为原序，不阻断\n";
  return (
    head +
    (rejected.length > 0
      ? `[affected-launch] ${rejected.length} 份的本次读数**没覆盖**台账：它们是批跑墙钟` +
        "（量纲弱于已有的隔离单跑读数）。要更新这几份就用 `--update-timing --isolated`。\n"
      : "")
  );
}

/**
 * 「重块排前 + 分块」那一跳（ISSUE #2863 的 ③ / #2845）：清单 → 带 `kind` 的块序列。
 *
 * 为什么从 `main()` 出列：它是**规划**（读台账、排序、切块），与那一层的执行编排变化方向
 * 不同，而 `run-affected-tests.mjs` 已贴住 900 行硬闸（基线 897、本单新增 26 行）。
 * 判据一个都不在这里：排序是启发式（台账过期只损失最优性）、分块由 `planSeparatedLaunches`
 * 自己的防丢防重用例钉着。这里只把「读台账 → 排序 → 切块」串一次，好让调用点那一屏
 * 只剩一句「规划成了没有」。
 *
 * @param {string[]} files 段裁过的清单
 * @param {{order: (files: string[], ledger: Map<string, unknown>) => string[],
 *   readLedger: (root: string) => Map<string, unknown>,
 *   plan: (files: string[]) => {kind: "fixed" | "affected", files: string[]}[],
 *   cwd: string}} deps 全部注入（用例不读真台账）
 * @returns {{ok: true, files: string[], chunks: {kind: string, files: string[]}[]} |
 *   {ok: false, message: string}} 规划失败时把原因交回调用点（它决定退几）
 */
export function planOrderedChunks(files, { order, readLedger, plan, cwd }) {
  try {
    /* 重块排前：按入库耗时台账**按档位**排（`isolated` 之间比实测值、`batch` 整档垫后
     * 并列）—— 台账过期只损失排序最优性，不影响任何判定（见该模块文件头）。 */
    const ordered = order(files, readLedger(cwd));
    return { ok: true, files: ordered, chunks: plan(ordered) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * `--dry-run` 那一行读数（清单份数 / 启动次数 / 最长一块的字符数）。
 *
 * 出列的理由同 `planOrderedChunks`：这三件事全是纯计算结果，而那一层已贴住 900 行硬闸。
 * 判据在这里一条都没有 —— `--dry-run` 的语义（不起 vitest、不碰 `node_modules`）由
 * 调用点的位置守着（它在 `resolveVitestEntry()` 之前）。
 *
 * @param {string[]} files 段裁过的清单
 * @param {{files: string[]}[]} chunks 规划出来的块
 * @returns {string} 要打到 stdout 的正文
 */
export function dryRunReading(files, chunks) {
  return (
    `[affected-launch] ${files.length} 个用例 / ${chunks.length} 次启动，` +
    `最长一块 ${chunks.reduce((m, c) => Math.max(m, c.files.join(" ").length), 0)} 字符\n`
  );
}
