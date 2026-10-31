/**
 * 「认出超时形态 + 等机器喘口气」这一层，从 `run-affected-tests.mjs` 拆出来。
 *
 * 为什么是这一刀：那份机制层文件越过了 900 行的**硬闸**（`check-infra-file-size.cjs`，
 * 无基线、无 `--update`），而判据给的出口只有一个 —— 拆。这一块的职责本来就不是
 * 「起进程 / 分清单」，而是**负载归因**：指纹清单、每核负载读数、有界等待、共享预算的
 * 剩余量。它自己也不依赖清单与 vitest 入口，两边都不需要知道对方。
 *
 * 同族先例：复跑面住在 `affected-launch-retry-scope.mjs`、话术住在
 * `affected-launch-rerun-report.mjs` —— 都是「读不动的那一层，失效形态是判据恒绿」
 * 这一条（§12.6 R5 / §12.13）落出来的拆法，不是按行数随手剪。
 *
 * ⚠️ `isTimeoutShaped` 那份指纹清单与 `scripts/base-check/verdict.mjs` 的同名件
 * **同源**：两份是同一件事（「这个红首先是一个负载读数」）在两个执行者上的落地，
 * 改一处必须改另一处，`tests/hook-affected-launch.test.ts` 逐条核对它们不漂移。
 */
import os from "node:os";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

/**
 * 一次「红」的输出是不是**超时形态**。
 *
 * 逐条与 `scripts/base-check.mjs` 的 `TIMEOUT_SIGNATURES` **同源** —— 两份清单是
 * 同一件事（「这个红首先是一个负载读数」）在两个执行者上的落地：`base-check` 用它
 * 把复算结果归到第五态 `load-flake`，本文件用它决定要不要隔离复跑。
 * 改一处必须改另一处：`tests/hook-affected-launch.test.ts` 逐条核对两份清单不漂移。
 *
 * 各条都是《本仓库实际见到过的原文》：
 *   · vitest：`Test timed out in 30000ms.` / `Hook timed out in 45000ms.`
 *     （本轮实测原文是 `Test timed out in 120000ms.`）；
 *   · vitest 池：`Failed to start forks worker` / `Timeout waiting for worker to respond`
 *     （实测这两种会把**退出码**打成非零，而一条真断言都没红）；
 *   · node:test / jest 形态：`Exceeded timeout of …` / `Timeout - Async callback`；
 *   · 本项目门禁自己的话术：`超时（…s）`（`src/lib/with-timeout` 的出口）。
 */
const TIMEOUT_SIGNATURES = [
  /Test timed out in \d+\s*ms/i,
  /Hook timed out in \d+\s*ms/i,
  /Failed to start forks worker/i,
  /Timeout waiting for worker to respond/i,
  /Exceeded timeout of \d+/i,
  /Timeout - Async callback/i,
  /超时（\d+s）/,
];

/**
 * 输出里有没有超时指纹（纯函数，两向都能被用例钉住）。
 *
 * ⚠️ 指纹**不是结论**：命中只说明「值得再验一次」。真回归也可能恰好卡在超时上 ——
 * 所以本文件拿到指纹后只做一件事：换更隔离的条件**重测**，而不是放行。
 *
 * @param {string | number | null | undefined} output @returns {boolean}
 */
export function isTimeoutShaped(output) {
  return TIMEOUT_SIGNATURES.some((re) => re.test(String(output ?? "")));
}

/**
 * 块输出的**失败段**（从 `------- Failed Tests N -------` 那一行的行首起，到末尾）。
 *
 * ## 为什么指纹不许在整块输出上判（2026-10-28 的读数订正，ISSUE #2599）
 *
 * `isTimeoutShaped(res.output)` 读的是**整块**输出，而那一块里住着全部用例的全部
 * 输出 —— 包括**按设计**流出来的超时文本。现场（build `cnb-u2e-1k619gnro`，PR #2598）：
 * 一份失败文件里 3 条用例是 `Test timed out in 30000ms`，于是整块被读成「超时形态」
 * ⇒ 进隔离复跑那一支；复跑买不起（见 `budgetAllows`）⇒ 整块按**未判定**退 2，
 * 而那三份文件的结论其实**第一遍就已经写在那儿**了。不是红，也不是没测到，是
 * 「把一次现成的读数丢了」。
 *
 * 本条**不新增任何结论档**：它只把「这次红是不是超时形态」这句话的取值面，从
 * 「整块输出」缩到「**失败**那一段」。两档后果都不是放行：
 *   · 失败段带指纹 ⇒ 照旧走隔离复跑（负载归因那一支，一个字没改）；
 *   · 失败段不带指纹、而整块里恰好有别的超时文本 ⇒ 走**真红**那一支（`return 非零`）。
 *     那是**更严**的一侧：原来这一档会被读成「超时形态」而进复跑，复跑绿了就放行，
 *     现在直接阻断并点名 —— 「超时文本是别人的，别拿它替这一次的红签字」。
 *     唯一要盯的形状是**逐文件补跑**：一份带超时的文件被单跑时，它的超时明细照样落在
 *     失败段里，所以「未校验」那一档的判定一个字没变（实测那份 3 条 `Test timed out
 *     in 30000ms` 的文件单跑出来仍是超时形态，`tests/hook-affected-launch.test.ts` 逐条钉住）。
 *
 * 取不到失败段（vitest 换了排版的极端形态）⇒ 退回整块那份**原行为**：这是刻意留的
 * 保守出口，宁可多复跑一次，也不许因为解析不到而把一次真的超时读成真断言红。
 *
 * @param {string | number | null | undefined} output vitest 的完整输出
 * @returns {string} 失败段正文；认不出时原样回整块输出
 */
