#!/usr/bin/env node
/**
 * `ci-heavy-gates.mjs` — 平台侧「重档静态判据」那一格的**条目执行者**。
 *
 * ## 它替掉了什么，以及为什么（2026-10-19 的现场）
 *
 * 原来这十条判据各占一个平台 stage。`cnb-hpl-1k5a0s6ss` 上 `ESLint 零警告` 撞到平台
 * 的 **20m 单 stage 硬上限**被强杀（`任务超过最大执行时间而被强制关闭：20m0s`，脚本
 * 一行输出都没有），后面三十格整片 skipped；而同一台机、同一份工作区，
 * `cnb-smq-1k59vlk3l` 上同一步是 305s 跑过的。差的不是 ESLint 变慢了，是**前面每一格
 * 都在各付一次 job 开销与盘上扫描**，一台 16 核机被十几份同时开着的进程吃干净。
 *
 * 于是把它们收进**一格**：本次 job 只付一次开销，条目在进程内串行。红了照样知道是
 * 哪一条（每条自己一段日志，带墙钟与退出码），也不再是「一条红、后面全跳过」。
 *
 * ## 边界（刻意不做的事）
 *
 *   · **不改成并行**：这些条目本身就是 CPU 密集型（prettier / typedoc / vitest），
 *     并行只会把节点压成上面那种「谁都不推进」的形态 —— 那正是本次要治的病。
 *   · **不收窄**：`.cnb.yml` 的 `ifModify` 是按**整格**跳过的，一格装十条时它只能表达
 *     「十条一起跑」或「十条一起不跑」，而十条的扫描面并不相同 —— 后者正是本仓最不能
 *     有的形态（判据在场、结论静默变成放行）。格内一律跑全。
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
 *   · **登记面** = 下面的 `HEAVY_GATES` 条目表。它回答「原来哪几条 stage 收进了这一格」，
 *     是 `scripts/ci-autofix-duties.mjs` 与 `scripts/ci-incremental-gates.mjs` 的唯一出处
 *     （「哪一档会自己改工作区」「哪一格被收窄」都按条目名登记）。
 *   · **执行面** = `.githooks/pre-commit` 里那些 `run "<标签>" <命令>` 步骤行。
 *     这也是 `scripts/check-gate-executors.cjs` 认的执行者出处之一。所以「把步骤从钩子里
 *     删掉」从来不是挪档的正确形态（那等于删执行者），正确形态是**步骤留在钩子里、
 *     由档位决定谁执行** —— 平台这一格读的就是同一份注册表。
 *
 * 两条主干的两种做法在这里合流：一边把十条 stage 收成一格（治的是「每格各付一次 job
 * 开销」），一边让这一格读钩子注册表（治的是「清单抄成第二份」）。合起来仍然只有
 * 一处执行面，条目表只作为登记面保留。
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
 * 每条 `argv` 都是**仓库相对**的入口 + 参数（`node` 与 `node_modules/.bin/*` 两种形态
 * 都原样保留，与 `.cnb.yml` 里那几格逐字一致：本地 node 起 `.bin` 下的垫片在 Windows
 * 上起不来，那是 `ci-cp936-exit.mjs` 文件头记着的老坑，这里不重蹈）。
 *
 * @typedef {{name: string, argv: readonly string[], why: string}} HeavyGate
 * @type {ReadonlyArray<HeavyGate>}
 */
export const HEAVY_GATES = [
  {
    name: "生成态文档与源同步",
    argv: [
      "node",
      "scripts/render-doc-placeholders.cjs",
      "--check",
      "--autofix",
    ],
    why: "判「编辑态文档 ⇄ docs/generated/** 产物」同不同步；红了就地重渲染再判一次（自动修档）。",
  },
  {
    name: "API 文档生成物与源同步",
    argv: ["node", "scripts/check-docs-api.cjs", "--check", "--autofix"],
    why: "判「typedoc 产物 ⇄ docs/api/** 提交进 git 的内容」；本格最贵的一条（实测 201.8s），同时是自动修档。",
  },
  {
    name: "文档引用与权威源一致",
    argv: ["node", "scripts/check-doc-references.cjs"],
    why: "判的是全库文档里的引用与权威源，域不是某几个目录，收窄成任何子集都是漏判。",
  },
  {
    name: "覆盖率上报",
    argv: ["node", "scripts/ci-coverage-report.mjs"],
    why: "不判任何东西，只把 coverage/lcov.info 交给平台的上报通道；它自己判「有没有报告」，缺报告时跳过而不判红。",
  },
  {
    name: "core 骨架单一事实源",
    argv: [
      "node_modules/.bin/vitest",
      "run",
      "tests/single-logger-channel.test.ts",
      "tests/container-single-access.test.ts",
      "tests/core-spine-single-source.test.ts",
    ],
    why: "判三条跨全仓的单一事实源（日志实现只有一处、容器访问只有一条、core 骨架只有一份）。",
  },
  {
    name: "零消费导出",
    argv: ["node", "scripts/check-dead-exports.cjs"],
    why: "判地基层的零消费导出；面是 src/** + scripts/**，属于全仓不变量。",
  },
  {
    name: "core 出口纪律与基类纯度",
    argv: [
      "node_modules/.bin/vitest",
      "run",
      "tests/core-barrel-entry-discipline.test.ts",
      "tests/repository-base-purity.test.ts",
    ],
    why: "判 core 的出口纪律与仓储基类纯度，两条都是全仓级不变量。",
  },
  {
    name: "CP936 字形登记",
    argv: ["node", "scripts/check-cp936-glyphs.cjs"],
    why: "判「会进 CI 日志的面里，没有 CP936 字形的字符是不是都登记了替代写法」；那一跳会把没字形的字符写成问号，于是连「这一条过了」都会变成问号（规范 §13.5.3.5 的日志乱码那一族）。",
  },
  {
    name: "格式化提交分离",
    argv: ["node", "scripts/check-reformat-only.cjs"],
    why: "判「这次改动里有多少个文件只是被 prettier 重排过」；判据本体逐文件跑 prettier，面上有源文件才动手。",
  },
];

/** 条目名集合（登记表与自测共用，避免各处重算）。 */
export const HEAVY_GATE_NAMES = new Set(HEAVY_GATES.map((g) => g.name));
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
 * @returns {{runs: {label: string, code: number, output: string}[], unreadable: boolean}}
 *   `unreadable` = 注册表本身没读出来（钩子文件不在 / 解析零条）—— 那是
 *   「本档不构成证据」，不是「没有档要跑」。
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
        (s) => HEAVY_GATE_NAMES.has(s.label) || s.argv.join(" ").includes(only),
      )
    : all;
  /** @type {{label: string, code: number, output: string}[]} */
  const runs = [];
  for (const step of steps) {
    const r = runGate(fullTreeArgv(step.argv), cwd);
    runs.push({ label: step.label, code: r.code, output: r.output });
  }
  return { runs, unreadable: false };
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

/* 只在被直接执行时跑 main。被 import 时（`tests/ci-autofix-duties.test.ts` 要读
 * `HEAVY_GATES`）只暴露纯数据与函数 —— 否则 `process.exit()` 会当场把测试进程杀掉，
 * 而那件事的形态是「用例一条都没跑、套件却红了」，读起来与真红完全两样。 */
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(main());
}
