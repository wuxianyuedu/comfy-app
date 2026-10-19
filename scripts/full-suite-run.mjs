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
  PS_UNSAFE_ARG_RE,
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
 * @param {string} [junitFile] 分文件耗时读数的落点。**允许给绝对路径** —— 只要它落在
 *   仓库内，就会被换成相对路径再交给 vitest（原因见 {@link toTransportSafePath}）。
 * @returns {{label: string, args: string[]}}
 */
export function planRun(
  extra = [],
  workers = resolveCiWorkers().workers,
  junitFile = "",
) {
  /* 读数参数只在「调用方给了落点」时才加（与钩子那侧 `--junit-dir` 没递到就一个字都不加
   * 同一条口径 —— 让人自己跑的那档形态与此前逐字相同）。 */
  const junitArg = junitFile ? toTransportSafePath(junitFile) : "";
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
       * 的东西）。 */
      ...(junitArg
        ? [
            "--reporter=default",
            "--reporter=junit",
            `--outputFile.junit=${junitArg}`,
          ]
        : []),
      ...extra,
    ],
  };
}

/**
 * 把一个落点换成「**能安全穿过 PowerShell 宿主**」的形式。
 *
 * ## 为什么这层不是多余的谨慎（CI 实测）
 *
 * `每日单元测试` 第一次在平台侧触发就 12.6s 红（`cnb-2in-1k589j0kp`，2026-10-19 04:00），
 * 日志里那两行就是全部证据：
 *
 *   $ vitest run --coverage "--maxWorkers=4" "--reporter=junit" "--outputFile.junit=C" "\\WINDOWS\\TEMP\\comfy-full-suite-junit.xml"
 *   失败话术原文：No test files found, exiting with code 1 —— 切剩的那半截被 vitest 当成了
 *   位置过滤器（`filter: //WINDOWS/TEMP/…`）。
 *
 * 也就是 `--outputFile.junit=C:\WINDOWS\TEMP\a.xml` 到达 vitest 时**已经不是同一个参数**：
 * 从第一个冒号处切开，剩下的那半截变成一个**位置过滤器**，于是「一个用例都没匹配上」。
 * 本机逐形状复现过（`launcher-core/shell.mjs` 的 `PS_UNSAFE_ARG_RE` 头上那张表就是结果）：
 * 坏的是「破折号开头 + `=` + 值里有冒号」这一交集，而**裸绝对路径**（`C:\dir\a.xml` 单独一个
 * 参数）与 `out=C:\dir\a.xml`（不带破折号）都原样到达 —— 所以这一层的修法不是「别用绝对路径」，
 * 是「**值里不许有冒号**」。引号救不了：`pwsh -File` 不剥参数的引号（试过，包 `'…'`
 * 后脚本收到的是带引号的字面量）。
 *
 * ## 形状
 *
 *   · 仓库内 ⇒ 换成相对路径（vitest 按项目根解析；`node_modules/.cache/` 在被 ignore 的那一侧，
 *     所以既不会给检出留未跟踪文件，也不会像 `coverage/` 那样与覆盖率输出共用生命周期）；
 *   · 仓库外（`os.tmpdir()` 那种）⇒ **抛**，不静默换成一个可能不存在的位置：
 *     这条链的产物是要被 `collectFileTimings` / `suiteRanking` 读回去的，落点猜错的表现
 *     是「读数没有」，而「读数没有」与「这一档没跑过文件」在日志里很容易同形；
 *   · 换算出来仍含冒号 ⇒ 抛。走到这里说明常量被改坏了（判据与宿主那一跳**同一个谓词**，
 *     见 `launcher-core/shell.mjs` 的 `PS_UNSAFE_ARG_RE` —— 在这里抄一份正则就是两条会分叉的判据）。
 *
 * @param {string} target 绝对或相对路径
 * @returns {string} 交给 vitest 的形式（能安全拼进 `--outputFile.junit=`）
 */
export function toTransportSafePath(target) {
  const rel = path.isAbsolute(target)
    ? path.relative(ROOT, target).replaceAll("\\", "/")
    : target.replaceAll("\\", "/");
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `[full-suite-run] 分文件读数的落点必须落在仓库内：${target} —— ` +
        "绝对路径（`C:\\…` 那种）拼成 `--outputFile.junit=…` 之后，穿过 PowerShell 宿主时会在" +
        "**第一个冒号处被切成两个参数**，被切剩的那半截变成 vitest 的位置过滤器，" +
        "现场是「No test files found」而不是「文件不存在」。" +
        "仓库外的落点请改成 `node_modules/.cache/` 下的一份（它本来就在 ignore 面里）。",
    );
  }
  /* 判的是**拼好之后的那一个参数**，不是这段路径本身 —— 谓词与 `runPnpmSync` 拒答时用的
   * 是同一条，所以这里不会与宿主那一跳各说一套。 */
  if (PS_UNSAFE_ARG_RE.test(`--outputFile.junit=${rel}`)) {
    throw new Error(
      `[full-suite-run] 换算出来的落点拼进 --outputFile.junit= 之后仍然带冒号（${rel}），` +
        "不交给 vitest —— 机制与上面那条同一种（切点在第一个冒号）。",
    );
  }
  return rel;
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

/**
 * 分文件耗时读数的落点（相对仓库根）。**这一串里不许出现冒号** —— 它会被原样拼进
 * `--outputFile.junit=` 交给 vitest，而那条命令要穿过 PowerShell 宿主（破折号开头的
 * `--x=…` 一旦在 `=` 之后带冒号就会在那里被切成两个参数）。
 * 选 `node_modules/.cache/` 的理由（git 忽略面里、不与覆盖率的清理共用生命周期、
 * 且 CI 的一次性检出与本机 `pnpm test` 都能用同一份代码）写在 `main()` 那一段。
 */
export const SUITE_JUNIT_RELATIVE =
  "node_modules/.cache/comfy-full-suite-junit.xml";

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
   *
   * ⚠️ 落点在**仓库内**、并且交给 vitest 的是**相对路径** —— 不是随手挑的：CI 那一跑
   * 第一次用 `os.tmpdir()`（= `C:\WINDOWS\TEMP\…`）就 12.6s 红，PowerShell 宿主把
   * `--outputFile.junit=C:` 与剩下的路径切成两个参数（机制、逐形状复现与形状口径都写在
   * {@link toTransportSafePath} 的头注里）。`node_modules/.cache/` 在被 ignore 的那一侧，
   * 所以既不会给检出留未跟踪文件（R9 / `.gitignore` 那一套），也不会像 `coverage/`
   * 那样与覆盖率输出目录**共用生命周期**（覆盖率那一档 clean 时可能把它一起擦掉，
   * 表现正是「读数没有」—— 与「这一档没跑过文件」同形，最难查的那一种）。 */
  const junitFile = path.join(ROOT, SUITE_JUNIT_RELATIVE);
  try {
    fs.mkdirSync(path.dirname(junitFile), { recursive: true });
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
