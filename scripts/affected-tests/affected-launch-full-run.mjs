#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本：无类型消费方，tsc 面在 src/**
/**
 * affected-launch-full-run.mjs — 显式全量档（`--full`）那一格（ISSUE #1393 的签字出口）。
 *
 * 这一档**不是**增量解析的兜底，是它的**反面**：增量档把筛出来的清单当位置参数交给
 * vitest，而这里由调用方**按名字**点名要全部（`vitest run` 不带位置参数即全量收集）。
 * 两者在退出码与代价上完全不同，所以必须能分辨「我要全量」与「谁都没筛过」——
 * 后者仍然是阻断（空清单守卫在调用点）。
 *
 * 为什么需要它：`affected-tests.mjs` 命中公共地基时会**放弃收窄**（固定清单全跑 +
 * 本次变更命中，ISSUE #2792），而这条
 * 兜底此前**没有具名出口** —— 规范里那句「翻兜底的前置是先造一条显式的全量通道」说的就是
 * 这个洞。档位在场之后，wide 话术与钩子日志才能指向一条**跑得响**的命令。
 *
 * 为什么出列到这一份：它是**一条整档**的分支（与常态增量档几乎不共用任何东西），而
 * `run-affected-tests.mjs` 贴住 900 行硬闸。判据一个字没搬 —— 退出码仍由 `runChunk` 给。
 *
 * @param {{dryRun: boolean, deps: {
 *   applySuspension: (files: string[], mode: string) => {reading: string, excludes: string[]},
 *   resolveVitestEntry: () => string,
 *   resolveMaxWorkers: (env: string | undefined, fallback: number) => {workers: number, note: string | null},
 *   resolveCiWorkers: () => {workers: number},
 *   announceQuiet: (raw: string | undefined, write: (text: string) => void) => boolean,
 *   reportFileTiming: (text: string) => void,
 *   runChunk: (files: string[], options: Record<string, unknown>) => Promise<number>,
 *   env?: Record<string, string | undefined>,
 *   stderr?: (text: string) => void,
 *   stdout?: (text: string) => void,
 * }}} args
 * @returns {Promise<number>} 退出码（与增量档逐字同口径：0 绿 / 1 红 / 2 没跑起来）
 */
export async function runFullSuite({ dryRun, deps }) {
  const {
    applySuspension,
    resolveVitestEntry,
    resolveMaxWorkers,
    resolveCiWorkers,
    announceQuiet,
    runChunk,
    env = process.env,
    stderr = (text) => process.stderr.write(text),
    stdout = (text) => process.stdout.write(text),
  } = deps;
  stderr(
    "[affected-launch] --full：按名字要全量（**不经**暂存区解析、不拼位置参数，\n" +
      "  由 vitest 自己收集全部用例）。这一档买的是「没人能替你保证」的那部分，\n" +
      "  代价是整份套件的墙钟 —— 常态提交仍走增量档。\n",
  );
  /* ⚠️ `--dry-run` 必须排在 `resolveVitestEntry()` **之前**：那是本文件里第一个依赖
   * `node_modules` 的调用（解析不到就 `throw`），而「不起 vitest 的读数档」反过来成了
   * 唯一必须装好依赖的一档 —— 干净检出 / 只读沙箱上 `--dry-run` 直接红在「解析不到
   * vitest 入口」，而它的全部用途（对账清单份数、问一句跑得起来吗）一个都用不上。
   * 判据 `tests/affected-tests.test.ts` 的「干净检出」一条真起进程判这条顺序。 */
  const { reading, excludes } = applySuspension([], "full");
  stderr(reading);
  if (dryRun) {
    stdout("[affected-launch] --full：会跑全部用例（vitest 自行收集）\n");
    return 0;
  }
  const entry = resolveVitestEntry();
  const { workers, note } = resolveMaxWorkers(
    env.COMFY_PRECOMMIT_MAX_WORKERS,
    resolveCiWorkers().workers,
  );
  if (note) {
    stderr(`[affected-launch] ${note}\n`);
  }
  const quietFull = announceQuiet(env.COMFY_AFFECTED_QUIET, stderr);
  /* 这一档的「清单」不是一张表而是 vitest 自己收集出来的全集 —— 逐份列出来只会把日志
   * 预算吃光，所以这里只念一句「没有清单可列」。不静默：quiet 档读的人要能分辨
   * 「这一档本来就不列」与「列清单这件事坏了」。 */
  stderr(
    quietFull
      ? "[affected-launch] 本次清单：全量档由 vitest 自行收集，故不逐份列出（quiet 只换 reporter）\n"
      : "",
  );
  /* 空清单在这里是**明确意图**（全量），所以复用同一条判决链（超时形态仍会隔离复跑）。 */
  return await runChunk([], { entry, workers, quiet: quietFull, exclude: excludes });
}
