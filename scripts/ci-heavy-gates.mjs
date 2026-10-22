#!/usr/bin/env node
/**
 * `ci-heavy-gates.mjs` — 平台侧「重档静态判据」那一格的**条目执行者**。
 *
 * ## 它替掉了什么，以及为什么（2026-10-19 的现场）
 *
 * 原来这多条判据各占一个平台 stage。`cnb-hpl-1k5a0s6ss` 上 `ESLint 零警告` 撞到平台
 * 的 **20m 单 stage 硬上限**被强杀（`任务超过最大执行时间而被强制关闭：20m0s`，脚本
 * 一行输出都没有），后面三十格整片 skipped；而同一台机、同一份工作区，
 * `cnb-smq-1k59vlk3l` 上同一步是 305s 跑过的。差的不是 ESLint 变慢了，是**前面每一格
 * 都在各付一次 job 开销与盘上扫描**，一台 16 核机被十几份同时开着的进程吃干净。
 *
 * 于是把它们收进**一格**：本次 job 只付一次开销，条目在进程内串行。红了照样知道是
 * 哪一条（每条自己一段日志，带墙钟与退出码），也不再是「一条红、后面全跳过」。
 *
 * ⚠️ 2026-10-22 订正：**收进这一格的前提是「它们都在钩子里」**。其中三条
 * （文档面）在 2026-10-16 就从钩子里撤走了，2026-10-20 又被从配置里注释掉 ⇒
 * 它们从未被这一格跑过，且一个执行者都没有（`覆盖率上报` 从没进过钩子 ——
 * 它是 10-19 才被收进条目表的，而条目表不执行任何东西）。
 * 现在它们**恢复成各自的活 stage**（收窄挂在各自那一格上），这一格只留
 * **钩子里真有的那几条**。
 *
 * ## 边界（刻意不做的事）
 *
 *   · **不改成并行**：这些条目本身就是 CPU 密集型（prettier / vitest），
 *     并行只会把节点压成上面那种「谁都不推进」的形态 —— 那正是本次要治的病。
 *   · **不收窄**：`.cnb.yml` 的 `ifModify` 是按**整格**跳过的，一格装多条时它只能表达
 *     「一起跑」或「一起不跑」，而那些条目的扫描面并不相同 —— 后者正是本仓最不能
 *     有的形态（判据在场、结论静默变成放行）。格内一律跑全。
 *     ⇒ **需要收窄的判据不进这一格**，它自己占一格（平台的 `ifModify` 只能按格算）。
 *   · **不改判据**：每一条都是原来那份脚本、那份参数，本文件只负责「起它、转述它」。
 *
 * ## 收窄面的唯一出处仍然是登记表
 *
 * `scripts/ci-incremental-gates.mjs` 与 `scripts/ci-autofix-duties.mjs` 里，原来按
 * stage 名登记的那几条现在按**条目名**登记（`stage: "重档静态判据"`）。两份判据
 * （`tests/ci-incremental-gates.test.ts` / `tests/ci-autofix-duties.test.ts`）都改读
 * 本文件的 `HEAVY_GATES`，双向核对「登记过的条目 ⇒ 这里真有那一行」「这里带
 * `--autofix` 的条目 ⇒ 登记过」，所以「哪一档会自己改工作区」「哪一格被收窄」这两件
 * 事依然各只有一处出处。
 *
 * ## 执行面：钩子注册表（合并后口径）
 *
 * 本文件里有两件事，此前混在一起，现在分开：
 *
 *   · **登记面** = 下面的 `HEAVY_GATES` 条目表。它回答「这一格里到底有哪些条目」，
 *     是 `scripts/ci-autofix-duties.mjs` 与 `scripts/ci-incremental-gates.mjs` 的唯一出处
 *     （「哪一档会自己改工作区」「哪一格被收窄」都按条目名登记）。
 *   · **执行面** = `.githooks/pre-commit` 里那些 `run "<标签>" <命令>` 步骤行。
 *     这也是 `scripts/check-gate-executors.cjs` 认的执行者出处之一。所以「把步骤从钩子里
 *     删掉」从来不是挪档的正确形态（那等于删执行者），正确形态是**步骤留在钩子里、
 *     由档位决定谁执行** —— 平台这一格读的就是同一份注册表。
 *
 * 两条主干的两种做法在这里合流：一边把多条 stage 收成一格（治的是「每格各付一次 job
 * 开销」），一边让这一格读钩子注册表（治的是「清单抄成第二份」）。合起来仍然只有
 * 一处执行面，条目表只作为登记面保留。
 *
 * ## ⚠️ 登记面与执行面必须**对得上**（2026-10-22 加的自证）
 *
 * 上面那句「条目表只作为登记面保留」有一个前提：表里的每一条**真的会被这一格跑**。
 * 2026-10-20（`0c6c8897`）那个前提不成立了 —— 原来的表里写着 9 条，而这一格**只跑其中
 * 3 条**：另 6 条在钩子里没有（文档面三条 + 覆盖率上报 + `core` 那两条），而其中 4 条
 * （文档面三条 + 覆盖率上报）在 `.cnb.yml` 里的原文**也被注释掉了** ⇒ 那 4 条
 * **一个执行者都没有**，而两张登记表互核全绿（它们互核的是「表 ⇄ 表」，缺的是
 * 「表 ⇄ 执行面」这一对）。`docs/api/**` 随后漂了 32 份。
 *
 * ⇒ `heavyGateRegistryProblems()` 判的就是这一对，且 `main()` **先自证、后跑**：
 * 对不上就判红、什么都不跑（那种红必须发生在跑之前）。
 *
 * 用法：`node scripts/ci-heavy-gates.mjs [--only 条目名 …]`
 *   （`--only` 只给人手工排查用；`.cnb.yml` 里不带它 —— 平台侧永远跑全）
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { readHookSteps, runGate } from "./base-check/hook-steps.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 条目表 —— 「这一格里到底跑哪些判据」的唯一出处。
 *
 * ## 这张表**只能**收这一格真会跑的条目（2026-10-22 订正）
 *
 * 原来的表里写着 9 条，而这一格**只跑其中 3 条** —— 2026-10-20（`0c6c8897`）把
 * `生成态文档与源同步` / `API 文档生成物与源同步` / `文档引用与权威源一致` / `覆盖率上报`
 * 在 `.cnb.yml` 里的原文注释掉了（理由是「收进聚合档」），而**这一格读的是钩子注册表**
 * ——那几条在 2026-10-16（`8d0d0b23`）就已经从钩子里撤走 ⇒ 两次搬动方向相反、在中间
 * 对穿 ⇒ 从 2026-10-20 起那 4 条**一个执行者都没有**，而表上写着它们在。
 *
 * 代价是实打实的：`docs/api/**` 在无人看管下漂了 32 份（本地
 * `node scripts/check-docs-api.cjs --check` 现在退 1，墙钟 491.2s）。
 *
 * ⇒ **表里每一条都必须能被这一格真跑**，而「能不能真跑」只有一件事能回答：
 * **它的 `argv` 逐字出现在钩子的 `run` 步骤行里**。`heavyGateRegistryProblems()`
 * 判的就是这件事，且**这一格在跑之前先自证**（对不上 ⇒ 判红、什么都不跑）。
 * 表与执行面互核而执行面缺席的那次（2026-10-20）就是这么溜过去的 ——
 * 登记表之间互核全绿，缺的是「表 ⇄ 执行面」这一对。
 *
 * ⚠️ 改这张表 = 改钩子（条目必须与钩子那一步逐字一致），**或者**改执行者（把它挪到
 * 自己的 stage 那一格，见 `.cnb.yml` 的「文档面与上报这几格」那段）。
 *
 * ## 每条 `argv` 的形态
 *
 * 都是**仓库相对**的入口 + 参数（`node` 与 `node_modules/.bin/*` 两种形态都原样保留：
 * 本地 node 起 `.bin` 下的垫片在 Windows 上起不来，那是 `ci-cp936-exit.mjs` 文件头
 * 记着的老坑，这里不重蹈），且与 `.githooks/pre-commit` 里那一步**逐字相同** ——
 * 含 `--staged`（跑的时候由 `fullTreeArgv()` 剥掉：平台侧没有暂存区，留着它判的是
 * 「空提交」= 一条**恒绿**的判据）。
 *
 * @typedef {{name: string, argv: readonly string[], why: string}} HeavyGate
 * @type {ReadonlyArray<HeavyGate>}
 */
