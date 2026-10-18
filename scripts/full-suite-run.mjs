#!/usr/bin/env node
/**
 * full-suite-run.mjs — 全量单测 + 覆盖率门槛那一档的**记账通道**（规范 §13.5.4 / §13.5.12）。
 *
 * 为什么它需要一条账（而不是继续靠一句「记得按需跑」）：`pnpm run test:coverage` 是
 * 平台流水线删掉（ISSUE #623）之后**唯一没有自动执行者**的判定档之一 —— 覆盖率门槛
 * （`vitest.config.ts` 的 `coverage.thresholds`）写了几十条按实测定的数，而它们只在
 * 这一档里判。此前它的执行者是文档里那句「按需手动跑」（§13.5.3 的欠账表），
 * 而那句话**没有任何东西在守**：真正会踩的形态是「改了 `src/lib/**` 的覆盖率相关分支、
 * 门槛悄悄跌破了」—— 提交门槛（C 组）只跑固定清单 + 受影响用例，**不跑覆盖率**。
 *
 * 它判什么、以及为什么不是「每天一次仪式」：
 *   · 这一档吃 `src/` 与 `tests/`（`FRESHNESS_TRACKS.full.dirty`）。**改了就当天跑**
 *     是它真正的语义 —— 没碰这两个目录的一天跑一遍全量，换来的是十分钟墙钟与一个
 *     不会变的结论，而那正是「按需召唤」当初被发明出来要避免的东西。
 *   · 所以判据分两层（`checkFreshnessLedger` 的 `track.dirty` 那一档）：
 *     当天动过输入面 ⇒ **今天必须自证**；没动过 ⇒ 以 `graceMs`（7 天）为宽限。
 *     两层都有出路：跑一次，或 `--dirty "<理由>"` 声明「这次改动确实不吃这一档」。
 *
 * 记账语义与另外三档**逐字同一份实现**（`writeFreshness` / `writeSkipRecord`，
 * `scripts/freshness-ledger.mjs`）：只有绿了才记、红着不记（跑过 ≠ 跑绿过）。
 * `--skip` / `--dirty` 的解析与落账走 `scripts/daily-run.mjs`（四档共用，§12.12）。
 *
 * 用法：
 *   node scripts/full-suite-run.mjs --dry-run       只打印本次会跑什么（无副作用）
 *   node scripts/full-suite-run.mjs                 跑全量单测 + 覆盖率，绿了记一笔账
 *   node scripts/full-suite-run.mjs --skip "<理由>"  今天不跑，记一条写明理由的豁免
 *   node scripts/full-suite-run.mjs --dirty "<理由>" 这次改动不吃这一档，记一条
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { resolveCiWorkers } from "./ci-load.mjs";
/* 分文件耗时的形状与钩子那一档**共用同一份解析**（`parseJunitXml`）：本地账本与 CI 日志
 * 报的是同一个量的两种形状，抄两份解析器就会在「谁把外层 `<testsuites>` 当成一个文件」
 * 这种地方分叉，而那类分叉只会让读数偏，不会让它红。 */
import { parseJunitXml } from "./precommit-timing.mjs";
import { parseLedgerFlag, writeLedgerNote } from "./daily-run.mjs";
import {
  abortedAdvice,
  classifyOutcome,
  runPnpmSync,
} from "./launcher-core/shell.mjs";
import {
  freshnessTrack,
  gitUser,
  isWholeTrackRun,
  notWholeTrackNotice,
  writeFreshness,
} from "./freshness-ledger.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** 本档的登记（账文件 / 键 / 名字 / 「怎么跑」那条命令）。 */
export const TRACK = freshnessTrack("full");

/**
 * 本次要跑的那条命令 —— 抽成纯函数是为了让「跑的是什么」可被判据核。
 *
 * 与 `pnpm run test:coverage` 逐字同形（`package.json` 里那一行是这条命令的历史入口）：
 * 覆盖率门槛**只在这一档判**，单文件跑 `--coverage` 会把其余路径按 0% 算（§11.7）。
 *
 * ⚠️ **并发跟现场核数走，不写死**（ISSUE #1993 / 规范 §13.5.21）：旧形态是在
 * `.cnb.yml` 里裸跑 `node scripts/full-suite-run.mjs`，并发吃 `vitest.config.ts` 给的
 * `maxWorkers: 8`，而那个 8 是**本机 8 核检出**的实测值 —— 平台节点换规格、或同一台机上
 * 多了一条流水线时它照旧按 8 铺开。核数由 `scripts/ci-load.mjs` 从 `CNB_CPUS` 与
 * `os.availableParallelism()` 读（唯一出处），这里只把结论拼进参数。
 * 这不是放宽判据：用例、预算、覆盖率阈值一个字不动，动的只有排队的宽度。
 *
 * @param {string[]} [extra] 透传的额外参数
 * @param {number} [workers] `--maxWorkers`（缺省由 `resolveCiWorkers()` 给）
 * @returns {{label: string, args: string[]}}
 */
