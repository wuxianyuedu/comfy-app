#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本：无类型消费方，tsc 面在 src/**
/**
 * run-affected-tests.mjs — 把「固定清单 + 受影响用例」真正起起来的那一步
 *
 * 干什么：调 `scripts/affected-tests.mjs` 拿清单，然后**用 Node 直接 spawn vitest 的
 * ESM 入口**跑完它们，保住钩子原有的两个约定：一次提交只起一次 vite、
 * 钩子档单独用 `--maxWorkers=4`。
 *
 * 为什么要单独有这一层（不是随手加的包装）：清单是**位置参数**拼进命令行的，而
 * `pnpm exec <bin>` 在 Windows 上经 `.cmd` shim —— 那条链的命令行上限是 cmd.exe 的
 * **8191 字符**。实测一次改了 22 个文件的提交，清单是 10840 个字符：vitest 根本没起，
 * stdout 只有一行 GBK 乱码（「文件名或扩展名太长」），钩子的表现是「组 C 失败」
 * 而看不见任何用例名。
 * 这不是「某个用例红」，而是**门禁自己静默失效**的那一类：判据在场、跑的是 0 个用例、
 * 退出码非零但原因读不出 —— 换任何一个改动面更大的提交都会再撞一次。
 *
 * 现在的链路：`node` → `spawnSync(process.execPath, [vitest 入口, …])`，不经 cmd.exe，
 * 上限回到 Win32 `CreateProcess` 的 32767。同时按 `SAFE_ARGV_BUDGET` 预算**分块**：
 * 宁可多起一次 vite，也不许把用例丢掉 —— 「绿但没跑」比慢严重得多（口径同规范
 * §11.13「skip 不作为信号被任何门禁计数」那一族的反面）。
 *
 * ⚠️ **但「改动面」本身不进 argv**（ISSUE #2240）：上面那条分块讲的是
 * **vitest 那一跳**的命令行，而**改动面**那一跳早先是逐个把路径铺进 argv
 * ⇒ 改动面大到几千条时（实测 2672 条 / 172796 字符）那个子进程**根本起不来**
 * （`ENAMETOOLONG`、`status=null`）⇒ 平台「受影响用例」那一格红在
 * 「清单解析失败（退出码 信号）」，后面 22 个 stage 全 `skipped`。
 * 现在改动面走 **stdin**（`--changed-stdin`）：判决链一个字没动，换的只是载体 ——
 * 那一跳住在 `scripts/affected-launch-changed-list.mjs`（理由写在那份文件头）。
 *
 * 刻意**不做**的事：
 *   · 不在这里算清单 —— 收窄规则的唯一出处仍是 `affected-tests.mjs`，本文件只管启动；
 *   · 不兜「空清单」：空集会让 `vitest run` 不带位置参数跑成**全量**，那是更坏的失效，
 *     所以宁可阻断（与收口前钩子里那句 `if [ -z "$files" ]` 同一口径，只是现在有了名字）。
 *
 * ── 第二条档位：`--full`（显式全量，ISSUE #1393 签字要求的那个前置）──────────
 *
 * 上面那条「不兜空清单」讲的是**意外**的全量；而 `--full` 是**按名字**要的全量：
 * 跳过暂存区解析、不拼位置参数，由 vitest 自己收集全部用例。
 *
 * 为什么必须有这一档（不是「装个开关」）：`affected-tests.mjs` 命中公共地基
 * （`vitest.config.ts` / `tests/setup.ts` / lockfile / `tsconfig.json` / `.githooks/**`）时
 * **放弃收窄**、只跑固定清单，而这条兜底此前**没有具名出口** —— 规范 §13.5.8 把
 * 「先造一条显式的全量通道」写成了重开兜底的前置条件，缺的就是本档。有了它：
 *   · wide 话术与钩子日志能指向一条**跑得响**的命令（不再让人自己猜「全量怎么跑」）；
 *   · 它与「空参数 = 谁都没筛过」在退出码与日志上都可分辨 —— 后者仍然阻断。
 *
 * ⚠️ `--full` **不接进钩子**（钩子里只有增量档）：它是人按需要的那一档，
 * 埋进每次提交就是把钩子变成半小时的仪式。它复用同一条判决链（超时形态照样
 * 等负载回落 + `--no-file-parallelism` 隔离复跑），所以「机器太满」不会在这里变成结论。
 *
 * ── 负载自适应：超时形态的失败要**自动隔离复跑**，不再把提交拦在这里 ────────
 *
 * 现场（实测，8 核容器）：同一份代码、同一个提交，空闲时这批 67 个用例 21s 全绿；
 * 把机器压到 load≈77 时 `tests/ratchet-update-guards.test.ts` 报
 * `Test timed out in 120000ms`（`--no-file-parallelism` 隔离复跑立刻全绿）——
 * 门禁把一次**调度抖动**读成了结论，而提交被拦下了。
 *
 * 这件事在规范里**早有口径**（§13.6.4 / `base-check` 的第五态 `load-flake`），
 * 缺的是执行者：那一节写的下一动作是「隔离复跑定性」，而那一步此前**只有人能跑**
 * —— 被拦下的人得先想到 `base-check`、再手敲 `--no-file-parallelism`，才知道
 * 那是不是假红。钩子这一侧没有任何负载自适应：超时就是终局。
 *
 * 所以这里给它补上执行者，且**只补「重新测一次」这一半**（判决口径一个字不改）：
 *
 *   · 触发面窄：本块失败、**且输出带超时指纹**（`TIMEOUT_SIGNATURES`，与
 *     `base-check.mjs` 逐条同源）时才复跑。真断言红（`AssertionError`）不带指纹，
 *     一次都不复跑 —— 那正是这一档要挡的东西。
 *   · 复跑**只能更隔离，不能更松**：`--no-file-parallelism`（单进程串行）+ 同一份
 *     清单。**不抬任何预算**（§11.13 那句「看到 60s 都超时不要改成 120s」是本条的
 *     主要敌人）：抬预算会把「真挂死」的检出时间一起放大，而串行是**降负载**。
 *   · 复跑的结果**就是本块的结果** —— 判别式因此与 §13.6.4 第 2、3 步逐字对应，
 *     只是执行者从人换成了这一层。
 *
 * ── 「拿不到测量」不等于「测量结果是红的」（ISSUE #1747）──────────────────
 *
 * 上一版在这里犯过一个错，值得写在最显眼的地方：**它拿机器负载当间接判据**。
 *
 * 现场（本轮实测复现，8 核容器，机器压到 load≈300）：`rc=1`、墙钟 **1867197ms
 * （约 31 分钟）**，红的全是同一份文件 `tests/ratchet-update-guards.test.ts`
 * （`Test timed out in 30000ms` / `120000ms`），中间刷了 66 行
 * 「每核负载 37.5（阈值 1.5）—— 等它回落再复跑」，最后以「这次的红**归不到代码上**，
 * 但它也不是绿」结尾 —— **然后照样阻断**。
 *
 * 三处都是病：
 *   ① `os.loadavg()` 是**全局**读数，它分不清「机器被别人占着」与「钩子自己就是
 *      负载来源」。钩子自己就吃掉约 1.0–1.2/核，阈值 1.5 只留了一点点余量 ——
 *      共享机上必然落不下来，于是每次超时都白等一轮 5 分钟；
 *   ② 等不到就把「**拿不到测量**」读成「测量结果不好」⇒ 阻断。这就是
 *      「因为负载导致红」本身：提交的人没有任何代码可修；
 *   ③ 等待预算**逐块**计（`RETRY_BUDGET_MS` × 块数），块一多就是 31 分钟。
 *
 * 现在的判据换成**用第二遍测量的形态说话**，不再看 loadavg：
 *
 * | 情形                                             | 动作                                        |
 * | ------------------------------------------------ | ------------------------------------------- |
 * | 第一遍绿                                         | 通过（不等、不复跑）                        |
 * | 红、**不带**超时指纹（真断言红）                 | 一次都不复跑，直接阻断（这一档最该守住）    |
 * | 红、带超时指纹 ⇒ 隔离复跑                        | 绿 ⇒ 通过（负载假红）                       |
 * | 隔离复跑仍红、且**仍带**超时/worker 起不来指纹   | **测量不可信 ⇒ 记「未校验」、不阻断**       |
 * | 隔离复跑仍红、指纹已消失（真断言 / 真挂死）      | 阻断（真红）                                |
 *
 * 三条为什么这样定：
 *   · **指纹只看第二遍**：第一遍带指纹只说明「值得再测」；第二遍**也**带指纹才说明
 *     「这台机器此刻给不出可信的读数」。真挂死当然也长成超时 —— 那正是「未校验」
 *     要如实说的话：它**不是绿**，只是也没有证据判它红。所以这一档会逐条点名
 *     「哪几份文件这次没被校验过」并把复验命令写出来，**不伪造绿**。
 *   · **不再依赖 loadavg**：判据建立在「两次测量各自的形态」上，那是**这条链自己
 *     拿得到**的证据；`loadavg` 拿不到（Windows 恒 0、容器里是宿主读数）。
 *   · **等待降级成优化**：`waitForLoadToSettle` 仍然在（让机器喘口气能提高第二遍
 *     出可信读数的概率），但它的结论**不再决定退出码**；预算也收成**全局一份**。
 *   · **每一遍的结论与等待都要落账**（`rerunReport`）：收尾打「第 1 遍直接绿几块 /
 *     带指纹复跑几块 / 等待累计与整次提交那份预算 / 第 2 遍里放行、未校验、真红各几块」，
 *     而且**两条路径都打** —— 真红那次提前 `return` 也要有账，被拦下的人最需要知道的
 *     正是「这次等了多久、哪几块没被校验」。等待的秒数以前**只算不印**（`waitedMs`
 *     一直在返回里），算了不说，在读数上等价于没算。
 *
 * ⚠️ 这一档**不是放行**：真断言红一次都不复跑、照旧阻断；只有「隔离复跑之后仍然
 * 拿不到可信读数」才放行，且必须把「哪几份没校验」印在脸上。
 */