export const HEAVY_GATES = [
  {
    name: "地基层零消费导出(硬闸)",
    argv: ["node", "scripts/check-dead-exports.cjs", "--staged"],
    why: "判地基层的零消费导出；面是 src/** + scripts/**，属于全仓不变量。",
  },
  {
    name: "格式化提交与行为改动分离",
    argv: ["node", "scripts/check-reformat-only.cjs", "--staged"],
    why: "判「这次改动里有多少个文件只是被 prettier 重排过」；判据本体逐文件跑 prettier，面上有源文件才动手。",
  },
  {
    name: "CP936 字形登记（没字形的字符不许悄悄变问号）",
    argv: ["node", "scripts/check-cp936-glyphs.cjs"],
    why: "判「会进 CI 日志的面里，没有 CP936 字形的字符是不是都登记了替代写法」；那一跳会把没字形的字符写成问号，于是连「这一条过了」都会变成问号（规范 §13.5.3.5 的日志乱码那一族）。",
  },
];

/**
 * 把注册表里的步骤变成「全量档」的命令：只剥 `--staged` 这一个旗标。
 *
 * 刻意不做别的改写 —— 每条步骤的参数就是它自己的判据口径，改一个参数就是改判据。
 * 平台侧没有暂存区，留着 `--staged` 判的是「空提交」= 一条**恒绿**的判据
 * （本仓最恨的那一型）。
 *
 * @param {string[]} argv
 * @returns {string[]}
 */
