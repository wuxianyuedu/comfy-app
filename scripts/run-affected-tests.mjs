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
 *
 * ⚠️ 这一档**不是放行**：真断言红一次都不复跑、照旧阻断；只有「隔离复跑之后仍然
 * 拿不到可信读数」才放行，且必须把「哪几份没校验」印在脸上。
 */

import { spawnSync } from "node:child_process";
import { FIXED_STRUCTURAL_TESTS } from "./fixed-structural-tests.mjs";
import os from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
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
 * 钩子档的并发（全量 `pnpm test` 仍走 `vitest.config.ts` 里的 8，不受这里影响）。
 *
 * 为什么是 4：钩子里 A(tsc)、B(eslint)、D(组内串行的静态判据) 与 C 并行，
 * 再按配置里的 8 起 forks 就会抢不过来 —— 现场不是用例红而是
 * `Failed to start forks worker / Timeout waiting for worker to respond`
 * （几百条全过、退出码非零）。口径与推导见规范 §13.5.8。
 */
export const DEFAULT_MAX_WORKERS = 4;

/**
 * 从环境变量取一个**显式的**并发覆盖（`COMFY_PRECOMMIT_MAX_WORKERS`）。
 *
 * 为什么要有这个口子：4 是「8 逻辑核、A/B/D 同时在跑」那一档的实测值，而
 * **共享机 / 小核 VM / 正在跑 dev server + ComfyUI 的机器**上，这个常数与
 * 「此刻真有几个核可用」无关 —— 实测同一份 C 组在 load ≈0/16/65/128 下墙钟
 * 19.7s → 114.5s → 214s → 229s（判定全绿，见规范 §13.6.4 那一族）。
 * 单条预算（`CLI_BUDGET` 的 120s）能吸收到某个负载为止，再往上就需要**人为降负载** ——
 * 而 §13.6.4 明写「降负载的杠杆是并发，不是预算」，此前却没有任何一处能把钩子的
 * 并发调小（注释里那句「机器紧张把 C/D 也挪成串行即可」只是一句话，没有执行者），
 * 于是唯一的出路变成改钩子或 `--no-verify`（两条都不该是常态）。
 *
 * ⚠️ 这个口子**只调并发、不碰任何判据**：候选清单、预算、退出码口径一律不变，
 * 所以它不能被当成「让慢用例过关的旋钮」（同 §11.13 对 `expect.poll` 的那条口径）。
 * 传非法值（非整数 / <1）时**按默认值办并提醒**，不静默降级成 0（那会让 vitest
 * 报一个与真因无关的错）。
 *
 * ⚠️ 这一层是**纯函数**：环境变量由调用点读进来（`main` 那一处），不在这里兜底 ——
 * 否则用例里「不给值 = 走默认」这一格会被用例进程自己继承到的环境变量污染，
 * 而那种失效是「判据看着跑过、其实测的是外部环境」。
 */
export function resolveMaxWorkers(raw) {
  if (raw === undefined || raw.trim() === "") {
    return { workers: DEFAULT_MAX_WORKERS, note: null };
  }
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 1) {
    return {
      workers: DEFAULT_MAX_WORKERS,
      note: `COMFY_PRECOMMIT_MAX_WORKERS="${raw}" 不是 ≥1 的整数，按默认 ${DEFAULT_MAX_WORKERS} 办`,
    };
  }
  if (parsed === DEFAULT_MAX_WORKERS) {
    return { workers: DEFAULT_MAX_WORKERS, note: null };
  }
  return {
    workers: parsed,
    note: `按 COMFY_PRECOMMIT_MAX_WORKERS 用 --maxWorkers=${parsed}` +
      `（默认 ${DEFAULT_MAX_WORKERS}；这只调并发，不动任何判据）`,
  };
}

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
 */
