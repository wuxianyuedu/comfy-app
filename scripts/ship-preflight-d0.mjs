#!/usr/bin/env node
/**
 * ship-preflight-d0.mjs —— 阶段 0 的 **D0 预跑**（ISSUE #3200）：
 * 在 `git commit` 触发 pre-commit 之前，把 D0 组里那些**只读形态判据**先跑一遍，
 * 把所有红**一次报齐** —— 免得「阶段 0 红一次、提交钩子再红一次」各吃一轮往返。
 *
 * ## 判据清单的单一出处
 *
 * **`.githooks/pre-commit` 的 D0 组本身就是登记处**：本文件从钩子文本里解析
 * `run_group D0 … sh -c '…'` 块内的 `run "<标签>" <命令>` 步骤行（与
 * `check-gate-executors.cjs` 认的是同一批行）。这里不抄第二份清单 ——
 * 钩子里加一步，预跑自动跟上；解析不出（组改名 / 引号形状变了）⇒ `closed=false`，
 * 调用方念一句「取不到」跳过，**不冒充结论**。清单漂移由
 * `tests/ship-preflight-d0.test.ts` 对真钩子文件钉住。
 *
 * ## 边界（硬规则 28 的红线在这里逐条落实）
 *
 *   · **只读**：每一个步骤都按钩子里的**原样命令**起子进程，不加旗标、不换判据；
 *     D0 那批判据自己就是只读的（判「这次提交的形态」），工作区与暂存区一个字节不动。
 *   · **不另立判定**：红不红只看各判据自己的退出码；本文件不解读输出内容。
 *   · **不吞判据**：预跑红 ⇒ 阶段 0 落 `RED`，与「提交钩子会拦下它」同权 ——
 *     不是「提示一下照跑」。
 *   · **成本明说**：跳过条件（dry-run / 带 `--add` / 暂存面为空 / 依赖没装 / 旗标关）
 *     每一条都念出来；跑了就报总耗时。
 *
 * ## 为什么「带 `--add`」要跳过
 *
 * D0 判的是**暂存面**（`--staged`）。`--add` 点名的文件要到提交那一刻才进暂存区
 * （`ship-local.mjs` 的提交段），预跑时刻的暂存面**不是**提交时被判的那个面 ——
 * 拿它预跑只会产出假绿。这时候预跑没有对象，跳过是对的，不是偷懒。
 *
 * @module scripts/ship-preflight-d0.mjs — 预跑机制层（解析 + 选择 + 执行，无退出码）
 */

/**
 * 一条 D0 步骤行（钩子里的原样形状）。
 *
 * @typedef {{label: string, argv: string[]}} D0Step
 */

/** 钩子里 D0 组的组名（`run_group` 的第一个参数）。 */
const D0_GROUP_NAME = "D0";

/**
 * 预跑时**跳过**的步骤（按命令里的脚本名认，不按标签认 —— 标签是给人读的，会改写）。
 *
 * 依赖新鲜度这一步跳过：阶段 0 在它前面刚跑过同一个判据（`--json` 形态，读数分型
 * 比钩子里那次的 `--staged` 形态更细），同一轮里不付第二遍。
 *
 * @type {ReadonlySet<string>}
 */
export const PRE_RUN_SKIP_SCRIPTS = new Set(["scripts/check-deps-freshness.mjs"]);

/**
 * 从钩子文本里解析 D0 组的步骤行。
 *
 * 区间的找法：`run_group D0` 那一行起，到**独占一行**的收引号 `'` 止（钩子里
 * `sh -c '…'` 块的闭合形状）。找不到闭合 ⇒ `closed=false` —— 调用方把它当
 * 「取不到」处置，不许把半截清单当全量跑。
 *
 * @param {string} hookText `.githooks/pre-commit` 的全文
 * @returns {{steps: D0Step[], closed: boolean}} 步骤行 + 区间是否闭合
 */
export function parseD0RunLines(hookText) {
  const lines = hookText.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`run_group ${D0_GROUP_NAME} `));
  if (start < 0) {
    return { steps: [], closed: false };
  }
  /** @type {D0Step[]} */
  const steps = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim() === "'") {
      return { steps, closed: true };
    }
    const m = /^\s*run "([^"]*)"\s+(.+?)\s*$/.exec(line);
    if (!m) {
      continue;
    }
    /* 命令形状在钩子里只有一种：`node scripts/<名> [旗标…]`。按空白拆 ——
     * 步骤行里没有带引号的参数（带引号的标签已被上面那组捕获），拆完即原样。 */
    steps.push({ label: m[1] ?? "", argv: (m[2] ?? "").split(/\s+/) });
  }
  return { steps, closed: false };
}