export function planRun(
  extra = [],
  workers = resolveCiWorkers().workers,
  junitFile = "",
) {
  return {
    label: "全量单测 + 覆盖率棘轮（vitest run --coverage）",
    args: [
      "run",
      "test:coverage",
      `--maxWorkers=${workers}`,
      /* 分文件耗时读数（与钩子那一档同一份出口）。**放在 `extra` 之前、且不进 `extra`**：
       * `isWholeTrackRun(extra)` 把「透传了任何参数」判成「跑的不是整档、不记账」，
       * 而这一串是本档自己给 vitest 的读数参数、不是调用方在收窄范围 —— 塞错位置会让
       * 每一次 CI 全量跑都「绿了不记账」，等于把记账通道整个关掉。
       * 两个 reporter 一起给：只给 junit 会把人类可读的输出顶掉（真红那一屏是唯一能读
       * 的东西）。落点由调用点决定，文件名不在这里造第二份约定。 */
      ...(junitFile
        ? [
            "--reporter=default",
            "--reporter=junit",
            `--outputFile.junit=${junitFile}`,
          ]
        : []),
      ...extra,
    ],
  };
}

/**
 * 剔掉本脚本自己的开关，剩下的才是**人给的**透传参数。
 *
 * 为什么并发**不**进 `extra`：`isWholeTrackRun(extra)` 把「透传了任何参数」判成
 * 「跑的不是整档、不构成记账凭证」，而 `--maxWorkers` 是本档自己给 vitest 的、
 * 不是调用方在收窄范围。塞进 `extra` 会让每一次跑都「绿了但不记账」—— 那是把记账
 * 通道整个关掉，比不加并发严重得多。所以 `extra` 只装人给的参数，并发走
 * `planRun` 的第二个入参。
 *
 * @param {string[]} argv 原始参数
 * @returns {string[]}
 */
function passthrough(argv) {
  return argv.filter((a) => a !== "--dry-run");
}

/**
 * 分文件耗时榜 —— **读数**，不参与任何判定。
 *
 * 为什么要它在 CI 上打：本仓「哪一档最贵」此前只有一个 stage 级墙钟（分钟级那一格），
 * 而要把负载假红风险高的自测挪去定时那一跑，得先看得见**是哪几份文件**在吃时间。
 * 与钩子那侧共用 `parseJunitXml`（同一份形状，两份实现必漂）。
 *
 * 三条形制：① 只打前 `limit` 名 + 一句合计与其余之和 —— 全平台单次构建日志硬上限
 * 102400 字节，700 行明细会把**后面所有 stage 的日志**挤掉（覆盖率那格就是为此而设的）；
 * ② 明写「只算测试阶段、用来排序不当墙钟」，否则这串数会被读成 stage 墙钟的分解；
 * ③ 没有读数时打的是「没有」而不是「0 份」—— 这一跑被预算砍在收尾之前时，两者
 *    在日志里必须长得不一样（拿不到测量 ≠ 测量结果是 0，§13.6.4.1 同一条）。
 *
 * @param {string} xmlText junit XML 全文；读不到时调用方给空串
 * @param {{limit?: number, file?: string}} [opts]
 * @returns {string[]}
 */