export function fullTreeArgv(argv) {
  return argv.filter((a) => a !== "--staged");
}

/**
 * 跑完整张注册表。
 *
 * @param {{cwd?: string, only?: string | null}} [io]
 * @returns {{runs: {label: string, code: number, output: string, ms: number}[], unreadable: boolean}}
 *   `unreadable` = 注册表本身没读出来（钩子文件不在 / 解析零条）—— 那是
 *   「本档不构成证据」，不是「没有档要跑」。
 *   `ms` = 那一条的墙钟（毫秒）—— 这一格此前只打「ok / 红」，**没有任何计时**，
 *   而文件头承诺过「每条的墙钟」⇒ 48s 那一堆只有总数没有分布，无从判断该优化谁。
 */
export function runHeavyGates(io = {}) {
  const cwd = io.cwd ?? ROOT;
  const only = io.only ?? null;
  /* 注册表按**这个 cwd** 取，不写成模块自己的 ROOT：否则注入的目录（用例给的那个没有
   * 钩子的临时目录）照样读到真仓库的 50 条 ⇒ 「没跑起来」那一档在测试里永远命中不了，
   * 而它正是这条判据唯一有牙的地方。 */
  const all = readHookSteps(path.join(cwd, ".githooks", "pre-commit"));
  if (all.length === 0) return { runs: [], unreadable: true };
  const steps = only
    ? all.filter(
        (s) =>
          s.label === only ||
          s.label.includes(only) ||
          s.argv.join(" ").includes(only),
      )
    : all;
  /** @type {{label: string, code: number, output: string, ms: number}[]} */
  const runs = [];
  for (const step of steps) {
    const started = Date.now();
    const r = runGate(fullTreeArgv(step.argv), cwd);
    runs.push({
      label: step.label,
      code: r.code,
      output: r.output,
      ms: Date.now() - started,
    });
  }
  return { runs, unreadable: false };
}

/**
 * **自证**：条目表里每一条，这一格都真会跑它吗？
 *
 * 判据只有一件事：**条目的 `argv` 逐字出现在钩子的 `run` 步骤行里**。
 * 这一格跑的就是钩子的步骤（`runHeavyGates()` 读的是同一份注册表），所以
 * 「表里有、钩子里没有」= 「表上说它跑、实际没人跑」—— 那正是 2026-10-20 让
 * 4 条判据**整整两天没有执行者**、而两张登记表互核却全绿的那个形态。
 *
 * 反方向也判：**钩子里带自动修旗标（`--autofix`）的步骤**必须在表里 ——
 * 「哪一档会自己改工作区」只有一处出处（`scripts/ci-autofix-duties.mjs` 的登记表），
 * 而那一档的读数来自这一格的成员表。
 *
 * @param {{label: string, argv: readonly string[]}[]} hookSteps 钩子的步骤行
 * @returns {string[]} 逐条不一致（人读的话术）；空数组 = 自证通过
 */
export function heavyGateRegistryProblems(hookSteps) {
  /** @type {string[]} */
  const problems = [];
  const stepArgvs = new Set(hookSteps.map((s) => s.argv.join(" ")));
  for (const gate of HEAVY_GATES) {
    const argv = gate.argv.join(" ");
    if (stepArgvs.has(argv)) continue;
    problems.push(
      `条目表里的「${gate.name}」（${argv}）在钩子的步骤行里找不到同一条命令 —— ` +
        "这一格跑的就是钩子的步骤，表上有而钩子里没有 = 这一格**不会跑它**，那条判据就此没有执行者。" +
        "要么把这一步加回 `.githooks/pre-commit` 的 `run` 步骤行（执行面在那里），" +
        "要么把它从表里删掉并给它自己的 stage",
    );
  }
  const tableArgvs = new Set(HEAVY_GATES.map((g) => g.argv.join(" ")));
  for (const step of hookSteps) {
    const argv = step.argv.join(" ");
    if (!argv.includes("--autofix")) continue;
    if (tableArgvs.has(argv)) continue;
    problems.push(
      `钩子里的「${step.label}」带着自动修旗标，却不在条目表里 —— ` +
        "「哪一档会自己改工作区」必须只有一处出处（scripts/ci-autofix-duties.mjs 的登记表）",
    );
  }
  return problems;
}