/**
 * 从全部步骤里挑出预跑要跑的那些（跳过规则见 `PRE_RUN_SKIP_SCRIPTS` 的头注）。
 *
 * @param {D0Step[]} steps 钩子 D0 组的全部步骤行
 * @returns {D0Step[]} 预跑子集（保序 —— 与钩子里的登记顺序一致，读数可对照）
 */
export function selectPreRunSteps(steps) {
  return steps.filter((s) => !PRE_RUN_SKIP_SCRIPTS.has(s.argv[1] ?? ""));
}

/**
 * 预跑该不该跑、为什么没跑（纯函数，用例直接钉）。
 *
 * 「暂存面为空」这一条**刻意不念**：工作树全干净时提交段本来就会跳过
 * （`ship-local.mjs` 那句「工作树干净 ⇒ 跳过提交这一段」也不念第二遍），
 * 预跑跟着安静 —— 合并 / 轮询那几类重跑不该多出一行常驻噪声。
 *
 * @param {{
 *   enabled: boolean,
 *   dryRun: boolean,
 *   adds: string[],
 *   stagedCount: number,
 *   depsState: string,
 * }} input 判定输入（`depsState` 取 `readFreshnessState` 的原值）
 * @returns {{run: boolean, why: string | null}} `why` 只在「该跳过且值得念」时给
 */
export function decideD0PreRun({ enabled, dryRun, adds, stagedCount, depsState }) {
  if (!enabled) {
    return { run: false, why: "旗标关（--no-preflight-d0）" };
  }
  if (dryRun) {
    return { run: false, why: "--dry-run 只念计划（预跑的结论留给真跑）" };
  }
  if (adds.length > 0) {
    return {
      run: false,
      why: "本次带 --add ⇒ 暂存面要到提交那一刻才成形，预跑没有对象（提交钩子照判）",
    };
  }
  if (depsState !== "clean") {
    return {
      run: false,
      why: `依赖没就绪（判据原值 ${depsState}）⇒ D0 的判据起不来，跳过`,
    };
  }
  if (stagedCount === 0) {
    return { run: false, why: null };
  }
  return { run: true, why: null };
}

/**
 * 逐条执行预跑步骤（顺序执行，红不短路 —— 这一轮要把**所有**红一次报齐）。
 *
 * @param {{
 *   steps: D0Step[],
 *   run: (cmd: string, args: string[]) => import("./ship-exec.mjs").ExecResult,
 *   relay: (r: {stdout: string, stderr?: string}) => void,
 *   log: (s: string) => void,
 *   now?: () => number,
 * }} ctx 与装配层同一把 `run`
 * @returns {{failures: Array<{label: string, status: number | null}>, okCount: number, ms: number}}
 *   失败清单（原样带判据自己的退出码）+ 通过数 + 墙钟
 */
export function preRunD0Steps({ steps, run, relay, log, now = Date.now }) {
  const started = now();
  /** @type {Array<{label: string, status: number | null}>} */
  const failures = [];
  let okCount = 0;
  for (const step of steps) {
    const r = run(step.argv[0] ?? "node", step.argv.slice(1));
    if (r.status === 0) {
      okCount += 1;
      continue;
    }
    failures.push({ label: step.label, status: r.status });
    log(`[ship] ✗ D0 预跑红：「${step.label}」（exit ${r.status ?? "?"}）—— 判据原话：`);
    relay(r);
  }
  return { failures, okCount, ms: Math.max(0, now() - started) };
}

/**
 * 汇总那一行（预跑的读数形状只有这一处）。
 *
 * @param {{failures: number, total: number, ms: number, skippedLine: string | null}} readout
 * @returns {string} 给 `log` 的单行读数
 */
export function formatD0PreRunLine({ failures, total, ms, skippedLine }) {
  if (skippedLine !== null) {
    return `[ship] D0 预跑：没跑（${skippedLine}）。`;
  }
  const sec = (ms / 1000).toFixed(1);
  return failures === 0
    ? `[ship] D0 预跑：${total} 步全绿（${sec}s）。`
    : `[ship] D0 预跑：${failures}/${total} 步红（${sec}s）⇒ 上面每一条都是提交钩子会拦下的事实，一次修完再 ship。`;
}