import { FIXED_STRUCTURAL_TESTS } from "./fixed-structural-tests.mjs";
/* 「改动面 ⇒ 清单」那一跳住在自己那份文件里 —— 与话术层、复跑面同一刀，理由写在那份文件头：
 * 机制层再塞第五件事就会长到读不动，而读不动的那一层失效形态是「判据恒绿」。
 * 判决链仍只有 `scripts/affected-tests.mjs` 那一份（ISSUE #2240：换的只是**载体**，
 * 不是筛法 —— 改动面走 stdin，不再逐个铺进 argv）。 */
import { collectList } from "./affected-launch-changed-list.mjs";
/* 组 C 分文件读数的**落盘布局**由账本那一侧拥有（读的一侧是格式的权威），而写这套布局的
 * 三件事现在住在 `affected-launch-junit-io.mjs`：import 而不是各抄一份文件名 —— 抄两份的
 * 漂移形态是静默的，改名那侧照常跑、这侧读不到，而「读不到」在这一格长得和「这次没有
 * 读数」一模一样。**转出**是为了既有 import 面不变（用例从本文件取那两个出口）。 */
import {
  junitReportArgs,
  readRetrySuiteFailures,
  writeFilesManifest,
} from "./affected-launch-junit-io.mjs";
import { collectFileTimings } from "./precommit-timing.mjs";
export { junitReportArgs, writeFilesManifest };
/* 逐份用时的**取数**也归账本那一侧（`collectFileTimings` 是布局的唯一读者，
 * `parseJunitXml` 是解析的唯一出处）—— **转出**而不是在本层再 import 一次：那一对
 * 是**共同模块**，两处各 import 一份的代价是「这一层带着它进 graph」，而下面
 * `junitReadings` 的注里那句「读者只有一个」就不再成立。 */
