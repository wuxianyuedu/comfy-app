/**
 * CI 侧的重档执行者：跑 `.githooks/pre-commit` 注册表里的**全部 `run` 步骤**。
 *
 * 为什么需要这个文件（ISSUE #2022 / 规范 §13.5.25）：本地钩子的默认档位收窄成「只跑 D0
 * 形态档」（业主口径：提交在开发者的编辑循环里，慢 = 直接被 `--no-verify` 绕掉），
 * 而那 50 条静态判据**一个字都不许丢**。丢与不丢的分界在这里是机械可查的：
 * `scripts/check-gate-executors.cjs` 认的执行者出处只有三处 ——
 * 钩子的 `run` 行、`quality-gate.mjs` 的 gate 表、`quality-gate.ps1` 的 `$Blocks`；
 * **`.cnb.yml` 不算执行者**。所以「挪到 CI」不能靠把步骤删掉，得给它们一个真的会跑它们的
 * 进程，而那个进程读的必须是**同一份注册表**（在 CI 里另抄一份清单 = 第二份事实，
 * 漂移形态本仓记过无数次）。
 *
 * 三态退出码与 `premerge-check.mjs` / `base-check.mjs` **逐字同口径**：
 *   `0` = 全绿；
 *   `1` = 有档红了（报告是哪几条）；
 *   `2` = 有档**没跑起来**（`runGate` 的 127 哨兵：PATH 上没有 / 目标文件不在该目录）——
 *       「没跑起来」与「跑了且红」必须在退出码上分开，否则前者会被读成后者（§13.6.2）。
 *
 * `--staged` 一律剥掉：CI 没有暂存区，留着它这些脚本判的是「空提交」，那是一条**恒绿**的
 * 判据（本仓最恨的那一型）。不带 `--staged` 是同一批脚本的全量档，语义更早、更宽。
 *
 * 串行而不是并发：与钩子 D 组同一条实测结论（组内并发对墙钟净零、峰值照涨，见钩子文件头
 * 那段「D 组这条『组内串行』是实测过的有意取舍」），而 CI 这一档跑在 16 核节点上，
 * 与 `类型检查` 等格并行已经把核占满。
 *
 * 用法：`node scripts/ci-heavy-gates.mjs`（CI 的 `重档静态判据` 那格）；
 *       `--json` 给机器读；`--only=<脚本名片段>` 排查用。
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { readHookSteps, runGate } from "./base-check/hook-steps.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** 一条判据的跑批结果。 */
/** @typedef {{label: string, code: number, output: string}} GateRun */

/**
 * 把注册表里的步骤变成「全量档」的命令：只剥 `--staged` 这一个旗标。
 *
 * 刻意不做别的改写 —— 每条步骤的参数就是它自己的判据口径，改一个参数就是改判据。
 *
 * @param {string[]} argv @returns {string[]} */
export function fullTreeArgv(argv) {
  return argv.filter((a) => a !== "--staged");
}

/**
 * 跑完整张注册表。
 *
 * @param {{cwd?: string, only?: string | null}} [io]
 * @returns {{runs: GateRun[], unreadable: boolean}} `unreadable` = 注册表本身没读出来
 *   （钩子文件不在 / 解析零条）—— 那是「本档不构成证据」，不是「没有档要跑」。
 */
export function runHeavyGates(io = {}) {
  const cwd = io.cwd ?? ROOT;
  const only = io.only ?? null;
  /* 注册表按**这个 cwd** 取，不写成模块自己的 ROOT：否则注入的目录（用例给的那个没有
   * 钩子的临时目录）照样读到真仓库的 50 条 ⇒ 「没跑起来」那一档在测试里永远命中不了，
   * 而它正是这条判据唯一有牙的地方。 */
  const all = readHookSteps(path.join(cwd, ".githooks", "pre-commit"));
  if (all.length === 0) return { runs: [], unreadable: true };
  const steps = only ? all.filter((s) => s.argv.join(" ").includes(only)) : all;
  /** @type {GateRun[]} */
  const runs = [];
  for (const step of steps) {
    const argv = fullTreeArgv(step.argv);
    const r = runGate(argv, cwd);
    runs.push({ label: step.label, code: r.code, output: r.output });
  }
  return { runs, unreadable: false };
}

/**
 * 入口：跑 + 打 + 定退出码。
 *
 * @param {{cwd?: string, argv?: string[], log?: (line: string) => void}} [io]
 * @returns {number}
 */
export function main(io = {}) {
  const argv = io.argv ?? process.argv.slice(2);
  const log = io.log ?? ((line) => process.stdout.write(`${line}\n`));
  const onlyArg = argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length) : null;
  const { runs, unreadable } = runHeavyGates({ cwd: io.cwd, only });

  if (unreadable) {
    log(
      "[重档] 没跑起来：读不到 `.githooks/pre-commit` 的步骤注册表（0 条）—— " +
        "本档不构成证据，不是「没有判据要跑」",
    );
    return 2;
  }

  const red = runs.filter((r) => r.code !== 0 && r.code !== 127);
  const missing = runs.filter((r) => r.code === 127);
  if (argv.includes("--json")) {
    log(
      JSON.stringify(
        {
          total: runs.length,
          red: red.map((r) => r.label),
          notRun: missing.map((r) => r.label),
        },
        null,
        2,
      ),
    );
  } else {
    runs.forEach((r, i) => {
      const tag = r.code === 0 ? "ok" : r.code === 127 ? "没跑起来" : "红";
      log(`[重档] ${i + 1}/${runs.length} ${tag} ${r.label}`);
      if (r.code !== 0) {
        const tail = String(r.output ?? "")
          .trim()
          .split(/\r?\n/)
          .slice(-12);
        for (const line of tail) log(`        ${line}`);
      }
    });
  }
  log(
    `[重档] 合计 ${runs.length} 条：红 ${red.length}、没跑起来 ${missing.length}、` +
      `绿 ${runs.length - red.length - missing.length}`,
  );
  if (red.length > 0) {
    for (const r of red) log(`[重档] ✗ ${r.label}`);
    return 1;
  }
  if (missing.length > 0) {
    // 127 单列一档并退 2：把它并进「红」就等于宣布「判据判出失败」，而事实是它没判。
    for (const r of missing) log(`[重档] ? ${r.label} —— 没跑起来，不等于通过`);
    return 2;
  }
  return 0;
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(main());
}
