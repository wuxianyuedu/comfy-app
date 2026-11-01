/**
 * `base-check.mjs` 的 **判决层**(ISSUE #1811 拆 R5 超限文件)。
 *
 * 纯函数:给定「当前侧」与「基线侧」的退出码与输出,给出四态 / 五态结论
 * (含 `load-flake` 与 `inconclusive` 两档)以及配套的「下一动作」话术。
 * 这一层不碰 git、不跑进程 —— 它的全部输入都来自调用方。
 */

/**
 * **超时形态**：一次「红」的输出里带着「等超了 / 抢不到资源」的指纹。
 *
 * 为什么这要单独成一档（ISSUE #1641）：本仓库的门禁用例普遍要**真起子进程**
 *（Node / git / prettier / vitest worker），而它们的失败有**两种同形的退出码**：
 * 真断言失败，与「等资源等超了」。后者与负载成正比、与改动无关 —— 实测同一份
 * 代码、全量 66 个结构判据：8 核空闲时墙钟 31.9s 全绿；把机器压到 load≈26 时
 * 墙钟 182.8s 仍全绿；压到 load≈42（4 个 vitest worker 之外再叠 60+ 个自旋进程）
 * 时 `tests/check-a11y-rules.test.ts` 报 `Test timed out in 30000ms` —— **隔离重跑
 * 立刻全绿**。同一份代码、同一个提交，红的只是「那一刻机器有多满」。
 *
 * 于是四态不够用：负载假红在**两侧都会红**，`judge()` 会把它读成 `baseline-red`
 *（「别线的红」）—— 而它既不是别线的红、也不是你的红，是**这一台机器这一时刻的**
 * 红。照 `baseline-red` 的动作走（就地修 / 登记 `KNOWN_FAILED_FILES`）等于把
 * 一次调度抖动**记进历史**，而下一次它又不红 —— 那条登记从此就是一条会静默失效的账。
 *
 * ⚠️ 这是**指纹不是结论**：命中只说明「这一条值得按负载假红再验一次」，不说明它
 * 一定不是真回归（真回归也可能恰好卡在超时上）。所以 `judge()` 只把它降档到
 * `load-flake`，**不许**据此直接放行；放行的判据是**隔离重跑**（见 `nextSteps`）。
 *
 * 各条都是《本仓库实际见到过的原文》，不是从别处抄的形态：
 *   · vitest：`Test timed out in 30000ms.` / `Hook timed out in 45000ms.`；
 *   · vitest 池：`Failed to start forks worker` / `Timeout waiting for worker to respond`
 *     （实测这两种会把**退出码**打成非零，而一条真断言都没红）；
 *   · node:test / jest 形态：`Exceeded timeout of …` / `Timeout - Async callback`;
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
 * 一次「红」的输出是不是**超时形态**（纯函数，两向都能被用例钉住）。
 *
 * @param {string} [output]
 * @returns {boolean}
 */
export function isTimeoutShaped(output) {
  const text = String(output ?? "");
  return TIMEOUT_SIGNATURES.some((re) => re.test(text));
}

/**
 * 一次运行的**四种状态**（不是两种，也不是三种）—— 见 `runState()`。
 *
 * `no-conclusion` 与 `did-not-run` 分开是有内容的：前者是**判据自己声明**「这一跳
 * 没有结论」（本仓三态口径的退出码 `2`：0 绿 / 1 事实红 / 2 没跑起来，且 2 压 1），
 * 后者是判据**没机会**声明（127 找不到命令、或一条用例都没收集到）。两者的
 * `judge()` 处置相同（都归 `inconclusive`），但**下一动作不同** —— 所以报告里必须
 * 说得出是哪一种（`didNotRunSide()`），否则"清掉环境里串进来的变量再跑一次"这种
 * 只属于前者的出口就没地方写（ISSUE #2791）。
 * @typedef {"ran" | "did-not-run" | "no-conclusion" | "unknown"} RunState
 */