export function failureSectionOf(output) {
  const text = String(output ?? "");
  const start = text.indexOf("Failed Tests");
  if (start === -1) {
    return text;
  }
  /* 必须**从行首**的那一行开始算：`indexOf("Failed Tests")` 会命中汇总行
   * `Test Files 1 failed` 之外的第一处出现，也就是 `------- Failed Tests 3 -------`。
   * 从那一行往下取到末尾 —— 失败明细只会越写越多，而**上面**那一段才是噪声
   * （其余用例的 stderr / 按设计打出来的超时文本就住在那里）。宁可取宽也不错切。 */
  const lineStart = text.lastIndexOf("\n", start) + 1;
  return text.slice(lineStart);
}

/**
 * 「这一遍根本没跑起来」的指纹 —— 与超时指纹**不是**一类，处置也完全相反。
 *
 * ## 它治的是什么（现场：平台的 `受影响用例` 一格）
 *
 * 那一格的输出里出现一串 `Error:` 与一段 `AggregateError`，而**一条断言都没红**：
 * `AggregateError` 是 Node 对「同一批异步操作里多个错误」的包装，在这个上下文里
 * 它意味着 **worker / 模块装载阶段就炸了**（依赖缺失、原生模块版本对不上、
 * 环境变量把解析带歪），而不是「某条用例的期望值不对」。
 *
 * 但这一层此前只会把它当**真断言红**（不带超时指纹 ⇒ 一次都不复跑、直接阻断），
 * 于是「这台机器上根本没跑起来」被写成「这次改动有回归」—— 而被拦下的人照着那屏
 * 去查代码，查的是一件没发生的事。
 *
 * ## 为什么与超时指纹分开列
 *
 * 超时指纹的下一动作是**隔离复跑**（换更隔离的条件再测一次，§13.6.4）；
 * 而装载失败的下一动作是**修环境**（`pnpm install`、清 `npm_config_*`），复跑没有意义
 * （同样的环境再跑一遍，同样的炸）。所以两者必须各自成档，**不许**并成一个
 * 「反正不是用例红」的大筐。
 *
 * 判据只收**装载 / 运行时级**的那几种原文；`AssertionError` 那一族刻意不收 ——
 * 一条真回归也可能在栈里带一句 `AggregateError`，而把它读成「环境问题」等于放行。
 */
const LAUNCH_FAILURE_SIGNATURES = [
  /\bAggregateError\b/,
  /Cannot find module/i,
  /MODULE_NOT_FOUND/,
  /ERR_MODULE_NOT_FOUND/,
  /Failed to load url/i,
  /Cannot find package/i,
  /ERR_DLOPEN_FAILED/,
  /was compiled against a different Node\.js version/i,
  /* vitest 自己的原文是 `No test files found, exiting with code 1`（实测），
   * 前缀 `Error:` 留给别的情形 —— 这里只锚后半句。 */
  /No test files found/i,
];

/**
 * 输出里有没有「装载 / 运行时起不来」的指纹（纯函数）。
 *
 * ⚠️ 这一档**不是**判据绿：它只说「这一遍没跑起来」，上一句「哪条用例红了」压根没有对象。
 * 调用方（`runChunk`）据此把结论记成**未判定**，点名的仍然是那批文件。
 *
 * @param {string | number | null | undefined} output
 * @returns {boolean}
 */
export function isLaunchFailureShaped(output) {
  const text = String(output ?? "");
  if (text === "") {
    return false;
  }
  /* 真断言红优先：栈里带 `AggregateError` 的断言红不许被读成环境问题
   * （放行一条真回归比多查一次环境贵得多）。 */
  if (/AssertionError/.test(text)) {
    return false;
  }
  return LAUNCH_FAILURE_SIGNATURES.some((re) => re.test(text));
}

/**
 * 等待负载回落的**全局**预算（毫秒）。
 *
 * 5 分钟：够等一次「占资源的东西」自己退下去（实测从 load≈300 回落到 <8 用了
 * 约 4 分钟，那是 200 多个自旋进程被 kill 之后），又不至于让提交的人以为指令挂死。
 *
 * ⚠️ 这一份是**整次提交**共用的（由 `main` 造一次、传下去），不是每块一份 ——
 * 逐块计时块数一多就成了 5 分钟 × N（实测 8 块 ⇒ 约 31 分钟）。
 *
 * ⚠️ 超了**不再等于红**（ISSUE #1747）：这一层的结论只决定「第二遍测量值不值得采信」，
 * 退出码由第二遍自己的形态定，见文件头那节。
 */