export { collectFileTimings };

/* 复跑面（第 2 遍该跑哪几份）住在自己那份文件里 —— 与话术层同一刀，理由写在那份文件头：
 * 机制层再塞第五件事就会长到读不动，而读不动的那一层失效形态是「判据恒绿」。
 * 判决粒度（第 2 遍那份红按文件分开）住在隔壁那份里（`affected-launch-retry-verdict.mjs`）——
 * 取数按文件而判决按块，粗的那一份会把细的那一份的真红一起吞掉（ISSUE #2225）。 */
import { retryScope } from "./affected-launch-retry-scope.mjs";
import {
  classifyFirstPass,
  classifyRetry,
  mergePerFileReads,
} from "./affected-launch-retry-verdict.mjs";
import {
  isTimeoutShaped,
  remainingWaitMs,
  RETRY_BUDGET_MS,
  waitForLoadToSettle,
} from "./affected-launch-load-retry.mjs";
/* 墙钟判点（还开不开下一遍）住在自己那份文件里：等待有预算而**跑**没有上界，负载膨胀时
 * 重试本身就成了消耗，直到那一格被平台掐掉、连「未判定」都说不出（ISSUE #2364）。 */
import {
  affordablePerFileCount,
  gateRerunByWallClock,
  perFileBudgetStopReport,
  remainingWallClockMs,
  rerunFileList,
  resolveWallClockMs,
  wallClockBudget,
  wallClockSkipReport,
} from "./affected-launch-wallclock.mjs";
/* 收尾那两份账与「毫秒→秒」的格式住在**话术层**：本文件是机制层（清单 / 分块 / 起进程 /
 * 判超时指纹 / 定不退不退），那三段只把已经定完的结论排成给人读的账。拆开的理由不是「长」
 * 而是 §12.6 R5 那句 —— 读不动的那一层的失效形态是「判据恒绿」，不是报错。 */
import { fmtSec, rerunReport, unverifiedReport } from "./affected-launch-rerun-report.mjs";
/* 日志预算那一格（reporter 选哪个）住在自己那份文件里 —— 与话术层、复跑面同一刀，
 * 理由写在那份文件头：机制层再塞第六件事就越过 900 行硬闸，而越闸的形态不是报错，
 * 是「那一层读不动了」（§12.6 R5）。判据一个字没改，换的只是它住哪儿。 */
import { announceQuiet, reporterArgs } from "./affected-launch-log-budget.mjs";
/* quiet 档的**另一半**：那档只打点，「跑了哪些用例」得单独念一遍（同一刀拆法）。 */
import { fileListReport } from "./affected-launch-file-list.mjs";
/* 清单的**另一半**：每份用例自己花了多久（#2683 第二笔）。用时一直在 junit 里，
 * 而读它的那条链只有钩子的收尾账 —— 平台那一格没出口，于是「跑了哪些」与「那份多贵」
 * 分住在两个读者面。这里补的是一个**读数**，不碰任何判据。 */
import { fileTimingReport } from "./affected-launch-file-timing-report.mjs";
/* 「改动面归因 ⇒ 拆小建议」那一格（归因 + 排成给人读的话，纯提示、不参与任何判决）
 * 整格住进自己那份文件里：本层已经贴住 900 行硬闸，而越闸的形态不是报错，是
 * 「那一层读不动了」（§12.6 R5 / §12.13）。 */
import {
  SCOPE_ADVICE_MIN,
  collectAttribute,
  scopeAdvice,
} from "./affected-launch-scope-advice.mjs";
/* 「怎么起一次 vitest」那一层（并发怎么定、清单怎么切、入口在哪）住进自己那份文件：
 * 本层留下的是**判决链**，起进程那一层出列 —— 撞上 900 行硬闸时那条切线就是它
 * （§12.6 姊妹档 check-infra-file-size.cjs）。转出是为了既有 import 面不变。 */
import {
  planLaunches,
  resolveMaxWorkers,
  resolveVitestEntry,
  spawnVitest,
} from "./affected-launch-spawn.mjs";
export { planLaunches, resolveMaxWorkers, resolveVitestEntry };
/* 并发只有一个出处（ISSUE #2324）：兜底档由这里取，`resolveMaxWorkers` 自己不读核数。 */
import { resolveCiWorkers } from "./ci-load.mjs";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * 一次 spawn 的命令行长预算（字符）。
 *
 * `CreateProcess` 的整条命令行上限是 32767，这里取 **24000**：留给 node 自身、
 * vitest 入口、`run --maxWorkers=4` 这些固定段的余量，也避免将来有人在
 * 外面再套一层 shell 时直接顶穿。数字本身不是判据，**「不丢用例」**才是 ——
 * `tests/hook-affected-launch.test.ts` 判的是分块后并集等于输入且每块不超预算。
 */
export const SAFE_ARGV_BUDGET = 24_000;

/**
 * 「分不出哪份是超时」时逐文件补跑的**上限**（份数）。
 *
 * 为什么要有上限：逐文件补跑是一份一次进程启动（约 1–3s），而这条路只在
 * 「第 2 遍仍红且第 2 遍的 junit 认不出这些文件」这条稀有路径上走 —— 上限之内
 * 用几十秒换回判决粒度，值得；上限之外（典型是第 1 遍崩在 suite 之前、整块都被
 * 拉去复跑）逐文件跑等于把整块再跑一遍，而那块本来就是因为跑不动才红的。
 * 超过上限就停在这一档并把名单点出来（退 2），**不**冒充「整块只是超时形态」。
 *
 * 8 = 实测「一次改一个 feature」时组 C 失败文件数的常见上界再留一倍余量。
 * 这一条与 `affected-launch-scope-advice.mjs` 那份 `SCOPE_ADVICE_MIN` 都在 `scripts/.gate-thresholds.json` 里按 `report`
 * 入账（不是松紧量：调它只改变「要不要多花那几十秒」，不改变任何一条断言的判定）。
 */