/**
 * **「一条用例都没收集到」的指纹**（ISSUE #1652）。
 *
 * 为什么与「127 = 没跑起来」分开：这条路上的退出码是 **1**（vitest 收集失败、
 * Node 的 `MODULE_NOT_FOUND`），与「判据跑了且红」逐字同形 —— 只读退出码必然把
 * 后者读成前者。它的现场是在基线快照里：
 *
 * ```
 * FAIL  node  tests/check-a11y-rules.test.ts
 *   `Cannot find package '@adobe/css-tools'`
 * Test Files  1 failed (1)
 *      Tests  no tests     ← 这一行就是指纹（收集到 0 条）
 * ```
 *
 * 「一条用例都没跑」**不可能是一次真实的门禁判决** —— 它在读的是「这一次环境
 * 配好了没有」，所以它应当压过 `baseline-red`（拿它去走那条下一动作，等于把一次
 * **环境故障**登记成一条**有主的账**：下一次它不红，从此没人解释得清它为什么在那儿；
 * 同 §13.6.4 反对把 `load-flake` 读成 `baseline-red` 的理由，只是换了触发原因）。
 *
 * 各条都是**原文形态**，不是猜的：
 *   · vitest：`Tests  no tests` 这一行（收集为 0；有的版本写 `no tests`，有的
 *     折在 `Test Files  N failed` 后面）；
 *   · 模块解析：`Cannot find package` / `Cannot find module`（Node 与 vitest 两条路）
 *     / `ERR_MODULE_NOT_FOUND` / `MODULE_NOT_FOUND`；
 *   · `0 tests` 那一族。
 *
 * ⚠️ 与 `TIMEOUT_SIGNATURES` 一样是**指纹**，但它的**误报面是零**：「收集到用例」
 * 是任何一次真实判决的前提，不存在「真红却被这条命中」的形态（用例是反向钉住的：
 * `1 failed / 3 failed tests` 必须仍判 `baseline-red`）。
 */
const DID_NOT_RUN_SIGNATURES = [
  /\bTests\s+no tests\b/i,
  /\bTest Files\s+\d+\s+failed\b[\s\S]{0,200}?\bTests\s+no tests\b/i,
  /\bCannot find (?:package|module)\b/,
  /\bERR_MODULE_NOT_FOUND\b/,
  /\bMODULE_NOT_FOUND\b/,
  /\bNo test files found\b/,
];

/**
 * 把一次运行归一成**三态**（纯函数，两向都能被用例钉住）。
 *
 * 为什么要三态：`runGate` 那边的「目标存不存在」是**静态**判据（`node <相对路径>`
 * 这一形态），而「目标存在、但运行时依赖解析失败」是**动态**的、静态那一步看不见
 * —— ISSUE #1652 的立案现场正是这一格（基线快照里 `@testing-library/jest-dom`
 * 链到了链不上的依赖，vitest 报 `Tests  no tests` 而退出码是 1）。
 *
 * `unknown` 只在**两边都看不出来**时给（既不是已知的「跑起来了」，也没有指纹）——
 * 它不是「跑起来了」的同义词，`judge()` 对它的处置与 `ran` 相同（不许把一次
 * 归属不明的读数当成判决）。这个区分留着是为了让用例能钉住「哪些输出算看得懂」。
 *
 * 判序（**指纹优先于退出码**）是有意的：`Tests  no tests` 出现的那些运行里，
 * 退出码是 1 还是 2 无关紧要 —— 一条用例都没跑，它就不是判决。
 *
 * @param {{code: number, output?: string}} run
 * @returns {RunState}
 */
export function runState(run) {
  const text = String(run.output ?? "");
  if (DID_NOT_RUN_SIGNATURES.some((re) => re.test(text))) {
    return "did-not-run";
  }
  if (run.code === 127) {
    return "did-not-run";
  }
  /* 三态口径的那个 **2**：判据**跑了**，但它自己答「这一跳没有结论」（前提不成立 /
   * 取不到读数 / 没收集到可判的东西）。它与 1 在「非零」这一层逐字同权过一次，
   * 于是被读成 `baseline-red` ⇒ 下一动作变成「就地修或登记进历史」，而事实是
   * 什么都没判（ISSUE #2791）。放在 127 与指纹**之后**：判序仍是「指纹优先于退出码」。 */
  if (run.code === 2) {
    return "no-conclusion";
  }
  if (run.code === 0 || run.code === 1) {
    return "ran";
  }
  /* 其余退出码（含 `-1` / 信号打死 / 别的工具自己的码）—— 这一侧看不出状态。
   * 与 `ran` 同处置：`judge()` 仍按退出码/指纹走，不额外降档。 */
  return "unknown";
}

/**
 * 一次运行的输出里有没有「一条用例都没收集到」的指纹（`runState` 的公开半边）。
 *
 * 单独导出：用例两向钉指纹表，以及别的入口（如 `premerge-check`）想自己看一眼时
 * 不必抄第二份正则。
 *
 * @param {string} [output]
 * @returns {boolean}
 */
