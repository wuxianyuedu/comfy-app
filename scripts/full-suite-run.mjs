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
 * ## 覆盖率门槛：**默认只上报，不拦 CI**（ISSUE #2669，业主口径）
 *
 * 这一档过去天天红，而**用例一条都没红** —— 红在整体 / 目录级覆盖率低于登记值。
 * 那种红不产生任何可执行的结论，还把「整档凭证」永久卡在「不记账」上（红着不记 ⇒
 * 从上游四格解锁以来那份账一次都没刷新过）。业主的裁决与三条理由写在
 * `vitest.config.ts` 末尾那一节（无关文件改分母会红 / 删掉高覆盖的废弃模块反而红 /
 * 门槛卡住合并会诱导写「执行但不验证」的用例）；**该红的是 patch coverage**
 * —— 只量这次 diff 里新增改动的行，红一定能据此行动 —— 那是另一张单，不在这里顺手做。
 *
 * 落地形态刻意选「开关」而不是「删门槛」，因为可反：
 *   · 登记处（150 条门槛）**一条数字没动**，`vitest.config.ts` 的
 *     `COVERAGE_THRESHOLDS` 永远原样在场；
 *   · 默认档把「交给 vitest 判定」的那一份摘空 ⇒ 用例全绿就退 0、**照常记账**，
 *     覆盖率报告（`text` / `json-summary` / `lcov`）一个都不少，这是「上报」那一半；
 *   · 要按门槛判红：`--enforce-coverage` 或 `COMFY_COVERAGE_ENFORCE=1`
 *     （`pnpm check:all` 的 `test` 条目就显式带它 —— 本地那一档仍是棘轮的执行者，
 *     「只升不降」得有人真的算，见 `scripts/quality-gate.mjs`）。
 *
 * ⚠️ 这一档**不靠猜**「非零是不是覆盖率造成的」：默认档根本没有那个歧义 ——
 * 门槛不参与退码，非零就只用例红/崩负责，判决链比分类器短一截。
 *
 * 用法：
 *   node scripts/full-suite-run.mjs --dry-run       只打印本次会跑什么（无副作用）
 *   node scripts/full-suite-run.mjs --enforce-coverage   按登记门槛判红（本地硬档）
 *   node scripts/full-suite-run.mjs                 跑全量单测 + 覆盖率，绿了记一笔账
 *   node scripts/full-suite-run.mjs --skip "<理由>"  今天不跑，记一条写明理由的豁免
 *   node scripts/full-suite-run.mjs --dirty "<理由>" 这次改动不吃这一档，记一条
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { resolveCiWorkers } from "./ci-load.mjs";
import { pnpmCli } from "./ci-install-deps.mjs";
/* 分文件耗时的形状与钩子那一档**共用同一份解析**（`parseJunitXml`）：本地账本与 CI 日志
 * 报的是同一个量的两种形状，抄两份解析器就会在「谁把外层 `<testsuites>` 当成一个文件」
 * 这种地方分叉，而那类分叉只会让读数偏，不会让它红。 */
import { parseJunitXml, failingSuitesFromJunit } from "./precommit-timing.mjs";
/* 超时指纹与「等机器喘口气」这两件事**不重造**：判据与组 C 逐字同源
 * （`tests/hook-affected-launch.test.ts` 每天核对两份指纹清单不漂移），
 * 复跑面的命令行切分也复用组 C 那一份（`planLaunches` 管 argv 长度预算）。
 * 触发事实：`cnb-b0l-1k59op66t` 那一跑，`每日单元测试` 只有 1 份红
 * （`tests/deps-freshness-gate.test.ts:166` 超时 30s）就把后面的
 * `每日生产构建` / `每日浏览器安装` / `每日全量E2E` 三格全部 skip 掉 ——
 * 而那次红是调度排不上，不是断言报错。 */
import { isTimeoutShaped, waitForLoadToSettle } from "./affected-launch-load-retry.mjs";
import { planLaunches } from "./run-affected-tests.mjs";
/* 停用台账（ISSUE #2948）：全量档是「整档凭证」的口径，剔掉几条就不该再记账 ——
 * 那一半由下面 `--exclude` 的**在场**决定（见 `planRun` 的 `exclude` 一节）。 */
import { suspendedNames, suspendedReading } from "./suspended-gate-tests.mjs";
import { parseLedgerFlag, writeLedgerNote } from "./daily-run.mjs";
/* junit 落点的三态诊断（#2697）：抽出来单独成模块——full-suite-run.mjs 已过 900 行硬闸，
 * 且诊断逻辑是独立职责、值得被单测直接核。 */
import { junitFileDiag, findJunitReport, junitMissingLine } from "./junit-readout-diag.mjs";
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
  pushFreshnessLedger,
  writeFreshness,
} from "./freshness-ledger.mjs";

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..");

/** 本档的登记（账文件 / 键 / 名字 / 「怎么跑」那条命令）。 */
export const TRACK = freshnessTrack("full");