export const RETRY_BUDGET_MS = 5 * 60 * 1000;

/** 每一跳等多久再重新读负载。 */
const RETRY_POLL_MS = 5_000;

/**
 * 「这台机器还剩多少余量」—— **每核负载**（`loadavg[0] / cpus().length`）。
 *
 * 为什么不直接看 `loadavg[0]`：阈值必须与核数无关才立得住（8 核上的 load≈16 与
 * 32 核上的 load≈64 是同一件事：所有核都被占满）。所以归一化成「每核」，
 * 阈值 `SAFE_LOAD_PER_CORE` 才是一个常数。
 *
 * **Windows 上恒为 0**：`os.loadavg()` 在 Windows 返回 `[0, 0, 0]`（Node 的既定行为，
 * 不是缺陷）。于是那一档退化成「直接复跑、不等待」—— 判据本身仍然完整（复跑绿的照样
 * 放过、红的照样拦），只是没有「等一等」这层优化。**不许**用「读不到负载」当
 * 「这个红是假的」：那会把判据变成一条静默放行的路径。
 *
 * @param {{loadavg: () => number[], cpus: () => unknown[]}} [probe] 可注入（用例要造负载档）
 * @returns {number} 每核负载（核数读不到时按 1 核算，宁可高估负载也不低估）
 */
export function loadPerCore(probe = { loadavg: os.loadavg, cpus: os.cpus }) {
  const cores = Math.max(1, probe.cpus().length || 1);
  return (probe.loadavg()[0] ?? 0) / cores;
}

/**
 * 负载在什么档以下才算「复跑有意义」。
 *
 * 1.5 的出处：本仓库的实话是**钩子自己就把 8 核吃满**（C 组 4 个 worker + A tsc +
 * B eslint + D 串行），而本文件跑的时候正是那一刻 —— 所以阈值不能定成「空闲」，
 * 否则每次超时都会先等一轮（那笔账没人愿意付）。1.5 落在「钩子自己那份占用
 * （实测约 1.0–1.2/核）」之上一点，只挡「外面还压着一大片」的档。
 */
const SAFE_LOAD_PER_CORE = 1.5;

/**
 * 等到负载回落（有界），返回最终读数。
 *
 * **每一跳都打日志**：静默 sleep 是本仓库点名的坏形态（读的人以为挂了）。
 * 这一层**不做任何判定** —— 它的结论只被用来决定「现在重测值不值得采信」。
 * 等不到（`settled: false`）**不再等于红**（ISSUE #1747）：退出码归第二遍的形态管。
 *
 * @param {{budgetMs?: number, pollMs?: number, probe?: {loadavg: () => number[], cpus: () => unknown[]}, sleepFn?: (ms: number) => Promise<void> | void, now?: () => number}} [options]
 * @returns {Promise<{load: number, waitedMs: number, settled: boolean}>}
 */
export async function waitForLoadToSettle(options = {}) {
  const {
    budgetMs = RETRY_BUDGET_MS,
    pollMs = RETRY_POLL_MS,
    probe,
    /* 默认就是真等待（`timers/promises`）：同步 `Atomics.wait` 会**阻塞主线程**、
     * 让日志看起来像挂死 —— 而这一层恰恰要让人觉得「它在等，不是死了」。 */
    sleepFn = async (ms) => sleep(ms),
    now = Date.now,
  } = options;
  const started = now();
  let load = loadPerCore(probe);
  let settled = load <= SAFE_LOAD_PER_CORE;
  let hops = 0;
  while (!settled && now() - started < budgetMs) {
    process.stderr.write(
      `[affected-launch] 每核负载 ${load.toFixed(2)}（阈值 ${SAFE_LOAD_PER_CORE}）—— ` +
        "等它回落再复跑，不让「这一刻机器多满」变成结论\n",
    );
    await sleepFn(pollMs);
    hops += 1;
    load = loadPerCore(probe);
    settled = load <= SAFE_LOAD_PER_CORE;
  }
  /* 一跳都没睡 ⇒ 等的时间按构造就是 0，不去量墙钟：`Date.now()` 在 Windows 上
   * 粒度约 1ms，两次读数之间跨一格就会把「一点没等」读成「等了 1ms」—— 而调用方
   * 拿这个数说的是「等没等」，不是「等了多久」（同文件上面那条判据的口径）。 */
  return { load, waitedMs: hops === 0 ? 0 : now() - started, settled };
}

/**
 * 从共享的等待截止时刻算出**本块还剩多少**等待预算（毫秒，最小 0）。
 *
 * 存在的理由就是那条实测：逐块各给 5 分钟 ⇒ 8 块约 31 分钟、提交被拖死。
 * 没有 deadline（单块调用 / 用例）时返回整份预算。
 *
 * @param {{deadline: number} | undefined} waitBudget
 * @returns {number}
 */
export function remainingWaitMs(waitBudget) {
  if (!waitBudget) {
    return RETRY_BUDGET_MS;
  }
  return Math.max(0, waitBudget.deadline - Date.now());
}