export function isDidNotRunShaped(output) {
  const text = String(output ?? "");
  return DID_NOT_RUN_SIGNATURES.some((re) => re.test(text));
}

/**
 * 判决 —— **纯函数**（好让两向都能被用例钉住）。
 *
 * **「跑不起来」也不是「判据红了」**：判据没跑起来时非零退出码与「跑了且红」同形 ——
 * 只读退出码必然把后者读成前者，而这两件事的下一动作完全相反（一个去修代码，一个去
 * 查命令/环境为什么不对）。所以先判这一档，且**三条入口都要**：
 *   · 退出码 127（找不到模块 / 命令）；
 *   · **一条用例都没收集到**（`runState()` 的指纹，ISSUE #1652）—— 它退的是 **1**，
 *     与「判据跑了且红」逐字同形，而静态的「目标存不存在」看不见它（目标在、是它
 *     运行时的依赖链断了）。基线快照里 `@testing-library/jest-dom` →
 *     `Cannot find package '@adobe/css-tools'` ⇒ `Tests  no tests` 就是这一格。
 *   · 退出码 **2**（ISSUE #2791）—— 判据**跑了**，但它按本仓三态口径自己答
 *     「这一跳没有结论」（前提不成立 / 取不到读数）。它和 1 只差一个码位，
 *     而 `baseline-red` 的处置是「把这条红记进历史」（修掉或登记 `KNOWN_FAILED_FILES`）
 *     —— 拿一个「什么都没判」的读数去登记，登记的是一条不存在的账。
 *
 * **「等超了」也不是「判据红了」**（ISSUE #1641）：两侧都红、且**两侧的输出都是
 * 超时形态**时，报 `load-flake` 而不是 `baseline-red` —— 因为负载假红恰好长这样，
 * 而 `baseline-red` 的下一动作（就地修 / 登记）会把一次调度抖动记进历史。
 * 两侧都要判：只在单侧超时形态更像「你的改动让它变慢了」这一族，那归 `yours`。
 *
 * @param {{currentCode: number, baseCode: number | null, currentOutput?: string, baseOutput?: string}} input
 *   （`baseCode === null` = 这条只在单侧跑）
 * @returns {"current-green" | "inconclusive" | "baseline-red" | "yours" | "load-flake"}
 */
export function judge({ currentCode, baseCode, currentOutput, baseOutput }) {
  /* 「跑了但一条用例都没收集到」那一形退的是 **0**（vitest 过滤器语义，ISSUE #2400），
   * 与真绿在退出码上逐字同形 —— 只看码会把「没判」折成「判过了且没问题」。
   * 指纹与 127 / 退 1 那两形共用同一份（`isDidNotRunShaped`），判点仍是这一处：
   * 行 verdict、`didNotRun` 标注与整批 `summarizeRows` 由此保持同一句话。 */
  if (currentCode === 0) {
    return isDidNotRunShaped(currentOutput) ? "inconclusive" : "current-green";
  }
  /* 「跑不起来」两条入口都在最前面：127（找不到模块 / 命令）与「一条用例都没收集到」。
   * 两侧都要看 —— 本检出那一侧收集不到时，这一次复算问的根本不是「谁的红」。 */
  const current = runState({ code: currentCode, output: currentOutput });
  const base = runState({ code: baseCode ?? 0, output: baseOutput });
  if (
    current === "did-not-run" ||
    base === "did-not-run" ||
    current === "no-conclusion" ||
    base === "no-conclusion"
  ) {
    return "inconclusive";
  }
  /* `baseCode === null` = **这一条只在单侧跑**（`baseSide: false`）：它的对象是本检出
   * 这条线上的提交对象，基线快照里没有它们，所以「没比较过」不是「别线上也红」。
   * 它红的时候唯一的可能是「这次提交的声明与它自己的树矛盾」⇒ 纯粹的 `yours`。 */
  if (baseCode === null) {
    return "yours";
  }
  /* 两侧都红、且**两侧的输出都带超时指纹** ⇒ 负载假红优先于 `baseline-red`。
   * 只在单侧超时形态不降这一档（那更像「你让它变慢了」，归 `yours`）。 */
  if (baseCode !== 0 && isTimeoutShaped(currentOutput) && isTimeoutShaped(baseOutput)) {
    return "load-flake";
  }
  return baseCode === 0 ? "yours" : "baseline-red";
}