/**
 * 本次要跑的那条命令 —— 抽成纯函数是为了让「跑的是什么」可被判据核。
 *
 * 与 `pnpm run test:coverage` 逐字同形（`package.json` 里那一行是这条命令的历史入口）：
 * 覆盖率**报告**只在这一档产出 —— 单文件跑 `--coverage` 会把其余路径按 0% 算（§11.7）。
 * 「产出报告」与「拿门槛算退码」现在是两件事：后者由 `coverageGate` /
 * `COMFY_COVERAGE_ENFORCE` 决定，默认档不判（ISSUE #2669）。
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
 * @param {readonly string[]} [exclude] 停用台账要剔掉的用例（ISSUE #2948）。非空即意味着
 *   「这一跑不是整档」—— 调用点据此不记账（绿了也只是「剩下的那些绿了」，拿它去刷
 *   整档凭证比不刷更坏，与 `isWholeTrackRun` 拦「透传了参数」是同一条口径）。
 * @returns {{label: string, args: string[]}}
 */
export function planRun(
  extra = [],
  workers = resolveCiWorkers().workers,
  junitFile = "",
  exclude = [],
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
        ? ["--reporter=default", "--reporter=junit", `--outputFile.junit=${junitArg}`]
        : []),
      /* 停用台账：逐条一个旗标，与 `run-affected-tests.mjs` 的 `excludeArgs` 同一个形状
       * （拼成一个参数会让「剔了哪几条」在命令行上读不出来，而这一档的全部可见性就在
       * 那一行读数上）。空数组 ⇒ 一个字都不加。 */
      ...(exclude ?? []).filter(Boolean).flatMap((rel) => ["--exclude", rel]),
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
  /* 自己的旗标必须在这里摘掉，**不许**落到 `extra` 里：`isWholeTrackRun(extra)` 把
   * 「透传了任何参数」判成「跑的不是整档、不记账」—— 那会让每一次带
   * `--enforce-coverage` 的硬档跑绿了却不记账，正是 §13.5.4 说的那种自我拆账。 */
  return argv.filter((a) => a !== "--dry-run" && a !== "--enforce-coverage");
}

/**
 * 「这一档到底判不判覆盖率门槛」—— 只有一个判点，两处来源（旗标 / 环境变量）。
 *
 * 抽成函数是因为这句话**必须被念出来**（§13.5.25「降档永远要被读出来，不许冒充全套过了」）：
 * 默认档不判是业主口径，不是「跑过了且通过」；而硬档下如果还在念「没判」，
 * 就是话术与执行脱钩。读 ⇄ 执行同读数，两边共用这一个函数。
 *
 * @param {string[]} argv 原始参数
 * @param {Record<string, string | undefined>} [env] 传给子进程的那份环境
 * @returns {{enforce: boolean, reading: string}}
 */