export function suiteRanking(xmlText, { limit = 10, file = "" } = {}) {
  const where = file ? `（落点 ${file}）` : "";
  const entries = parseJunitXml(String(xmlText ?? ""));
  if (entries.length === 0) {
    return [
      `[full-suite-run] 分文件耗时读数：**没有** —— junit 未落盘或这一跑没跑到收尾${where}`,
    ];
  }
  const sorted = [...entries].sort((a, b) => b.ms - a.ms);
  const sum = entries.reduce((a, e) => a + e.ms, 0);
  const head = sorted.slice(0, limit);
  const headSum = head.reduce((a, e) => a + e.ms, 0);
  const mid = sorted[Math.floor(sorted.length / 2)]?.ms ?? 0;
  return [
    `[full-suite-run] 分文件耗时：${entries.length} 份、合计 ${(sum / 1000).toFixed(1)}s` +
      `（**只算测试阶段**，用来排序、不当 stage 墙钟）${where}`,
    ...head.map(
      (e) => `  ${`${(e.ms / 1000).toFixed(1)}s`.padStart(8)}  ${e.name}`,
    ),
    `  中位 ${(mid / 1000).toFixed(1)}s ｜ 其余 ${Math.max(0, entries.length - head.length)} 份合计 ${(
      (sum - headSum) /
      1000
    ).toFixed(1)}s`,
  ];
}

/**
 * 这一跑该不该记账 —— 抽成纯入口，好让「红了不记」这条边界能被真跑一次。
 *
 * 「绿」且「跑的是整档」才记：本档透传参数，`--help` / 指到单个文件都会退 0 而没跑
 * 完整档（形状判据三档共用一份，见 `freshness-ledger.mjs` 的 `isWholeTrackRun`）。
 *
 * @param {{exitCode: number, dryRun: boolean, extra?: string[]}} input
 * @returns {boolean}
 */
export function shouldRecord({ exitCode, dryRun, extra = [] }) {
  return exitCode === 0 && !dryRun && isWholeTrackRun(extra).ok;
}

/**
 * 本档的**墙钟预算** —— `runPnpmSync` 的 `timeoutMs`。
 *
 * 为什么必须显式给（ISSUE #1834）：缺省是 600_000（`launcher-core/shell.mjs` 的
 * `runPnpmSync`），而本档在 win32 检出上无争抢时实测就要 ~10 分钟（
 * `Test Files 3 failed | 695 passed`），只要有任何并发（叠一次运行、机器被别人占着）
 * 就正好撞在那个默认值上 —— 子进程在 600s 处被砍，`res.status` 为 null。
 *
 * 而 600_000 那个数是**别的调用方**的合理默认（单条 `pnpm exec …` 门禁），不该由它
 * 替本档背书：本档跑的是 698 份用例文件 + 覆盖率。
 *
 * 取 1800_000（30 分钟）而不是「实测值 + 一点余量」：它要挡的是**真挂死**，
 * 不是「机器慢」；20 分钟余量足够让一次并发的全量跑完（实测 10 分钟量级），
 * 又远小于「挂死」该被检出的时间（钩子那侧的时间型判据见 §13.6.4，那一条不在这里）。
 */
export const FULL_SUITE_TIMEOUT_MS = 30 * 60_000;

/* 「被预算砍 vs 判据红」的分流在 `launcher-core/shell.mjs` 的 `classifyOutcome()` /
 * `abortedAdvice()` —— **那件事只有一份实现**（§12.12）：本档、`artifact-run` 与
 * 未来的档都读它，各写一份就会在「谁把 `status ?? 1` 又写回去」上分叉。 */

/**
 * @param {string[]} argv
 * @returns {number}
 */