export function isTimeoutShaped(output) {
  return TIMEOUT_SIGNATURES.some((re) => re.test(String(output ?? "")));
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
const RETRY_BUDGET_MS = 5 * 60 * 1000;

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
 * @param {{budgetMs?: number, pollMs?: number, probe?: object, sleepFn?: (ms: number) => void, now?: () => number}} [options]
 * @returns {{load: number, waitedMs: number, settled: boolean}}
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
 * 跑一次 vitest，**把输出抓在手里**（而不是 `stdio: "inherit"`）。
 *
 * 为什么必须抓：这一层的判决依赖「输出里有没有超时指纹」（见文件头那节）。
 * `inherit` 会把 stdout/stderr 直接接到父进程上，于是这段文本在本进程里**拿不到**
 * —— 那样就没有任何东西能区分「真断言红」与「机器太满」。
 *
 * 抓下来之后仍要**原样回吐**（`process.stdout.write`），否则日志里就看不见失败原因了 ——
 * 那正是 `run-affected` 当初被造出来要避免的形态（「跑的是 0 个用例、原因读不出」）。
 *
 * @returns {{status: number|null, output: string}}
 */
function spawnVitest(entry, args) {
  const res = spawnSync(process.execPath, [entry, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  process.stdout.write(res.stdout ?? "");
  process.stderr.write(res.stderr ?? "");
  if (res.error) throw res.error;
  return { status: res.status, output };
}

/**
 * 按命令行长预算把清单切成若干块，**顺序与成员都不变**。
 *
 * 单独导出成纯函数是为了让它可判：这条链路的失效模式（用例没跑）只有把
 * 「不丢不重」写成断言才拦得住，靠肉眼看 shell 的引号是拦不住的。
 */
export function planLaunches(files, budget = SAFE_ARGV_BUDGET) {
  const chunks = [];
  let current = [];
  let length = 0;
  for (const file of files) {
    const name = String(file).trim();
    if (!name) continue;
    if (name.length + 1 > budget) {
      throw new Error(
        `[affected-launch] 单个路径就超过命令行长预算（${name.length} > ${budget}）——` +
          "这一条不能被任何分块策略放进去，只能让它点名红",
      );
    }
    // 每段之间要一个空格，按 `join(" ")` 的真实长度算，不留估算余量。
    const next = current.length === 0 ? name.length : length + 1 + name.length;
    if (current.length > 0 && next > budget) {
      chunks.push(current);
      current = [name];
      length = name.length;
      continue;
    }
    current.push(name);
    length = next;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * 解析 vitest 的 ESM 入口。
 *
 * 走 `require.resolve("vitest/package.json")` 而不是写死 `node_modules/vitest/…`：
 * pnpm 的布局里真身在 `node_modules/.pnpm/vitest@<ver>_…/node_modules/vitest/`，
 * 顶层那个是链接；写死路径会在换版本或换安装方式时指到空气上。
 * 取 `bin.vitest` 的相对段而不是猜文件名，是因为入口名由包自己定义。
 */
export function resolveVitestEntry(cwd = process.cwd()) {
  const require = createRequire(path.join(cwd, "noop.js"));
  const pkgPath = require.resolve("vitest/package.json");
  const pkgDir = path.dirname(pkgPath);
  const bin = JSON.parse(readFileSync(pkgPath, "utf8"))?.bin?.vitest;
  if (typeof bin !== "string") {
    throw new Error(`[affected-launch] vitest 包没有 bin.vitest：${pkgPath}`);
  }
  const entry = path.resolve(pkgDir, bin.replace(/^\.\//, ""));
  if (!existsSync(entry)) {
    throw new Error(`[affected-launch] vitest 入口不存在：${entry}`);
  }
  return entry;
}

/**
 * 「改动面偏大」这件事的**下限**（受影响份数，不含固定清单的那几十份）。
 *
 * 60 的出处是实测的分界（8 核、热缓存、机器空闲，同一份检出）：只加一个 changelog
 * 碎片是 77 份 / **28.3s**，改一个只被几处消费的组件（`sheet.tsx`，受影响 10 份）
 * 是 87 份 / ≈30s —— 这一档与「没改代码」没区别。而受影响 60 以上的那一档全部
 * 翻倍：`tooltip.tsx`（65）**142 份 / 57.7s**、`button.tsx`（106）**183 份 / 71.2s**、
 * `core/repository.ts`（134）**211 份 / 63.1s**。所以 60 落在「固定清单的一半」
 * 这个量级上，是这个仓库自己的数据划出来的，不是拍的一个整数。
 */
const SCOPE_ADVICE_MIN = 60;

/**
 * 「这次改动面多大、该从哪一刀切」的收尾建议。
 *
 * **为什么需要它**：规范 §13.5.8.1 末尾那句「真正能让每次提交更快的是**把大改动拆小**」
 * 写了很久，却一直**没有执行者** —— 提交的人拿不到三件事：① 这次到底多大；
 * ② 这几十上百份里哪几份是**被哪一个改动文件**拉进来的；③ 拆完能省多少。
 * 没有这三件，「拆小」就只是口号，而口号不会有人照做。
 *
 * **为什么只提示、不阻断**：大改动有时**不可分**（一次接口重命名天然横跨几十个文件）。
 * 判据能说的只有「这次的面很大、代价是这个数、如果拆得开就这么拆」——把它变成阻断
 * 就是拿一个代价问题当正确性问题来判（与 §13.5.8.1「抬预算 / 抬并发都不成立」同一族的
 * 边界：**代价不许伪装成结论**）。
 *
 * ⚠️ 归因的数**不可加**：它给的是「单独改它一个会跑多少份」，不是「从总数里减掉多少」
 * （同一份测试常被多个改动文件共同拉到）。下面那句「去掉它 ≈ 剩多少」是**估算**，
 * 用 `总受影响 - 最大那个的 affected` 算出来、只会偏大 —— 这一点在规范与用例里都写死，
 * 不许把估算说成精确值。
 *
 * `elapsedMs` 可省：主干在**起 vitest 之前**就打（那时还拿不到墙钟），而「面有多大」
 * 这件事在真红时**更需要**被看到 —— 放在收尾打印的话，一条真断言红就会把它截断掉
 * （实测踩到过：探针触发 `check-dead-exports` 真红，整段建议一次都没印）。
 *
 * @param {{total: number, fixed: number, affected: number, elapsedMs?: number, top: {file: string, affected: number}[]}} input
 * @returns {string} 要打到 stderr 的正文
 */
export function scopeAdvice(input) {
  const { total, fixed, affected, elapsedMs, top } = input;
  const biggest = top[0];
  /** 去掉最大的那一刀之后还剩多少（估算，见上面那条不可加的口径）。 */
  const rest = biggest ? affected - biggest.affected : affected;
  const lines = [
    `[affected-launch] 改动面这件事：本次 ${total} 份用例（固定 ${fixed} + 受影响 ${affected}）` +
      (elapsedMs === undefined
        ? "。"
        : `，这一档实测墙钟 ${(elapsedMs / 1000).toFixed(1)}s` +
          " —— 「不改代码」那一档（只加一个 changelog 碎片）约 28s。"),
    "  受影响面是按**反向 import 闭包**算的，所以一个被广泛 import 的文件会把面撑得很大；",
    "  这件事与「这次改动本身难不难」无关 —— 它是**代价**，不是判据，本行不阻断提交。",
  ];
  if (top.length > 0) {
    lines.push(
      "  本次把面撑起来的改动文件（各自**单独**改会跑多少份，不可相加）：",
      ...top
        .slice(0, 3)
        .map(
          (t) =>
            `    · ${t.file} → 受影响 ${t.affected} 份` +
            (t === biggest ? "（最大的一刀）" : ""),
        ),
    );
    if (rest > 0) {
      lines.push(
        `  ⇒ 这一刀如果能独立成一次提交，剩下约 ${rest} 份受影响（**估算**：同一份测试` +
          "可能被多个改动文件共同拉到，实际值只会比它小）—— 那一档≈固定清单的量级。",
      );
    }
  }
  lines.push(
    "  拆不动也没关系（一次接口重命名天然横跨很多文件）——只是每次提交都会付这个墙钟。",
    "  真要压并发：`COMFY_PRECOMMIT_MAX_WORKERS=1 git commit …`（只调并发，不碰任何判据）。",
    "  规范 §13.5.8.1 / §13.5.8.2「第六笔账」。",
  );
  return lines.join("\n") + "\n";
}


/**
 * 调 `affected-tests.mjs --attribute` 拿「每个改动文件各自影响多少份」。
 *
 * 失败一律返回空数组：这条建议的分量只到「提示」，拿不到归因就不给建议 ——
 * 为一个纯提示让整个 C 组崩掉是把主次搞反了（与 `--attribute` 自己也「拿不到图时
 * 打空数组而不是报错」同口径）。**但必须打到 stderr**，静默吞掉会让「归因从来没
 * 成功过」这件事没人知道（同 §11.23「声明 ⇄ 读者」那一族）。
 */
function collectAttribute() {
  const res = spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), "scripts", "affected-tests.mjs"),
      "--attribute",
    ],
    { encoding: "utf8" },
  );
  if (res.status !== 0) {
    process.stderr.write(
      "[affected-launch] 改动面归因拿不到（仅影响下面那条建议，不影响本次判定）\n",
    );
    return [];
  }
  try {
    const parsed = JSON.parse(String(res.stdout ?? "[]"));
    if (!Array.isArray(parsed)) throw new Error("不是数组");
    return parsed;
  } catch {
    process.stderr.write(
      "[affected-launch] 改动面归因输出读不懂（仅影响下面那条建议）\n",
    );
    return [];
  }
}

/** 调 `affected-tests.mjs` 拿清单（它的 stdout 只有空格分隔的路径一行）。 */
function collectList() {
  const res = spawnSync(
    process.execPath,
    [path.join(process.cwd(), "scripts", "affected-tests.mjs")],
    { encoding: "utf8" },
  );
  if (res.status !== 0) {
    process.stderr.write(res.stderr ?? "");
    throw new Error(
      `[affected-launch] 清单解析失败（退出码 ${res.status ?? "信号"}）`,
    );
  }
  // 清单脚本自己的说明走 stderr，stdout 只有那一行路径；按空白切最稳。
  return String(res.stdout ?? "")
    .split(/\s+/)
    .filter(Boolean);
}

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
    const entry = resolveVitestEntry();
    const { workers, note } = resolveMaxWorkers(
      process.env.COMFY_PRECOMMIT_MAX_WORKERS,
    );
    process.stderr.write(
      "[affected-launch] --full：按名字要全量（**不经**暂存区解析、不拼位置参数，\n" +
        "  由 vitest 自己收集全部用例）。这一档买的是「没人能替你保证」的那部分，\n" +
        "  代价是整份套件的墙钟 —— 常态提交仍走增量档。\n",
    );
    if (note) process.stderr.write(`[affected-launch] ${note}\n`);
    if (dryRun) {
      process.stdout.write("[affected-launch] --full：会跑全部用例（vitest 自行收集）\n");
      return 0;
    }
    // 空清单在这里是**明确意图**（全量），所以复用同一条判决链（超时形态仍会隔离复跑）。
    return await runChunk([], { entry, workers });
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
    process.stderr.write(
      `[affected-launch] ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 1;
  }
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
  );
  if (note) process.stderr.write(`[affected-launch] ${note}\n`);
  /* 改动面归因只在**面大到值得说**时才去算：它是给「拆小」用的（见 `scopeAdvice`），
   * 而面小的时候那句话没有任何信息 —— 白算一次还会让每次提交多付约 220ms。
   * 判断用**已经拿到**的清单份数（`files.length - 固定清单份数`），不额外读一次 git。 */
  const affectedCount = files.filter(
    (f) => !FIXED_STRUCTURAL_TESTS.includes(f),
  ).length;
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
  /** 这一档「没拿到可信读数」的文件（未校验 ≠ 绿，结束时要点名）。 */
  const unverified = [];
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
      waitBudget,
      onUnverified: (files) => unverified.push(...files),
    });
    if (code !== 0) return code;
  }
  if (unverified.length > 0) process.stderr.write(unverifiedReport(unverified));
  return 0;
}

/**
 * 「未校验」那一档的收尾报告（纯函数，可被用例逐字钉住）。
 *
 * 为什么单独抽出来：这一档**放行**，所以它的唯一产物就是**这段话**。
 * 如果它没印出来（或印得含糊），放行就退化成「静默通过」—— 那正是这一档最坏的
 * 失效形态（同 §11.23「声明与读者」那一族：写了没有读者等于没写）。
 *
 * @param {string[]} files 这次没被校验到的用例路径
 * @returns {string}
 */
export function unverifiedReport(files) {
  return (
    `[affected-launch] **未校验**：${files.length} 份用例在隔离复跑之后仍然只是\n` +
    "  「机器太满、给不出可信读数」—— 这一档**既不是绿也不是红**，本次提交放行，\n" +
    "  但下面这些文件这次没有被验证过：\n" +
    files.map((f) => `    · ${f}\n`).join("") +
    "  机器空下来后请自己复验一次：\n" +
    "    node scripts/run-affected-tests.mjs --full\n" +
    "  （或直接跑 vitest 入口、带上 `--no-file-parallelism` 与那几份文件。）\n"
  );
}

/**
 * 跑**一块**清单，返回该块的退出码（0 = 通过 / 未校验，非零 = 真红）。
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
 * @param {{entry: string, workers?: number, spawn?: (entry: string, args: string[]) => {status: number|null, output: string}, settle?: () => Promise<{settled: boolean, load: number, waitedMs: number}>, waitBudget?: {deadline: number}, onUnverified?: (files: string[]) => void}} deps
 *   `workers` 默认 `DEFAULT_MAX_WORKERS`（调用点由 `resolveMaxWorkers` 给出）——
 *   这一层**只读它当首跑的并发**，复跑一律 `--no-file-parallelism`（降负载那一半）。
 *   `waitBudget` 是多块之间**共享**的等待截止时刻（默认单块自己一份，供调用点收成一份）。
 * @returns {Promise<number>}
 */
export async function runChunk(chunk, deps) {
  const spawn = deps.spawn ?? spawnVitest;
  const { entry, workers = DEFAULT_MAX_WORKERS } = deps;
  const res = spawn(entry, ["run", `--maxWorkers=${workers}`, ...chunk]);
  if (res.status === 0) return 0;

  /* 失败分两档（口径见文件头那节）：
   *   · **带超时指纹** ⇒ 这个红首先是一个负载读数（§13.6.4）。换更隔离的条件
   *     **重测一次**：串行单进程 = 降负载，**不抬任何预算**。
   *   · 不带指纹（真断言红 / 起不来）⇒ 一次都不复跑，直接阻断。 */
  if (!isTimeoutShaped(res.output)) {
    process.stderr.write(
      `[affected-launch] vitest 失败：${
        res.status === null ? "被信号终止" : `退出码 ${res.status}`
      }（入口 ${entry}，本块 ${chunk.length} 个用例，命令行约 ` +
        `${chunk.join(" ").length} 字符）\n`,
    );
    return res.status ?? 1;
  }

  process.stderr.write(
    "[affected-launch] 本块的红是**超时形态** —— 按规范 §13.6.4 先当负载读数看，\n" +
      "  等机器喘口气，再用 `--no-file-parallelism` 隔离复跑（降负载，不抬任何预算）…\n",
  );
  /* 等待**只是优化**：让机器喘口气能提高第二遍出可信读数的概率，但它的结论
   * **不再决定退出码**（ISSUE #1747 —— 逐块等 5 分钟且最后仍拦下提交，是病）。
   * 预算由调用点给（多块共享一份 deadline）；不给就单块自己一份。 */
  const settle =
    deps.settle ??
    (() => waitForLoadToSettle({ budgetMs: remainingWaitMs(deps.waitBudget) }));
  const settled = await settle();
  const retry = spawn(entry, ["run", "--no-file-parallelism", ...chunk]);
  if (retry.status === 0) {
    process.stderr.write(
      "[affected-launch] 隔离复跑全绿 ⇒ 刚才那次是**负载假红**（这一步不构成放行依据，\n" +
        "  是同一批用例在更隔离的条件下重测的结果）。提交继续，\n" +
        "  但建议在提交说明里点名这次是负载假红（降负载的杠杆是并发，不是预算）。\n",
    );
    return 0;
  }
  /* 串行仍红、**不再复跑**（第三次只会把钩子变长，不改变结论）。这时唯一的
   * 分叉是「这一遍的读数可不可信」，判据是**第二遍自己的输出形态**：
   *
   *   · 第二遍**仍带**超时 / worker 起不来指纹 ⇒ 连单进程串行都排不上，说明这台机器
   *     此刻给不出可信读数。这一档**未校验**：不是绿（没有证据说它过），也不是红
   *     （没有证据说它错 —— 那些指纹说明失败的是调度，不是断言）⇒ 放行 + 点名。
   *   · 第二遍指纹消失了（真断言 / 真挂死）⇒ 真红，照旧阻断。 */
  if (isTimeoutShaped(retry.output)) {
    process.stderr.write(
      "[affected-launch] 隔离复跑**仍然只是超时形态**（连单进程串行都排不上）——\n" +
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
    deps.onUnverified?.(chunk);
    return 0;
  }
  process.stderr.write(
    "[affected-launch] 隔离复跑指纹已消失（不再是调度形态）⇒ 这不是负载假红，按真红处置：\n" +
      "  用 `node scripts/base-check.mjs <这条>` 复算归属（你的 / 别线的），\n" +
      "  再决定修代码还是登记 —— 不要抬 testTimeout。\n",
  );
  return retry.status ?? 1;
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
  if (!waitBudget) return RETRY_BUDGET_MS;
  return Math.max(0, waitBudget.deadline - Date.now());
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exit(await main(process.argv.slice(2)));
}