export function coverageGate(argv, env = process.env) {
  const enforce = argv.includes("--enforce-coverage") || env.COMFY_COVERAGE_ENFORCE === "1";
  return {
    enforce,
    reading: enforce
      ? "[full-suite-run] 覆盖率门槛：**判**（按 `vitest.config.ts` 的登记处逐条算退码；本地/`check:all` 那一档）\n"
      : "[full-suite-run] 覆盖率门槛：**今天没判** —— 整体/目录级只上报（ISSUE #2669 业主口径）。\n" +
        "  这不是「门槛已通过」，是「这一维不参与退码」；覆盖率报告照常产出。\n" +
        "  要按门槛判红：`node scripts/full-suite-run.mjs --enforce-coverage`" +
        "（`pnpm check:all` 的 `test` 条目已带它）。\n",
  };
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
 * @param {string | null | undefined} xmlText junit XML 全文；读不到时调用方给空串 / undefined
 *   —— 这一档的整套「读不到就少说一条」口径都建立在这层兜底上。
 * @param {{limit?: number, file?: string, diag?: {foundElsewhere?: boolean, actualPath?: string, exists?: boolean, size?: number, mtime?: string|null, dirIsLink?: boolean, realDir?: string}}} [opts]
 * @returns {string[]}
 */
export function suiteRanking(xmlText, { limit = 10, file = "", diag } = {}) {
  const where = file ? `（落点 ${file}）` : "";
  const entries = parseJunitXml(String(xmlText ?? ""));
  if (entries.length === 0) {
    return junitMissingLine("分文件耗时", file, diag);
  }
  const sorted = [...entries].sort((a, b) => b.ms - a.ms);
  const sum = entries.reduce((a, e) => a + e.ms, 0);
  const head = sorted.slice(0, limit);
  const headSum = head.reduce((a, e) => a + e.ms, 0);
  const mid = sorted[Math.floor(sorted.length / 2)]?.ms ?? 0;
  return [
    `[full-suite-run] 分文件耗时：${entries.length} 份、合计 ${(sum / 1000).toFixed(1)}s` +
      `（**只算测试阶段**，用来排序、不当 stage 墙钟）${where}`,
    ...head.map((e) => `  ${`${(e.ms / 1000).toFixed(1)}s`.padStart(8)}  ${e.name}`),
    `  中位 ${(mid / 1000).toFixed(1)}s ｜ 其余 ${Math.max(0, entries.length - head.length)} 份合计 ${(
      (sum - headSum) /
      1000
    ).toFixed(1)}s`,
  ];
}

/**
 * 每份文件的**两份**时长：junit 里 `<testsuite time>`（该文件在 worker 里的总时长，
 * 即 vitest 的 `task.result.duration`）与其中所有 `<testcase time>` 之和（纯断言时长）。
 *
 * 为什么要第二份：vitest 在收尾自报的相位分解，三次独立读数都是 `tests 46–51%` 而
 * `setup 23–24% + environment 13–14% + import 12–13%` 合计约一半（`cnb-b0l-1k59op66t`
 * 2442.43s / `cnb-r0d-1k5a0348r` 2729.89s / 本地 1609.51s）。那四个百分数**没有名字**：
 * 它不说哪几份在交税，而没有名字就没法决定该治谁、还是只能切片绕开。
 *
 * ⚠️ **这份榜只量得到「文件内可见」的那一份税**。本地第一次对账（776 份）实测：
 * `Σ文件总时长 2793.6s = 断言 2724.0s + 69.6s` —— 也就是 `<testsuite time>` 基本等于
 * Σ`<testcase time>`（差 2%），vitest 报的那约一半 environment / import / setup **不在
 * junit 的每文件账上**。所以这一份读的是「哪几份在自己的钩子里干活」（实测三份占掉 90%：
 * `db-migrate-equivalence` 30.6s / `docs-candidate-hygiene` 21.4s /
 * `tailwind-source-roots` 10.3s），**它不回答「那 50% 归谁」** —— 把这句写进话术，
 * 是因为拿它当整笔税的分解读，正好会得出一个方向相反的结论（本仓第一次量就是这么错的）。
 *
 * 形状按 vitest 5.0.3 的实际输出定，两条已知边界写在下面 {@link suitePhaseTax} 的话术里
 * （自闭合的 `<testsuite/>` 不配对、以及「Σ文件总时长 ≠ 墙钟」那笔差额归谁）。
 *
 * @param {string | null | undefined} xml junit XML 全文（读不到时是空串 / undefined）
 * @returns {{name: string, totalMs: number, testsMs: number, cases: number}[]}
 */
export function parseJunitPhaseCosts(xml) {
  /** @type {{name: string, totalMs: number, testsMs: number, cases: number}[]} */
  const out = [];
  for (const m of String(xml ?? "").matchAll(
    /<testsuite\b(?<attrs>[^>]*)>(?<body>[\s\S]*?)<\/testsuite>/g,
  )) {
    const attrs = m.groups?.attrs ?? "";
    const body = m.groups?.body ?? "";
    const name = /\bname="(?<name>[^"]*)"/.exec(attrs)?.groups?.name;
    const total = /\btime="(?<total>[^"]*)"/.exec(attrs)?.groups?.total;
    if (!name || total === undefined) {
      continue;
    }
    const totalSecs = Number(total);
    if (!Number.isFinite(totalSecs) || totalSecs < 0) {
      continue;
    }
    let testsMs = 0;
    let cases = 0;
    for (const c of body.matchAll(/<testcase\b[^>]*?\btime="(?<time>[0-9.eE+-]+)"/g)) {
      const secs = Number(c.groups?.time);
      if (!Number.isFinite(secs) || secs < 0) {
        continue;
      }
      testsMs += secs * 1000;
      cases += 1;
    }
    out.push({
      name,
      totalMs: Math.round(totalSecs * 1000),
      testsMs: Math.round(testsMs),
      cases,
    });
  }
  return out;
}

/**
 * 分文件**装载税**榜 —— 同样是读数，不参与任何判定。
 *
 * 三条形制与 {@link suiteRanking} 同一条（日志 102400 字节上限、只打前 N 名、
 * 读不到时打「没有」而不是「0 份」）。这里再加两条对账，因为这份数**天生对不平**：
 *
 * ① **Σ文件总时长 ≠ stage 墙钟**。差额是并发摊薄（一条 4 个 worker，四份文件的
 * 时长在墙钟上只算一次）与非文件阶段（globalSetup、覆盖率报告生成）。所以墙钟只作为
 * 下界一起打出来，不做除法 —— 拿一个对不平的分母去算「税占多少 %」会读出一个假比例。
 * ② **税可能为负**。junit 的用例时长是各自测的，一条用例在 `afterEach` 里等到的东西
 * 可能同时被算进两份数里；出现负数就照实打，不夹到 0（夹了就是拿形状掩盖机制）。
 *
 * @param {string | null | undefined} xmlText junit XML 全文；读不到时调用方给空串 / undefined
 * @param {{limit?: number, file?: string, wallMs?: number | null, diag?: {foundElsewhere?: boolean, actualPath?: string, exists?: boolean, size?: number, mtime?: string|null, dirIsLink?: boolean, realDir?: string}}} [opts]
 * @returns {string[]}
 */