/**
 * 入口：跑 + 打 + 定退出码。
 *
 * 三态退出码与 `premerge-check.mjs` / `base-check.mjs` **逐字同口径**：
 *   `0` = 全绿；`1` = 有档红了；`2` = 有档**没跑起来**（`runGate` 的 127 哨兵）。
 * 「没跑起来」与「跑了且红」必须在退出码上分开，否则前者会被读成后者。
 *
 * @param {{cwd?: string, argv?: string[], log?: (line: string) => void}} [io]
 * @returns {number}
 */
export function main(io = {}) {
  const argv = io.argv ?? process.argv.slice(2);
  const log = io.log ?? ((line) => process.stdout.write(`${line}\n`));
  const onlyArg = argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length) : null;
  const cwd = io.cwd ?? ROOT;

  /* **三态的次序**：读不出来 → 退 2；读出来了但表与它对不上 → 退 1；全绿 → 退 0。
   * 「读不出来」必须排在自证**前面** —— 注册表整个读不到时，自证会报「表里有、钩子里
   * 没有」，而那其实是同一个根因（注册表没读出来）的另一种说法；让它退 1 就是把
   * 「没跑起来」说成「判据判出失败」（§13.5.25 的三态口径：两者必须分开）。 */
  const hookSteps = readHookSteps(path.join(cwd, ".githooks", "pre-commit"));
  if (hookSteps.length === 0) {
    log(
      "[重档] 没跑起来：读不到 `.githooks/pre-commit` 的步骤注册表（0 条）—— " +
        "本档不构成证据，不是「没有判据要跑」",
    );
    return 2;
  }

  /* **先自证、后跑**：条目表与执行面对不上时，这一格跑的每一格都是「判据在场、
   * 结论静默变成放行」—— 那种红必须发生在跑之前，而不是跑完之后没人看见。 */
  const registryProblems = heavyGateRegistryProblems(hookSteps);
  if (registryProblems.length > 0) {
    for (const p of registryProblems) log(`[重档] 注册表自证不通过：${p}`);
    log(
      "[重档] 本档**不构成证据**（成员表与执行面对不上）—— 判据在场、结论静默变成放行，" +
        "那种红必须先修这张表或钩子",
    );
    return 1;
  }

  const { runs } = runHeavyGates({ cwd: io.cwd, only });

  const red = runs.filter((r) => r.code !== 0 && r.code !== 127);
  const missing = runs.filter((r) => r.code === 127);
  if (argv.includes("--json")) {
    log(
      JSON.stringify(
        {
          total: runs.length,
          red: red.map((r) => r.label),
          notRun: missing.map((r) => r.label),
          ms: runs.map((r) => ({ label: r.label, ms: r.ms })),
        },
        null,
        2,
      ),
    );
  } else {
    runs.forEach((r, i) => {
      const tag = r.code === 0 ? "ok" : r.code === 127 ? "没跑起来" : "红";
      log(`[重档] ${i + 1}/${runs.length} ${tag} ${r.label}（${r.ms}ms）`);
      if (r.code !== 0) {
        const tail = String(r.output ?? "")
          .trim()
          .split(/\r?\n/)
          .slice(-12);
        for (const line of tail) log(`        ${line}`);
      }
    });
  }
  const totalMs = runs.reduce((sum, r) => sum + r.ms, 0);
  log(
    `[重档] 合计 ${runs.length} 条：红 ${red.length}、没跑起来 ${missing.length}、` +
      `绿 ${runs.length - red.length - missing.length}；墙钟合计 ${totalMs}ms`,
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

/* 只在被直接执行时跑 main。被 import 时（`tests/ci-autofix-duties.test.ts` 要读
 * `HEAVY_GATES`）只暴露纯数据与函数 —— 否则 `process.exit()` 会当场把测试进程杀掉，
 * 而那件事的形态是「用例一条都没跑、套件却红了」，读起来与真红完全两样。 */
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(main());
}