const PER_FILE_RERUN_MAX = 8;

async function main(argv) {
  const dryRun = argv.includes("--dry-run");
  /* ── 显式全量档（`--full`）───────────────────────────────────────────────
   * 这一档**不是**增量解析的兜底，是它的**反面**：增量档把筛出来的清单当位置参数
   * 交给 vitest，而这里由调用方**按名字**点名要全部（`vitest run` 不带位置参数即
   * 全量收集）。两者在退出码与代价上完全不同，所以必须能分辨「我要全量」与
   * 「谁都没筛过」—— 后者仍然是阻断（见下面那条空清单守卫）。
   *
   * 为什么需要它（ISSUE #1393 的签字）：`affected-tests.mjs` 命中公共地基时会
   * **放弃收窄**，只跑固定清单，而这条兜底此前**没有具名出口** —— 规范里那句
   * 「翻兜底的前置是先造一条显式的全量通道」说的就是这个洞。档位在场之后，
   * wide 话术与钩子日志才能指向一条**跑得响**的命令，而不是让提交者自己去猜。
   */
  const full = argv.includes("--full");
  if (full) {
    process.stderr.write(
      "[affected-launch] --full：按名字要全量（**不经**暂存区解析、不拼位置参数，\n" +
        "  由 vitest 自己收集全部用例）。这一档买的是「没人能替你保证」的那部分，\n" +
        "  代价是整份套件的墙钟 —— 常态提交仍走增量档。\n",
    );
    /* ⚠️ `--dry-run` 必须排在 `resolveVitestEntry()` **之前**：那是本文件里第一个
     * 依赖 `node_modules` 的调用（解析不到就 `throw`），而「不起 vitest 的读数档」
     * 反过来成了唯一必须装好依赖的一档 —— 干净检出 / 只读沙箱上 `--dry-run` 直接红在
     * 「解析不到 vitest 入口」，而它的全部用途（对账清单份数、问一句跑得起来吗）
     * 一个都用不上。判据 `tests/affected-tests.test.ts` 的「干净检出」一条真起进程判这条顺序。 */
    if (dryRun) {
      process.stdout.write("[affected-launch] --full：会跑全部用例（vitest 自行收集）\n");
      return 0;
    }
    const entry = resolveVitestEntry();
    const { workers, note } = resolveMaxWorkers(
      process.env.COMFY_PRECOMMIT_MAX_WORKERS,
      resolveCiWorkers().workers,
    );
    if (note) {
      process.stderr.write(`[affected-launch] ${note}\n`);
    }
    const quietFull = announceQuiet(process.env.COMFY_AFFECTED_QUIET, (t) =>
      process.stderr.write(t),
    );
    /* 这一档的「清单」不是一张表而是 vitest 自己收集出来的全集 —— 逐份列出来只会把
     * 日志预算吃光，所以这里只念一句「没有清单可列」。不静默：quiet 档读的人要能分辨
     * 「这一档本来就不列」与「列清单这件事坏了」。 */
    process.stderr.write(
      quietFull
        ? "[affected-launch] 本次清单：全量档由 vitest 自行收集，故不逐份列出（quiet 只换 reporter）\n"
        : "",
    );
    // 空清单在这里是**明确意图**（全量），所以复用同一条判决链（超时形态仍会隔离复跑）。
    return await runChunk([], { entry, workers, quiet: quietFull });
  }
  const files = collectList();
  if (files.length === 0) {
    process.stderr.write(
      "[affected-launch] affected 解析没给出清单 —— 宁可阻断，" +
        "也不让 vitest 不带位置参数跑成全量\n" +
        "  （要按名字跑全量是另一档：`node scripts/run-affected-tests.mjs --full`）\n",
    );
    return 1;
  }
  let chunks;
  try {
    chunks = planLaunches(files);
  } catch (e) {
    process.stderr.write(`[affected-launch] ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  /* 同上：读数档不碰 `node_modules`。它要的信息（清单份数 / 启动次数 / 最长一块）
   * 全部来自 `collectList()` 与 `planLaunches()`，两者都是纯计算。 */
  if (dryRun) {
    process.stdout.write(
      `[affected-launch] ${files.length} 个用例 / ${chunks.length} 次启动，` +
        `最长一块 ${chunks.reduce((m, c) => Math.max(m, c.join(" ").length), 0)} 字符\n`,
    );
    return 0;
  }
  const entry = resolveVitestEntry();
  const { workers, note } = resolveMaxWorkers(
    process.env.COMFY_PRECOMMIT_MAX_WORKERS,
    resolveCiWorkers().workers,
  );
  if (note) {
    process.stderr.write(`[affected-launch] ${note}\n`);
  }
  const quiet = announceQuiet(process.env.COMFY_AFFECTED_QUIET, (t) => process.stderr.write(t));
  /* 分文件耗时的落点：钩子 `export` 出来的 `$LOGD`，或平台入口 `ci-affected-tests.mjs`
   * 自己造的一份（同一份布局，随本次跑清理 —— 那一格此前拿不到 junit，复跑面每次都
   * 退回整块，ISSUE #2074）。没有它（人自己跑这一档 / 不在执行者里）就一个字都不加 ——
   * 这一档是**读数**，不是这条命令的必经部分；落不进账本目录时宁可不记，也不要往检出里写文件。
   *
   * ⚠️ 路径要**当场 resolve 并说出口**：钩子由 sh 起，`$LOGD` 在 MSYS 下可能是
   * `/tmp/…` 这种「shell 与 Windows Node 各解各的」写法。两个 Node 进程（这里与
   * 读账的 `precommit-timing.mjs`）解出的结果一致 ⇒ 读数仍对得上，但 shell 那句
   * `rm -rf "$LOGD"` 清的是它自己那一份 ⇒ 这里印出真实落点，读数在不在一眼可见，
   * 而不是「读不到 ⇒ 静默没有这一格」。`existsSync` 为假时直接不加参数（退化成
   * 今天的形状），不会写出半个读数冒充整体。 */
  const rawLogd = process.env.LOGD || "";
  const junitDir = rawLogd && existsSync(rawLogd) ? path.resolve(rawLogd) : "";
  if (junitDir) {
    writeFilesManifest(junitDir, files);
    process.stderr.write(
      `[affected-launch] 分文件耗时读数落在 ${junitDir}（组 C 账本，随本次跑清理）\n`,
    );
  }
  /* 「跑了哪些用例」在 quiet 档由这里补（`--reporter=dot` 只打点，实测一跑上百份时
   * 平台日志里一个文件名都没有，只剩 `Tests N passed`；而那份清单里排在最前面的是
   * **103 份固定清单**，它们才是这次守的到底是什么）。打的是**送进 vitest 的清单**，
   * 不为它多起一次 vitest、也不改任何判据。 */
  process.stderr.write(fileListReport(files, { quiet }));
  /* 改动面归因只在**面大到值得说**时才去算：它是给「拆小」用的（见 `scopeAdvice`），
   * 而面小的时候那句话没有任何信息 —— 白算一次还会让每次提交多付约 220ms。
   * 判断用**已经拿到**的清单份数（`files.length - 固定清单份数`），不额外读一次 git。 */
  const affectedCount = files.filter((f) => !FIXED_STRUCTURAL_TESTS.includes(f)).length;
  const wantAdvice = affectedCount >= SCOPE_ADVICE_MIN;
  /* 建议在**起 vitest 之前**打：它讲的是「这次的代价」，而一条真断言红会把收尾段
   * 整个截断（实测踩到过）—— 真红的时候恰恰更需要看到这个数。 */
  if (wantAdvice) {
    process.stderr.write(
      scopeAdvice({
        total: files.length,
        fixed: files.length - affectedCount,
        affected: affectedCount,
        top: collectAttribute(),
      }),
    );
  }
  /* 等待预算**全局一份**（不是每块一份）：逐块计时块数一多就成了 5 分钟 × N
   * （实测 8 块 ⇒ 约 31 分钟，ISSUE #1747 的现场）。用一个可在多块之间共享的
   * `deadline` 表示 —— 第一块等掉的时间，后面的块不会重新拿到一份。 */
  const waitBudget = { deadline: Date.now() + RETRY_BUDGET_MS };
  /* 跑也要有界：整次一份、跨块共享，与上面那份等待预算同形状（只管开不开下一遍）。 */
  const wallClock = resolveWallClockMs(process.env.COMFY_AFFECTED_WALL_CLOCK_MS);
  if (wallClock.note) {
    process.stderr.write(`[affected-launch] ${wallClock.note}\n`);
  }
  const stageBudget = wallClockBudget({ budgetMs: wallClock.budgetMs });
  /** 这一档「没拿到可信读数」的文件（未校验 ≠ 绿，结束时要点名）。 */
  const unverified = [];
  /** 每一块一条判决记录，收尾那份账（`rerunReport`）读它。 */
  const attempts = [];
  /**
   * 从这一跑写出的 junit 里读回**逐份用时**（`fileTimingReport` 的唯一取数入口）。
   *
   * 取数走**账本那一侧的读者**（`collectFileTimings`，布局归 `precommit-timing.mjs`
   * 所有，本文件只把它的出口转出来），不自己扫目录 —— 抄一份文件名正则的漂移形态是静默的：
   * 改名那一侧照常跑、这一侧从此读不到，而「读不到」在这一格长得和「这一跑没有读数」
   * 一模一样。
   *
   * 没有落点 / 目录里一份都没写出 ⇒ 回**空数组**，那一档在报告里是「读不到」，
   * 不是「每份 0ms」（后者会让「这次没有读数」长得像「每份都秒过」）。
   *
   * @returns {{name: string, ms: number}[]}
   */
  const junitReadings = () => (junitDir ? collectFileTimings({ dir: junitDir }).files : []);
  /* 收尾两格合成一个函数，因为**两条路径都要打**：真红那次提前 return，而那一屏
   * 恰恰最需要「这次等了多久、哪几块没被校验过」（同上面 scopeAdvice 那条
   * 「真红时更该看到这个数」—— 放在 return 之后就是永不打字的死账）。 */
  const flush = () => {
    /* 逐份用时（`fileTimingReport`）：从这一跑写出的 junit 里读回来。它必须是**收尾**
     * 那一段 —— 读数在第一遍跑完才存在，而「打了哪些用例」那张清单要早于起 vitest
     * （起之前根本没有用时）。两份放在同一屏的两端是刻意的：清单回答「跑了什么」，
     * 这里回答「各自多久」，两句都读完才算读完了这一格。 */
    process.stderr.write(fileTimingReport(files, { quiet, read: junitReadings() }));
    if (unverified.length > 0) {
      process.stderr.write(unverifiedReport(unverified));
    }
    process.stderr.write(rerunReport(attempts, { budgetMs: RETRY_BUDGET_MS }));
  };
  for (const [index, chunk] of chunks.entries()) {
    if (chunks.length > 1) {
      process.stderr.write(
        `[affected-launch] 第 ${index + 1}/${chunks.length} 块，` +
          `${chunk.length} 个用例（命令行长预算 ${SAFE_ARGV_BUDGET} 字符）\n`,
      );
    }
    // 并发跟着 `resolveMaxWorkers` 走（含 `COMFY_PRECOMMIT_MAX_WORKERS` 那一档）；
    // 「超时形态 ⇒ 等待 + 隔离复跑 ⇒ 按第二遍的形态定论」的判决链在 `runChunk` 里，
    // 见其文档与文件头那节。
    const code = await runChunk(chunk, {
      entry,
      workers,
      quiet,
      junitDir,
      chunkId: index,
      waitBudget,
      stageBudget,
      onUnverified: (files) => unverified.push(...files),
      onAttempt: (record) => attempts.push(record),
    });
    if (code !== 0) {
      flush();
      return code;
    }
  }
  flush();
  return 0;
}

/**
 * 跑**一块**清单，返回该块的退出码。三档，各有各的结论（ISSUE #2225 之后不再是两档）：
 *
 * | 退码 | 含义                                       | 谁决定怎么处理                                             |
 * | ---- | ------------------------------------------ | ---------------------------------------------------------- |
 * | `0`  | 通过，或**已确认每份都只是超时**（未校验） | 钩子放行并点名（#1747 那条口径）                           |
 * | `1`  | 有文件的失败不是调度形态（真红）           | 钩子阻断；平台那格照原值非零                               |
 * | `2`  | **未判定**：有文件拿不到自己的读数         | 钩子按「既不是绿也不是红」放行并点名；平台原样透传 ⇒ 不算绿 |
 *
 * 单独抽出来是为了让「超时形态 ⇒ 等待 + 隔离复跑 ⇒ 按第二遍的形态定论」这条判决链
 * **可以被用例整个跑一遍**（注入假的 `spawn` / 假等待即可），而不是只断源码的字面
 * 形状 —— 弱化到只断形状的话，「复跑绿的算过」与「复跑红的也算过」在文本上长得一样，
 * 那正是这一档最该拦住的方向。
 *
 * **判据建立在「两遍测量各自的形态」上，不看 `os.loadavg()`**（ISSUE #1747）：
 * 第一遍带指纹只说明「值得再测」；第二遍**也**带指纹才说明「这台机器此刻给不出可信
 * 读数」—— 那是**未校验**（放行 + 点名），不是红。真断言红一次都不复跑、照旧阻断；
 * 第二遍指纹消失（真断言 / 真挂死）也照旧阻断。
 *
 * @param {string[]} chunk 本块的用例路径
 * @param {{entry: string, workers?: number, quiet?: boolean, junitDir?: string, chunkId?: number,
 *          spawn?: (entry: string, args: string[]) => {status: number|null, output: string}, settle?: () => Promise<{settled: boolean, load: number, waitedMs: number}>, waitBudget?: {deadline: number}, stageBudget?: {deadline: number, budgetMs: number}, onUnverified?: (files: string[]) => void, onAttempt?: (record: {outcome: string, waitedMs?: number, settled?: boolean}) => void}} deps
 *   `workers` **默认取自唯一出处** `ci-load.mjs`（`resolveCiWorkers().workers`）——
 *   这一层**只读它当首跑的并发**，复跑一律 `--no-file-parallelism`（降负载那一半）。
 *   以前这里默认一条本地常数 `DEFAULT_MAX_WORKERS = 4`，与 `vitest.config.ts` 的 8
 *   是同一句判断的两份副本；常数撤掉后默认值改从 `ci-load` 推导（ISSUE #2324）。
 *   `junitDir` + `chunkId` 是分文件耗时的落点（钩子里传 `$LOGD`；不给就一个字都不加，
 *   见 `junitReportArgs` 那三个被实测钉住的形状）。
 *   `quiet` 只换 reporter（日志预算，见 `affected-launch-log-budget.mjs`）——**两遍都带**
 *   同一个值，缺省 `false` = 默认 reporter（今天的形状）。
 *   `waitBudget` 是多块之间**共享**的等待截止时刻（默认单块自己一份，供调用点收成一份）。
 *   `stageBudget` 是同形状的**墙钟**截止时刻，只管「还开不开下一遍 / 下一份」（ISSUE #2364）。
 *   `onAttempt` 每块一条判决记录，只喂收尾那份账（`rerunReport`），**不参与退出码**。
 * @returns {Promise<number>}
 */
export async function runChunk(chunk, deps) {
  const spawn = deps.spawn ?? spawnVitest;
  // 每一块都往收尾那份账里记一条（`rerunReport`）；调用点不给就不记，判决本身不受影响。
  const report = deps.onAttempt ?? (() => {});
  const {
    entry,
    workers = resolveCiWorkers().workers,
    junitDir,
    chunkId = 0,
    /* quiet **必须在块内可见**（两遍都要带上同一个 reporter）：只在 `main` 里改第一遍
     * 的话，复跑那一遍会退回默认 reporter，而它恰恰是打印量最大的那一遍
     * （同一批用例在更差的条件下再跑一次，失败明细翻倍）。 */
    quiet = false,
  } = deps;
  /* reporter：平台那一格 quiet（日志预算），本地默认**一个字都不加** —— 见
   * `affected-launch-log-budget.mjs` 的头注（那一段记着 102400 字节的截断现场）。 */
  const reporters = reporterArgs(quiet);
  /* 首跑墙钟：下一遍开不开得起只能由刚跑完的这一遍说话（常数界在机器空时过严、
   * 机器满时过松，ISSUE #2364）。 */
  const firstPassStartedAt = Date.now();
  const res = spawn(entry, [
    "run",
    ...reporters,
    ...junitReportArgs(junitDir, chunkId, 1, {
      withDefaultReporter: reporters.length === 0,
    }),
    `--maxWorkers=${workers}`,
    ...chunk,
  ]);
  // 界要落在哪一侧只能由刚跑完的这一遍说话（常数界在机器空时过严、机器满时过松）。
  const firstPassMs = Date.now() - firstPassStartedAt;
  if (res.status === 0) {
    report({ outcome: "first-green" });
    return 0;
  }

  /* 第 1 遍那个红是什么形态，三档各配一个退码（判据与话术住在
   * `affected-launch-retry-verdict.mjs` 的 `classifyFirstPass` —— 与第 2 遍那份
   * `classifyRetry` 是同一件事的两个时机）。 */
  const firstPass = classifyFirstPass(res);
  process.stderr.write(
    firstPass.kind === "red"
      ? `${firstPass.note}` +
          `  （入口 ${entry}，本块 ${chunk.length} 个用例，命令行约 ` +
          `${chunk.join(" ").length} 字符）\n`
      : firstPass.note,
  );
  if (firstPass.kind === "launch-failed") {
    report({ outcome: "launch-failed" });
    return 2;
  }
  if (firstPass.kind === "red") {
    report({ outcome: "red-no-fingerprint" });
    return firstPass.code;
  }

  /* 复跑面由 `retryScope` 给（只跑第 1 遍里失败的那几份）：这一格**只改跑多少份**，
   * 旗标 / 预算 / 结论档位一律照旧，而三条退回形态都是「宁可多跑」那一边。算在等待
   * **之前**：墙钟判点要点名的正是「没拿到第二次测量的那几份」（#2225 那条口径）。 */
  const scope = retryScope({ chunk, junitDir, chunkId, read: deps.readJunit });
  /* 界只划在「要不要再开一遍」—— 已开跑的那一遍永远让它跑完（中途 kill 会连一份可能
   * 已经出来的读数一起丢掉）。不够就是**未判定**退 2：连第二次测量都没发生，不许听得
   * 像「确认过了」—— 那才是未校验（退 0）。ISSUE #2364。 */
  /* 界落在哪一侧：`estimateSerialRerunMs` 估的是「**整块**在串行条件下重测」，而实际
   * 要跑的往往只是失败的那几份 —— 两者差一个量级（实测：整块 16.1 分钟 ⇒ ×2 = 32.4 分钟，
   * 而失败的那**一份**隔离跑 0.4 秒）。买不起整块时先去量一份，别连一次真实测量都不发生
   * 就宣布「拿不到结论」（`budgetAllows` 的 `probeFiles` 那一段记着这次读数）。 */
  const gate = gateRerunByWallClock({
    budget: deps.stageBudget,
    firstPassMs,
    retryFiles: scope.files.length,
  });
  if (gate.note !== "") {
    process.stderr.write(gate.note);
  }
  if (!gate.ok) {
    process.stderr.write(wallClockSkipReport({ ...gate, files: scope.files }));
    report({ outcome: "budget-skipped" });
    return 2;
  }
  /* 等待**只是优化**：让机器喘口气能提高第二遍出可信读数的概率，但它的结论
   * **不再决定退出码**（ISSUE #1747 —— 逐块等 5 分钟且最后仍拦下提交，是病）。
   * 预算由调用点给（多块共享一份 deadline）；不给就单块自己一份。 */
  const settle =
    deps.settle ?? (() => waitForLoadToSettle({ budgetMs: remainingWaitMs(deps.waitBudget) }));
  const settled = await settle();
  /* 「等了多久」要说出口，而不是只说「在等」：它是**唯一**能区分
   * 「机器空了，所以第二遍与第一遍不同条件」与「一点没等，第二遍和第一遍同条件」的读数
   * —— 后者的复跑只证伪了「真断言红」，并没有排除负载。放在这里（而不只在收尾账里）
   * 是因为被拦下的那次往往只剩这一屏（同 §13.5.8.2 那条「真红时恰恰更该看到这个数」）。 */
  process.stderr.write(
    settled.waitedMs === 0
      ? `[affected-launch] 没等（第一读数就已回落：每核 ${settled.load.toFixed(2)}）` +
          " ⇒ 第二遍与第一遍几乎是同一条件，它只能证伪「真断言红」，不能证明负载已散\n"
      : `[affected-launch] 等了 ${fmtSec(settled.waitedMs)}${
          settled.settled ? `（每核负载回落到 ${settled.load.toFixed(2)}）` : " 没等到回落"
        } —— 起第 2 遍：${scope.why}、--no-file-parallelism\n`,
  );
  /* 走「先量一份」那一支时，第 2 遍只跑它买得起的那几份，且**按读数挑**（`rerunFileList`
   * → `probeFiles`）：不是 `scope.files` 里排在前面的几份 —— 那是清单顺序，与「哪一份最
   * 可能量出结论」无关（ISSUE #2601）。剩下的文件照旧走下面那条逐文件补跑（同一份判据
   * `affordablePerFileCount` 算份数）—— 两条路的分工是「一份一个退出码」对「多份一次
   * 启动」，结论档位一模一样。 */
  const retryFiles = rerunFileList({
    gate,
    files: scope.files,
    readSuites: () => readRetrySuiteFailures({ junitDir, chunkId, read: deps.readJunit }),
    isTimeout: isTimeoutShaped,
  });
  const retry = spawn(entry, [
    "run",
    ...reporters,
    ...junitReportArgs(junitDir, chunkId, 2, {
      withDefaultReporter: reporters.length === 0,
    }),
    "--no-file-parallelism",
    ...retryFiles,
  ]);
  if (retry.status === 0) {
    process.stderr.write(
      "[affected-launch] **第 2 遍**全绿 ⇒ 刚才那次是**负载假红**（这一步不构成放行依据，\n" +
        "  是同一批用例在更隔离的条件下重测的结果）。提交继续，\n" +
        "  但建议在提交说明里点名这次是负载假红（降负载的杠杆是并发，不是预算）。\n",
    );
    report({
      outcome: "rerun-green",
      waitedMs: settled.waitedMs,
      settled: settled.settled,
    });
    return 0;
  }
  /* 串行仍红、**不再整块复跑**（第三次只会把钩子变长，不改变结论）。这时要问的是
   * 「这一遍的读数能不能**按文件**分开」，而不是「整块输出里还有没有指纹」——
   * 后者是块级口径，它把「A 超时 + B 真断言红」整块读成「只是超时形态」并退 0，
   * 于是 B 那次真红没有任何一格会看见（ISSUE #2225：判定粒度比取数粒度粗，
   * 粗的那一份就把细的那一份吞了，而吞掉表现为 success）。三档结论：
   *   · 任一份文件的失败文本**不带**指纹 ⇒ 真红，阻断并点名那几份；
   *   · 每一份都带指纹 ⇒ **未校验**：放行 + 逐条点名（沿用 #1747 那条口径）；
   *   · 有文件在第 2 遍的读数里认不出自己 ⇒ 先**有界逐文件复跑**把粒度拿回来
   *     （一份一个退出码，那份退出码就是它的结论，不需要再解析块）；拿不回来就是
   *     **未判定**，退 2 —— 它既不是绿也不是红，但**不许**冒充「整块只是超时形态」。 */
  const readSuites = readRetrySuiteFailures({
    junitDir,
    chunkId,
    read: deps.readJunit,
  });
  let verdict = classifyRetry({ files: retryFiles, readSuites });
  /* 第 2 遍只量了一部分（`probe` 那一支）⇒ 剩下的文件既没跑过也没被确认过，它们按
   * 「认不出自己」走下面那条逐文件补跑，**不许**因为「不在这一遍的名单里」而消失。 */
  if (retryFiles.length < scope.files.length) {
    const measured = new Set(retryFiles);
    verdict = {
      ...verdict,
      unknown: [...scope.files.filter((f) => !measured.has(f)), ...verdict.unknown],
      kind: verdict.hardFail.length > 0 ? "hard-fail" : "unattributed",
    };
  }
  if (
    verdict.kind === "unattributed" &&
    verdict.unknown.length > 0 &&
    verdict.unknown.length <= PER_FILE_RERUN_MAX
  ) {
    process.stderr.write(
      `[affected-launch] ${verdict.unknown.length} 份文件在第 2 遍的读数里认不出自己` +
        " ⇒ 逐文件各跑一次把判决粒度拿回来（不解析块，一份自己一个退出码）…\n",
    );
    /** @type {{file: string, status: number | null, output: string}[]} */
    const perFile = [];
    // 单价 = 上一份补跑的真实墙钟；买不起就停，剩下的退回下面既有那条「退 2 并点名」
    // 出口 —— 不新造一档结论，也不把没跑的那份算进「已确认只是超时」（ISSUE #2364）。
    let perFileMs = 0;
    for (const file of verdict.unknown) {
      const pending = verdict.unknown.length - perFile.length;
      const affordable = affordablePerFileCount({
        budget: deps.stageBudget,
        perFileMs,
        pending,
      });
      if (affordable <= 0) {
        process.stderr.write(
          perFileBudgetStopReport({
            remainingMs: remainingWallClockMs(deps.stageBudget) ?? 0,
            perFileMs,
            left: pending,
          }),
        );
        break;
      }
      const oneStartedAt = Date.now();
      const one = spawn(entry, ["run", "--no-file-parallelism", file]);
      perFileMs = Date.now() - oneStartedAt;
      perFile.push({ file, status: one.status, output: one.output });
    }
    verdict = mergePerFileReads(verdict, perFile);
  }

  if (verdict.kind === "unattributed") {
    process.stderr.write(
      `[affected-launch] ⚠ 第 2 遍仍红，而有 ${verdict.unknown.length} 份文件` +
        "**拿不到自己的读数**（超过逐文件补跑的上限，或补跑也没落上读数）。\n" +
        "  这一档不叫「未校验」：未校验是「确认每份都只是超时」，而这里是**分不出**。\n" +
        "  ⇒ 本组退 2（构成结论，但不是绿，也不是红）。点名：\n" +
        verdict.unknown.map((f) => `    · ${f}\n`).join("") +
        "  下一动作：把那几份单独跑一次定性（串行、同一份清单，规范 §13.6.4 那条）；\n" +
        "  **不要**抬 testTimeout，也**不要** --no-verify。\n",
    );
    report({
      outcome: "rerun-unattributed",
      waitedMs: settled.waitedMs,
      settled: settled.settled,
    });
    return 2;
  }

  if (verdict.kind === "unverified") {
    process.stderr.write(
      "[affected-launch] **第 2 遍仍然只是超时形态**（连单进程串行都排不上）——\n" +
        "  这一遍给不出可信读数，所以这批用例本次记为**未校验**：\n" +
        "    · 它**不是绿**：没有证据说它通过；\n" +
        "    · 它**也不是红**：失败的是调度，没有任何一条断言报错。\n" +
        "  提交继续，但「哪些文件没被校验过」会在本组末尾逐条点名。\n" +
        "  ⚠️ 这一档**不许**当成「已通过」写进提交说明；它等价于「这次没测」。\n" +
        (settled.settled
          ? ""
          : `  （等待没等到回落：每核负载 ${settled.load.toFixed(2)} —— 这是**优化**没兑现，\n` +
            "    不改变上面的结论。）\n") +
        "  **不要**抬 testTimeout，也**不要** --no-verify。\n",
    );
    /* 点名的范围必须是**这次真的没拿到可信读数的那些**，而不是整块：整块那份名单会把
     * 第一遍已经绿过的文件也写成「未校验」，而下一个人据此重跑时会在不存在的地方找问题。
     * 按文件分档之后这份名单比原来更准：逐文件补跑里自己通过的那些不在里面。 */
    deps.onUnverified?.(verdict.timedOut);
    report({
      outcome: "rerun-unverified",
      waitedMs: settled.waitedMs,
      settled: settled.settled,
    });
    return 0;
  }
  process.stderr.write(
    "[affected-launch] **第 2 遍**里有文件的失败**不是**调度形态 ⇒ 这不是负载假红，按真红处置。\n" +
      `  同块里确实还有超时的那 ${verdict.timedOut.length} 份，它们不替这几份挡：\n` +
      verdict.hardFail.map((f) => `    · ${f}\n`).join("") +
      "  用 `node scripts/base-check.mjs <这条>` 复算归属（你的 / 别线的），\n" +
      "  再决定修代码还是登记 —— 不要抬 testTimeout。\n",
  );
  report({
    outcome: "real-red",
    waitedMs: settled.waitedMs,
    settled: settled.settled,
  });
  return retry.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exit(await main(process.argv.slice(2)));
}