/**
 * 结论的「下一动作」话术 —— 与 §13.6.2 的处置口径逐字对应，不在这里发明新口径。
 *
 * @param {"current-green" | "inconclusive" | "baseline-red" | "yours" | "load-flake"} verdict
 * @param {{ref: string}} context
 * @returns {string[]}
 */
export function nextSteps(verdict, { ref }) {
  if (verdict === "current-green") {
    return ["你的检出上这条判据已经是绿的（已修 / 或它只在别的输入面上触发）—— 无需复算。"];
  }
  if (verdict === "inconclusive") {
    return [
      "命令在其中一侧**没跑起来 / 没结论**，不是「判据红了」——这次不构成「别线的红」的证据。",
      "三种形态（判据会点名「哪一侧、哪一种」那一行）：",
      "  · **一条用例都没收集到**（`Tests  no tests` / `Cannot find package|module` /",
      "    `ERR_MODULE_NOT_FOUND`）—— 它退的是 1，与「判据跑了且红」同形，所以只读",
      "    退出码必然误判。最常见于 ① 那条判据只存在**本检出的未提交改动**里",
      "    （基线是干净的上游提交，看不到它）；② 基线 worktree 的依赖链法出了问题",
      "    （`node_modules` 是**符号链接**过去的，链路断在临时目录那一侧）。",
      "    先做的动作：`cd` 进那个 worktree 跑一次 `pnpm install --frozen-lockfile`，",
      "    或把 worktree 建到与目标侧**同一个盘 / 同一个根**下（`--keep` 会把路径打出来）；",
      "  · **127**（找不到模块 / 命令）—— 命令写错、路径相对本检出，或 Windows 上写的是",
      "    `pnpm exec …`（`pnpm` 是 `.cmd` 垫片；改用 `node node_modules/<pkg>/<bin>` 形态）。",
      "  · **退 2**（ISSUE #2791）—— 判据**跑了**，但它按本仓三态口径自己答「这一跳没有结论」",
      "    （前提不成立 / 取不到读数；它自己的输出里通常逐字写着「不算绿也不算红」那一类话）。",
      "    下一动作**不是**修代码、更不是登记 `KNOWN_FAILED_FILES`（那等于把一条没判过的账",
      "    记进历史）：照它打印的那句去清前置 —— 例如环境里串进来的 `npm_config_*`、缺失的",
      "    引用或没装上的依赖 —— **然后重跑这一次复算**。",
      "先让它在本检出里真能跑出结论（提交或修正命令 / 清掉前置），再复算。",
    ];
  }
  if (verdict === "load-flake") {
    return [
      "两侧的红**都是超时形态** ⇒ 高度疑似**负载假红**（机器太满，不是代码）。",
      "这一条**不是** `baseline-red`：它既不是别线的红、也不是你的红，是这一刻机器的红 ——",
      "  所以**不要**照 baseline-red 的动作就地修或登记 KNOWN_FAILED_FILES（会把一次调度",
      "  抖动记进历史，而下一次它又不红，那条登记从此就是一条会静默失效的账）。",
      "下一步是**隔离复跑定性**（不要抬预算 —— §11.13 那句「看到 60s 都超时不要改成 120s」）：",
      "  · vitest：`pnpm exec vitest run --no-file-parallelism <那份文件>`；",
      "  · 仍红 ⇒ 才按真回归处置（这时它是 `yours` 或 `baseline-red`，重跑一次本命令即可复算）；",
      "  · 绿 ⇒ 就是负载假红：**为它降负载或直接放过**，并在提交说明里点名「这次是负载假红」。",
      "降负载的杠杆是并发而不是加预算：跑之前把 dev server / ComfyUI / 出图让开，" +
        "或按 §13.5.8 核对 `--maxWorkers`。",
    ];
  }
  if (verdict === "baseline-red") {
    return [
      `干净基线上**同样命中** ⇒ 这是别线的红（${ref}），与你的改动无关。`,
      "挡路的（硬闸类，所有人都提交不了）就地修掉：单独一个 commit + 单独一条 changelog.d 碎片，",
      "  碎片里写明「这条不是本 PR 引入的」+ 上面那句复算证据 + 为什么顺手收掉。",
      "不挡路的（棘轮类 / 测试基线红）按规范 §11.12 登记 KNOWN_FAILED_FILES 并写清归属。",
      "**不许**为它放宽判据，也不许 --no-verify 换一条干净历史。",
    ];
  }
  return [
    "干净基线上是绿的 ⇒ 这是**你的改动**引入的。",
    "修你自己的代码；不要去动基线、也不要把它登记成「别线的红」。",
  ];
}