function main(argv) {
  const dryRun = argv.includes("--dry-run");
  /* 两条「不跑」的出路互斥地先处理：给了它们就不该再去起 vitest。 */
  for (const flag of /** @type {const} */ (["--skip", "--dirty"])) {
    const parsed = parseLedgerFlag(argv, flag);
    if (parsed.mode === "run") continue;
    if (parsed.reason === null) {
      process.stderr.write(
        `[full-suite-run] ✗ 理由（"${String(argv[argv.indexOf(flag) + 1] ?? "").trim()}"）` +
          "不算「有人回答过」—— 写清为什么（占位词与过短的理由都被拦）。\n" +
          `        用法：node scripts/full-suite-run.mjs ${flag} "本次只改文档，不动 src/"\n`,
      );
      return 2;
    }
    if (dryRun) {
      process.stdout.write(
        `[full-suite-run] 本次不跑、只记一条（${parsed.mode}）：${parsed.reason}\n`,
      );
      return 0;
    }
    return writeLedgerNote({
      root: ROOT,
      kind: "full",
      mode: parsed.mode,
      reason: parsed.reason,
    });
  }
  const extra = passthrough(argv);
  const load = resolveCiWorkers();
  /* 分文件耗时的落点。**先删再跑**：留在那儿的上一次结果会被当成这一轮的执行证据
   * （`check-known-failed-stale.mjs` 为此立过同一条口径 —— 假读数比没有读数坏）。
   * 落 `os.tmpdir()` 而不是仓库里：CI 的检出是一次性的，但 `pnpm test` 在本机也走这一份
   * 代码，写进检出就是给自己留一个未跟踪文件（R9 / `.gitignore` 那一套会判）。 */
  const junitFile = path.join(os.tmpdir(), "comfy-full-suite-junit.xml");
  try {
    fs.rmSync(junitFile, { force: true });
  } catch {
    /* 删不掉只意味着下面那份榜可能混进上一轮的读数 —— 而这一档是读数，不判红。
     * 真要在意的是「别拿上一轮冒充这一轮」，所以下面打印时把落点一起打出来。 */
  }
  const run = planRun(extra, load.workers, junitFile);
  if (load.note) process.stderr.write(`[full-suite-run] ${load.note}\n`);
  if (dryRun) {
    process.stdout.write(
      `[full-suite-run] ${run.label} → pnpm ${run.args.join(" ")}` +
        `（并发 ${load.workers}，按 ${load.cores} 逻辑核 / ${load.source}）\n`,
    );
    process.stdout.write(
      `[full-suite-run] 记账文件：${TRACK.ledger}（键 \`${TRACK.key}\`，跑法 \`${TRACK.run}\`）\n`,
    );
    return 0;
  }
  const res = runPnpmSync(run.args, {
    cwd: ROOT,
    stdio: "inherit",
    timeoutMs: FULL_SUITE_TIMEOUT_MS,
  });
  /* 榜打在**三态分流之前**：红的那一次与被预算砍的那一次，恰恰是最需要知道
   * 「是哪几份在吃时间」的两次。读不到只打一句「没有」，不抛 —— 它是读数。 */
  let junitText = "";
  try {
    junitText = fs.readFileSync(junitFile, "utf8");
  } catch {
    junitText = "";
  }
  for (const line of suiteRanking(junitText, { file: junitFile })) {
    process.stdout.write(`${line}\n`);
  }
  /* 三态分流：**「被预算砍」与「判据红」必须长得不一样**（`classifyOutcome`）。
   * 旧写法 `res.status ?? 1` 把两者都读成 1，于是「这次没测成」会被当成
   * 「这批用例红了」，下一个人去查用例、查一整天。 */
  if (classifyOutcome(res) === "aborted") {
    process.stderr.write(
      "[full-suite-run] ✗ " +
        abortedAdvice({
          label: "全量单测 + 覆盖率",
          timeoutMs: FULL_SUITE_TIMEOUT_MS,
        }) +
        `        （读数：退出码 ${res.status ?? "信号"}，` +
        `error=${res.error ? String(res.error.code ?? res.error.message) : "无"}）\n` +
        "        规范：docs/standards/13-提交与-code-review.md §13.5.4\n",
    );
    return 1;
  }
  const exitCode = res.status ?? 1;
  if (exitCode === 0 && !shouldRecord({ exitCode, dryRun, extra })) {
    /* **绿了但不记账**：这一跑透传了参数（`--help`、指到单个测试文件），跑的不是整档。
     * 下面那条「✗ 未通过（退出码 0）」是红的话术，拿它打这一拍会自相矛盾。 */
    process.stderr.write(
      `[full-suite-run] ` +
        notWholeTrackNotice({
          label: "全量单测 + 覆盖率",
          command: "pnpm test:coverage:tracked",
          why: isWholeTrackRun(extra).why,
        }),
    );
    return 0;
  }
  if (!shouldRecord({ exitCode, dryRun, extra })) {
    process.stderr.write(
      `[full-suite-run] ✗ 全量单测 / 覆盖率未通过（退出码 ${res.status ?? "信号"}）—— **不记账**：\n` +
        "        这条账记的是「上一次真跑绿」，红着记一条「我跑过」会把两件事混成一件。\n" +
        "        红的定性先按 §11.13 隔离重跑那条走，别把红当成「账没记上」。\n" +
        `        规范：docs/standards/13-提交与-code-review.md §13.5.4 / §11.7\n`,
    );
    return exitCode;
  }
  const { note } = writeFreshness({
    root: ROOT,
    kind: "full",
    who: gitUser(TRACK.key),
  });
  process.stdout.write(
    `[full-suite-run] ✓ 全量单测 + 覆盖率通过\n[full-suite-run] ${note}\n`,
  );
  return 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(main(process.argv.slice(2)));
}