export function suitePhaseTax(xmlText, { limit = 10, file = "", wallMs = null, diag } = {}) {
  const where = file ? `（落点 ${file}）` : "";
  const entries = parseJunitPhaseCosts(String(xmlText ?? ""));
  if (entries.length === 0) {
    return junitMissingLine("装载税", file, diag);
  }
  const withTax = entries.map((e) => ({ ...e, taxMs: e.totalMs - e.testsMs }));
  const sorted = [...withTax].sort((a, b) => b.taxMs - a.taxMs);
  const sumTotal = withTax.reduce((a, e) => a + e.totalMs, 0);
  const sumTests = withTax.reduce((a, e) => a + e.testsMs, 0);
  const sumTax = sumTotal - sumTests;
  const head = sorted.slice(0, limit);
  const headTax = head.reduce((a, e) => a + e.taxMs, 0);
  /** @param {number} ms @returns {string} */
  const secs = (ms) => (ms / 1000).toFixed(1);
  return [
    `[full-suite-run] 装载税：${entries.length} 份、Σ文件总时长 ${secs(sumTotal)}s` +
      ` = 断言 ${secs(sumTests)}s + 装载/钩子 ${secs(sumTax)}s` +
      `（占 Σ 的 ${sumTotal === 0 ? "0" : ((sumTax / sumTotal) * 100).toFixed(0)}%）${where}`,
    ...head.map(
      (e) =>
        `  税 ${`${secs(e.taxMs)}s`.padStart(8)}  总 ${`${secs(e.totalMs)}s`.padStart(
          8,
        )}  断言 ${`${secs(e.testsMs)}s`.padStart(8)}  ${e.name}`,
    ),
    `  中位税 ${secs(sorted[Math.floor(sorted.length / 2)]?.taxMs ?? 0)}s ｜ 其余 ${Math.max(
      0,
      entries.length - head.length,
    )} 份合计 ${secs(sumTax - headTax)}s`,
    wallMs
      ? `[full-suite-run] 对账：本档墙钟 ${secs(wallMs)}s，Σ文件总时长 ${secs(sumTotal)}s` +
        " —— 差额是并发摊薄（worker 数由 `resolveCiWorkers()` 按现场核数定，见上面那行读数）" +
        "与非文件阶段（globalSetup / 覆盖率报告）。**这一档不把它摊到任何一份文件上**，" +
        "所以两数不相等不是坏读数；拿它做除法才会。"
      : "",
  ].filter((l) => l !== "");
}

/**
 * 这一跑该不该记账 —— 抽成纯入口，好让「红了不记」这条边界能被真跑一次。
 *
 * 「绿」且「跑的是整档」才记：本档透传参数，`--help` / 指到单个文件都会退 0 而没跑
 * 完整档（形状判据三档共用一份，见 `freshness-ledger.mjs` 的 `isWholeTrackRun`）。
 *
 * ⚠️ 「整档」有**两个**拆法（ISSUE #2948）：调用方在命令行这一侧收窄（透传参数），
 * 与这一档自己按停用台账剔掉几条（`exclude`）。后者同样是「跑的不是整档」——
 * 拿它去刷整档凭证比不刷更坏，所以判别口径合并成一处（`extra` 空 **且** `exclude` 空）。
 *
 * @param {{exitCode: number, dryRun: boolean, extra?: string[], exclude?: readonly string[]}} input
 * @returns {boolean}
 */
export function shouldRecord({ exitCode, dryRun, extra = [], exclude = [] }) {
  if ((exclude ?? []).length > 0) {
    return false;
  }
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
 * 复跑那一趟的墙钟预算。刻意**小于**整档那一跑：复跑面按定义只含红的那几份，
 * 给它整档的预算等于允许这一格悄悄变成第二次全量。
 */
export const RERUN_TIMEOUT_MS = 12 * 60_000;

/**
 * 分文件耗时读数的落点（相对仓库根，会被 `toTransportSafePath` 换成相对路径交给 vitest）。
 * **这一串里不许出现冒号** —— 它会被原样拼进 `--outputFile.junit=` 交给 vitest，而那条命令
 * 要穿过 PowerShell 宿主（破折号开头的 `--x=…` 一旦在 `=` 之后带冒号就会在那里被切成两个参数）。
 * 选 `.comfy-ci/` 的理由（ISSUE #2697）：**不在 `node_modules` 那一侧** —— CI 节点的
 * `node_modules` 是缓存槽的链接，vitest 按自己的 `config.root` 解析后写到的物理文件，
 * 与父进程按 `path.join(ROOT, …)` 读到的不一定是同一个（日志里 L815 写、L830 读不到，
 * 同屏矛盾）。`.comfy-ci/` 是仓库内一份**普通目录（非链接）**，且在 `.gitignore` 里
 * （不入库、也不与 `coverage/` 共用清理生命周期）。换落点的口径与 `.gitignore` 一起改
 * （别只改路径）—— 见 `.gitignore` 的 `.comfy-ci/` 条目。
 */
export const SUITE_JUNIT_RELATIVE = ".comfy-ci/comfy-full-suite-junit.xml";

/* 「被预算砍 vs 判据红」的分流在 `launcher-core/shell.mjs` 的 `classifyOutcome()` /
 * `abortedAdvice()` —— **那件事只有一份实现**（§12.12）：本档、`artifact-run` 与
 * 未来的档都读它，各写一份就会在「谁把 `status ?? 1` 又写回去」上分叉。 */

/**
 * @param {string[]} argv
 * @returns {number}
 */
/**
 * 第 2 遍该不该跑、跑哪几份 —— 档位表与组 C 逐字同一张（规范 §13.6.4 / §13.6.4.1）：
 *
 * | 第一跑的形态                       | 动作                            |
 * | ---------------------------------- | ------------------------------- |
 * | 绿                                 | 不复跑（没有要定性的红）        |
 * | 红、**不带**超时指纹               | **一次都不复跑**，真红照拦      |
 * | 红、带指纹、读得出失败名单         | 只复跑那几份（串行、不抬预算）  |
 * | 红、带指纹、读不出名单             | **退回整档**（方向单边化）      |
 *
 * 退回整档那一行是刻意的：漏跑一份真失败的文件，比多跑一批已经绿过的文件贵得多。
 * 这一层**只回答「跑哪几份」**——旗标、预算、结论档位都不在这里定。
 *
 * @param {{exitCode: number, junitText: string}} input
 * @returns {{retry: boolean, files: string[], why: string}} `why` 要说出口
 */
export function planIsolatedRerun(input) {
  const { exitCode, junitText } = input;
  if (exitCode === 0) {
    return { retry: false, files: [], why: "这一跑是绿的，没有要定性的红" };
  }
  if (!isTimeoutShaped(junitText)) {
    return {
      retry: false,
      files: [],
      why: "红的形态里没有超时 / worker 起不来指纹 ⇒ 按真红处置，不复跑",
    };
  }
  const failed = failingSuitesFromJunit(junitText);
  if (failed.length === 0) {
    return {
      retry: true,
      files: [],
      why: "带超时指纹，但 junit 里一份失败名单都读不出 ⇒ 退回整档串行复跑",
    };
  }
  return {
    retry: true,
    files: failed,
    why: `只复跑第 1 遍里失败的那 ${failed.length} 份`,
  };
}

/**
 * 复跑之后的三态。判据只看**第二遍自己的输出形态**（不看 `os.loadavg()`，ISSUE #1747）：
 *
 *   · `load-flake` —— 第二遍绿 ⇒ 刚才那次是负载假红；
 *   · `unverified` —— 第二遍**仍**带指纹 ⇒ 这台机器此刻给不出可信读数，
 *     **不是绿也不是红**，放行但必须点名；
 *   · `real-red` —— 第二遍指纹消失 ⇒ 真红，照拦。
 *
 * @param {{exitCode: number, output: string}} input
 * @returns {"load-flake" | "unverified" | "real-red"}
 */
export function classifyRerunOutcome(input) {
  if (input.exitCode === 0) {
    return "load-flake";
  }
  return isTimeoutShaped(input.output) ? "unverified" : "real-red";
}

/**
 * 复跑那一趟的命令行（**不带 `--coverage`**，这是刻意的）：覆盖率门槛
 * （`vitest.config.ts` 的 `coverage.thresholds`）判的是**整档**的分子分母，
 * 拿一份子集去跑覆盖率必然跌破门槛，那会把「负载假红」换成一条**新的假红**。
 * 串行那一半（`--no-file-parallelism`）是本档唯一允许的降负载手段，
 * **预算一个都不抬**（`testTimeout` 由 `vitest.config.ts` 说）。
 *
 * 名单为空 = 不加位置过滤器 = 整档（与 `planIsolatedRerun` 那行「退回整档」同一语义；
 * 不拿 `"."` 当过滤器，那是另一种匹配语义）。argv 超预算时由组 C 那份
 * `planLaunches` 切成多趟，一趟只跑一段。
 *
 * @param {{files: string[]}} input
 * @returns {string[][]} 每条是一趟 `vitest run …` 的参数
 */
export function rerunLaunches(input) {
  const { files } = input;
  const head = ["run", "--no-file-parallelism"];
  if (files.length === 0) {
    return [head];
  }
  return planLaunches(files).map((chunk) => [...head, ...chunk]);
}

/** @param {string[]} argv */
async function main(argv) {
  const dryRun = argv.includes("--dry-run");
  /* 两条「不跑」的出路互斥地先处理：给了它们就不该再去起 vitest。 */
  for (const flag of /** @type {const} */ (["--skip", "--dirty"])) {
    const parsed = parseLedgerFlag(argv, flag);
    if (parsed.mode === "run") {
      continue;
    }
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
   * {@link toTransportSafePath} 的头注里）。落点选 `.comfy-ci/`（ISSUE #2697）：它
   * **在 `node_modules` 那一侧之外** —— CI 节点的 `node_modules` 是缓存槽的链接，
   * vitest 按自己的 `config.root` 解析后写到的物理文件，与父进程按 `path.join(ROOT,…)`
   * 读到的不一定是同一个（日志里 L815 写、L830 读不到，同屏矛盾）。`.comfy-ci/` 是仓库内
   * 一份普通目录（非链接）、且在 `.gitignore` 里，所以既不会给检出留未跟踪文件（R9），
   * 也不会像 `coverage/` 那样与覆盖率输出目录**共用生命周期**。换落点的口径与 `.gitignore`
   * 那一条一起改（别只改路径）。 */
  const junitFile = path.join(ROOT, SUITE_JUNIT_RELATIVE);
  try {
    fs.mkdirSync(path.dirname(junitFile), { recursive: true });
    fs.rmSync(junitFile, { force: true });
  } catch {
    /* 删不掉只意味着下面那份榜可能混进上一轮的读数 —— 而这一档是读数，不判红。
     * 真要在意的是「别拿上一轮冒充这一轮」，所以下面打印时把落点一起打出来。 */
  }
  /* 停用台账（ISSUE #2948）：平台这一档里暂不执行的三条（业主口径「先临时关掉，
   * 后面再开」）在这里剔掉 —— 名字留在固定清单里，剔的只是这一跑的收集面。
   * ⚠️ 别把这句读成「本地钩子照跑」（ISSUE #2957 就是来堵它的）：固定清单的本地执行者是
   * 组 C，而它在 `.githooks/pre-commit` 的 `run_group()` 里对 `C` 写 `.skip` 后 `return 0`
   * （2026-10-20 撤的，`COMFY_HEAVY_GATES=1` 也换不回来）。⇒ 停用期间这三条用例文件
   * 没有自动执行者，事实由台账的 `executorsNow: []` 明写、由
   * `tests/suspended-gate-tests.test.ts` 与钩子对账。剔了就不记账（`planRun` 的
   * `exclude` 一节），并把这个缺口说在明处。 */
  const suspended = [...suspendedNames()];
  process.stderr.write(suspendedReading(suspended));
  if (suspended.length > 0) {
    process.stderr.write(
      `[full-suite-run] ○ 这一跑剔掉了 ${suspended.length} 条（ISSUE #2948 的停用台账）` +
        " ⇒ **不构成整档凭证、不记账**：\n" +
        "  绿只说明「剩下的那些绿了」，拿它去刷整档凭证比不刷更坏（同 `isWholeTrackRun` 那一档）。\n",
    );
  }
  const run = planRun(extra, load.workers, junitFile, suspended);
  if (load.note) {
    process.stderr.write(`[full-suite-run] ${load.note}\n`);
  }
  const gate = coverageGate(argv);
  /* 先念档位再起子进程：这一档墙钟是分钟级，起完之后才念等于让读的人在十分钟里
   * 猜「门槛到底算了没有」（#2574 那条「几百 MB 那一跳长得像卡死」是同一件事的另一直角）。 */
  process.stdout.write(gate.reading);
  if (dryRun) {
    process.stdout.write(
      `[full-suite-run] ${run.label} → pnpm ${run.args.join(" ")}` +
        `（并发 ${load.workers}，按 ${load.cores} 逻辑核 / ${load.source}）\n`,
    );
    process.stdout.write(
      `[full-suite-run] 记账文件：${TRACK.ledger}（键 \`${TRACK.key}\`，跑法 \`${TRACK.run}\`）\n`,
    );
    /* `--dry-run` 也要念档位那句：它唯一的用途就是「这次会跑什么」，而「覆盖率判不判」
     * 是那条命令的一半内容 —— 不念出来，读的人会以为那 150 条门槛在算退码。 */
    return 0;
  }
  const wallStart = Date.now();
  /* 平台节点上 PATH 里没有 pnpm（服务账号会话，ISSUE #2281）：先找落点再起，
   * 形态仍只有 `pnpmCli` 一份实现。 */
  const cli = pnpmCli();
  const res = runPnpmSync(run.args, {
    cwd: ROOT,
    stdio: "inherit",
    command: cli,
    timeoutMs: FULL_SUITE_TIMEOUT_MS,
    /* 开关交给子进程（`vitest.config.ts` 末尾那一节读它），本进程不改任何配置文件。 */
    env: gate.enforce ? { ...process.env, COMFY_COVERAGE_ENFORCE: "1" } : process.env,
  });
  const wallMs = Date.now() - wallStart;
  /* 榜打在**三态分流之前**：红的那一次与被预算砍的那一次，恰恰是最需要知道
   * 「是哪几份在吃时间」的两次。读不到只打一句「没有」，不抛 —— 它是读数。
   * 但「没有」要能分出三种状态（#2697）：没落盘 / 落了但按原路径读不到（回退找回）/
   * 落了但解析 0 份。下面先找报告（预期落点缺失时回退到候选目录），再带 diag 进去。 */
  const found = findJunitReport(junitFile);
  let junitText;
  try {
    junitText = fs.readFileSync(found.path, "utf8");
  } catch {
    junitText = "";
  }
  const diag = {
    ...junitFileDiag(junitFile),
    foundElsewhere: found.drifted,
    actualPath: found.path,
  };
  for (const line of suiteRanking(junitText, { file: junitFile, diag })) {
    process.stdout.write(`${line}\n`);
  }
  /* 第二份榜：断言之外的税摊到文件上（vitest 自报的四个相位百分数没有名字，
   * 而没有名字就没法决定该治谁、还是只能切片绕开）。 */
  for (const line of suitePhaseTax(junitText, {
    file: junitFile,
    wallMs,
    diag,
  })) {
    process.stdout.write(`${line}\n`);
  }
  /* 三态分流：**「被预算砍」与「判据红」必须长得不一样**（`classifyOutcome`）。
   * 旧写法 `res.status ?? 1` 把两者都读成 1，于是「这次没测成」会被当成
   * 「这批用例红了」，下一个人去查用例、查一整天。 */
  if (classifyOutcome(res) === "aborted") {
    process.stderr.write(
      `[full-suite-run] ✗ ${abortedAdvice({
        label: "全量单测 + 覆盖率",
        timeoutMs: FULL_SUITE_TIMEOUT_MS,
        /* 三态读数原值带过去（ISSUE #3332）：判据在 abortedAdvice 一处，这里不重判。 */
        signal: res.signal ?? null,
        errorCode: res.error?.code ?? null,
      })}        （读数：退出码 ${res.status ?? "无"}，信号 ${res.signal ?? "无"}，` +
        `error=${res.error ? String(res.error.code ?? res.error.message) : "无"}）\n` +
        `        规范：docs/standards/13-提交与-code-review.md §13.5.4\n`,
    );
    return 1;
  }
  const exitCode = res.status ?? 1;
  /* ── 超时指纹的隔离复跑（组 C 那一档补到每日这一跑上）──────────────────
   * 为什么这一格必须有：每日链是**串行失败即停**，而 `每日单元测试` 排最后 ——
   * 它之前每一格都吃过「一份文件排不上调度、把整档拖成红」的那次
   * （触发事实 `cnb-b0l-1k59op66t`：只有 `tests/deps-freshness-gate.test.ts:166`
   * 一条 `Test timed out in 30000ms`，没有任何断言报错）。
   * 判决链在这里**不重写**：档位表在 `planIsolatedRerun` / `classifyRerunOutcome`，
   * 指纹清单与等待都 import 组 C 那两份模块（两份清单漂移由
   * `tests/hook-affected-launch.test.ts` 钉着）。
   * 只在**整档那一跑**上启用：透传过参数的那次本来就不构成凭证，再复跑一遍
   * 只是把一个不可信的读数变成两个。 */
  if (exitCode !== 0 && shouldRecord({ exitCode, dryRun, extra })) {
    const plan = planIsolatedRerun({ exitCode, junitText });
    if (plan.retry) {
      process.stderr.write(
        `[full-suite-run] 红里带超时指纹 ⇒ 按 §13.6.4 先当负载读数看：${plan.why}。\n` +
          "  先等机器喘口气，再 `--no-file-parallelism` 串行复跑（**不抬任何预算**）…\n",
      );
      const settled = await waitForLoadToSettle();
      process.stderr.write(
        settled.waitedMs === 0
          ? `[full-suite-run] 没等（第一读数就已回落：每核 ${settled.load.toFixed(2)}）` +
              " ⇒ 第二遍与第一遍几乎同条件，它只能证伪「真断言红」，不能证明负载已散\n"
          : `[full-suite-run] 等了 ${(settled.waitedMs / 1000).toFixed(1)}s` +
              `${settled.settled ? `（每核负载回落到 ${settled.load.toFixed(2)}）` : " 没等到回落"}\n`,
      );
      /** @type {{status: number, output: string}} */
      const rerun = rerunLaunches({ files: plan.files }).reduce(
        (acc, args) => {
          if (acc.status !== 0) {
            return acc;
          }
          const res2 = runPnpmSync(["exec", "vitest", ...args], {
            cwd: ROOT,
            stdio: "pipe",
            command: cli,
            timeoutMs: RERUN_TIMEOUT_MS,
          });
          /* `runPnpmSync` 的 `stdout` / `stderr` 在起不来时是空串（它自己兜过），
           * 但本处是**注入面**（用例会换掉 `runPnpmSync`）—— 这层 `??` 仍在。 */
          const out = `${String(res2.stdout ?? "")}\n${String(res2.stderr ?? "")}`;
          return {
            status: res2.status ?? 1,
            output: `${acc.output}\n${out}`.slice(-24_000),
          };
        },
        { status: 0, output: "" },
      );
      const verdict = classifyRerunOutcome({
        exitCode: rerun.status,
        output: rerun.output,
      });
      if (verdict === "load-flake") {
        process.stderr.write(
          "[full-suite-run] **第 2 遍全绿** ⇒ 刚才那次是**负载假红**（同一批用例在更隔离的\n" +
            "  条件下重测的结果，不是「放宽了判据」）。本档退 0，但**不记账** ——\n" +
            "  这条账记的是「整档那一跑跑绿过」，而第 2 遍没带覆盖率那一半（更没带门槛判定）。\n" +
            "  降负载的杠杆是并发（`maxWorkers` / 串行），不是 `testTimeout`。\n",
        );
        return 0;
      }
      if (verdict === "unverified") {
        const named = plan.files.length
          ? plan.files.map((f) => `    · ${f}\n`).join("")
          : "    · （读不出名单，整档这一跑都没拿到可信读数）\n";
        process.stderr.write(
          `[full-suite-run] ⚠️ **第 2 遍仍然只是超时形态** —— 这台机器此刻给不出可信读数，\n` +
            `  本次这些文件记为**未校验**：既不是绿（没有证据说它过），也不是红\n` +
            `  （失败的是调度，没有一条断言报错）。退 0 放行，**不记账**，逐条点名：\n${
              named
            }  ⚠️ 这一档**不许**写成「已通过」；它等价于「这次没测」（ISSUE #1747）。\n` +
            `  **不要**抬 testTimeout，也**不要** --no-verify。\n`,
        );
        return 0;
      }
      process.stderr.write(
        "[full-suite-run] **第 2 遍指纹已消失**（不再是调度形态）⇒ 这不是负载假红，按真红处置。\n" +
          "  红的归属先用 `node scripts/base-check.mjs <拦住你的那条>` 复算，再决定修代码还是登记。\n" +
          "  下面贴第 2 遍输出的尾部（最多 24000 字符，串行的那份读数才是该看的现场）：\n" +
          `${rerun.output.slice(-24_000)}\n`,
      );
    }
  }
  if (exitCode === 0 && !shouldRecord({ exitCode, dryRun, extra, exclude: suspended })) {
    /* **绿了但不记账**：这一跑透传了参数（`--help`、指到单个测试文件）、或按停用台账
     * 剔掉了几条（ISSUE #2948），跑的不是整档。下面那条「✗ 未通过（退出码 0）」是红的
     * 话术，拿它打这一拍会自相矛盾。 */
    process.stderr.write(
      `[full-suite-run] ${notWholeTrackNotice({
        label: "全量单测 + 覆盖率",
        command: "pnpm test:coverage:tracked",
        why:
          isWholeTrackRun(extra).why ??
          `本次按停用台账剔掉了 ${suspended.length} 条（ISSUE #2948）—— 跑的不是整档`,
      })}`,
    );
    return 0;
  }
  /* 只判「红 ⇒ 不记账」：`!shouldRecord({…})` 在小结这一侧是**假绿**的陷阱 —— 剔了几条
   * （或透传了参数）的那次跑绿了，它会走到这里打一句「未通过 / 退出码 0」。上面那两条
   * 已经各自把「绿且不记账」的口径说完并返回了，这里只剩红着的那一半。 */
  if (!shouldRecord({ exitCode, dryRun, extra, exclude: suspended })) {
    process.stderr.write(
      `[full-suite-run] ✗ 全量单测未通过（退出码 ${res.status ?? "信号"}）—— **不记账**：\n` +
        "        这条账记的是「上一次真跑绿」，红着记一条「我跑过」会把两件事混成一件。\n" +
        /* 默认档下覆盖率门槛**不参与退码**（ISSUE #2669），所以这一行的成因只剩用例与
         * 崩溃两类 —— 话术不许再把它写成「覆盖率未通过」，那会把读的人派去查一份
         * 根本不红的东西（而硬档下这么说是准确的，所以这句跟着档位念）。 */
        `        本档覆盖率判定：${gate.enforce ? "判（门槛可能是这一跳的成因之一）" : "没判（这一跳与覆盖率无关）"}\n` +
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
    `[full-suite-run] ✓ 全量单测通过 —— 覆盖率那一半：${
      gate.enforce ? "判过，且逐条达到登记值" : "只上报，没判（ISSUE #2669）"
    }\n[full-suite-run] ${note}\n`,
  );
  /* 回写机器自有分支 `ci/freshness-ledger`（ISSUE #2247）；仅每日档置
   * `FRESHNESS_LEDGER_PUSH=1` 时真正推，否则 no-op。 */
  const freshPush = pushFreshnessLedger({ root: ROOT, kinds: ["full"] });
  if (freshPush.pushed) {
    process.stdout.write("[full-suite-run] ✓ 新鲜度账已回写机器分支 ci/freshness-ledger\n");
  } else if (freshPush.reason && freshPush.reason !== "opt-out") {
    process.stdout.write(`[full-suite-run] （新鲜度账回写未执行：${freshPush.reason}）\n`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exit(await main(process.argv.slice(2)));
}
