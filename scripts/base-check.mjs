#!/usr/bin/env node
/**
 * base-check.mjs — 「被门禁拦下时，先复算 master 基线」这件事的执行者
 * （规范 §13.6.2 第 1 步）。
 *
 * ── 为什么要有它 ──────────────────────────────────────────────────────
 *
 * `pre-commit` 拦的是**提交**，而 PR 在平台侧是 **squash 合并**、不跑本地钩子，
 * 且 ISSUE #623 之后**没有 CI 兜底**。两条合起来：**违规可以直接落进 `master`**，
 * 成为所有人接下来的基线。硬闸类（须为 0、没有基线文件可登记）落到主干之后，
 * **凡是从 `master` 分出的提交都被拦住**，包括与之无关的改动 —— 被拦的人第一
 * 反应是「我改坏了」。
 *
 * 规范 §13.6.2 把处置口径写得很清楚（先复算、再判断挡不挡路、修了要写清归属），
 * 但**这三步此前只靠人记得**：那段 `git worktree add … && node scripts/check-*.cjs
 * … && git worktree remove …` 写在文档与注释里，没有执行者。于是「这一条本身
 * 还没有机器判据」（§13.6.2 末段原话）。
 *
 * 本脚本把第 1 步变成一条命令：**把你被拦住的那条判据，在干净的上游提交上再跑一遍**，
 * 给出可归因的结论，并把碎片里要写的那句事实（哪个上游提交、命中几处）打出来。
 *
 * ── 第二条入口：合并前那一档（ISSUE #1591）───────────────────────────
 *
 * 上面那条是**事后**的（被拦下才知道）。而「最近又提交内容会导致 tsc 红」这件事的
 * 根子是**事前**那一跳没有人：平台侧 squash 合并**不跑本地钩子**（§13.6.2）、
 * 而 #623 之后**已无 CI 兜底**（§13.5.3）。于是「我的分支绿」→「`master` 绿」
 * 之间**没有任何判据**，违规可以直接落进主干 —— §13.6.2 末段那句
 * 「合并前跑一遍 `pnpm check:all`：这一条没有自动执行者」就是它。
 *
 * `--base` 补的就是那一跳，且**不新开一条通道**：它把「被拦下时复算一条」用的
 * 同一套事实（干净快照 + 五态归属）扩成一批 —— 面从 `.githooks/pre-commit` 的步骤
 * 里现算（`resolveMergeBatch`），所以不会漂；快照只建一次（50 条判据共用一份
 * `git worktree`，逐条建等于把同一个快照检十几遍）；快照里链上本检出的
 * `node_modules`（否则近一半判据会以「红」的形态报错）。
 *
 * **顺带的收益**：它不需要 CI、不花核时、零事件 —— 人点合并前跑一次，或在 PR 里
 * `@` 评审 NPC 唤起一轮（§13.5.4 的「按需召唤」那一层，不 `@` 就不跑）。
 *
 * ── 它判什么 ──────────────────────────────────────────────────────────
 *
 * 五态，各对应一个明确动作：
 *
 *   · `baseline-red`  —— 干净基线上**同样命中** ⇒ 别线的红，与你的改动无关。
 *     动作：挡路的（硬闸类）就地修掉，不挡路的按 §11.12 登记；**不许**为它放宽
 *     判据，也不许 `--no-verify`。
 *   · `yours`         —— 干净基线上**绿**、你的检出上红 ⇒ 你的改动引入的。
 *     动作：修你自己的代码，别去动基线。
 *   · `current-green` —— 你的检出上已经不红了 ⇒ 没什么可复算的（已修 / 判据只在
 *     特定输入面触发）。
 *   · `inconclusive`  —— 命令在其中一侧**没跑起来 / 没跑出结论** ⇒ 不构成证据。三条入口：
 *     ① 退出码 127（找不到模块 / 命令）；② **一条用例都没收集到**（`DID_NOT_RUN_SIGNATURES`，
 *     ISSUE #1652）：基线那一侧因依赖解析失败时，退出码是 1（vitest 收集失败 / Node 的
 *     `MODULE_NOT_FOUND`）—— 与「判据跑了且红」逐字同形，只读退出码必然读成
 *     `baseline-red`。最典型的成因是那条判据只存在**本检出未提交的改动**里：基线的
 *     worktree 是一个干净的上游快照，看不到工作区的未提交文件（这是正确语义，不是缺陷
 *     —— 本判据要复算的就是「干净的线上基线」）；③ **退出码 2**（ISSUE #2791）：判据
 *     跑了，但它按本仓三态口径自己答「这一跳没有结论」（前提不成立 / 取不到读数），
 *     而它自己的输出里通常逐字写着「不算绿也不算红」—— 过去 2 与 1 在代码层面逐字同权，
 *     于是这一格被报成 `baseline-red`，下一动作被指到「就地修或登记 `KNOWN_FAILED_FILES`」，
 *     而事实是什么都没判。三种入口都**不许**读成「别线的红」；③ 的下一动作还与 ①② 不同
 *     （①② 是"让命令能跑起来"，③ 是"清掉它点名的那个前置再复算"）。
 *   · `load-flake`    —— **两侧都红、且两侧的输出都是超时形态** ⇒ 高度疑似
 *     「机器太满」而不是代码（ISSUE #1641）。它既不是别线的红、也不是你的红，
 *     是这一刻机器的红 ⇒ **不照 `baseline-red` 的动作走**（那会把一次调度抖动
 *     登记进历史），而是先隔离复跑定性（`--no-file-parallelism`）。
 *     指纹见 `TIMEOUT_SIGNATURES`：**指纹不是结论**，命中只说明「值得再验一次」。
 *
 * **优先级**（`judge()` 逐条判的顺序，也是整批 `summarizeRows` 的档位高低）：
 *
 *     current-green > inconclusive > yours > load-flake > baseline-red
 *
 * 即：绿压过一切；「没跑出结论」压过一切红（127、「一条用例都没收集到」与退 **2** 都算）。
 *
 * ⚠️ 「`current-green` 压过一切」只在**被判的就是本地这棵树**时成立（ISSUE #3043）：
 * 平台 PR 建的是**合并态**（分支 ⊕ 目标分支），「本地绿 + 平台红」这一形下绿压不出证据 ——
 * 平台红的那格建的是另一棵树。`--merge-state` 把那棵树真量一遍（`evaluateMergeState()`），
 * 结论多一档 `merge-red`（红来自组合，不是基线的红、也不是本检出的红）；
 * 没给这个输入时行为与从前逐字一致。
 *
 * ── 第三条入口：Windows 上的 `pnpm exec …` 形态（ISSUE #1652 顺带）──────
 *
 * `pnpm` 在 Windows 上是 `.cmd` 垫片 —— Node 直接 spawn 它必然 `ENOENT` / `EINVAL`
 * （⇒ 127 ⇒ `inconclusive`）。这不算判错（它确实跑不起来），但话术里必须直接说出口，
 * 否则人以为是自己命令写错了。出路是**经唯一形态判据** `pnpmInvocation()`
 * （`runGate` → `resolveGateInvocation`）：它会选中 PowerShell 宿主的 `.ps1` 形态，
 * 找不到时给一条点名 `pnpm check:toolchain` 的可读出口。
 *
 * **不做的事**（都写进 §13.6.2 了）：不替你决定「挡不挡路」、不自动登记
 * `KNOWN_FAILED_FILES`、不自动改判据 —— 那是判断，本脚本只保证**事实**这一半可复算。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────
 *
 *   node scripts/base-check.mjs <门禁命令…>        # 复算（默认不清远端）
 *   node scripts/base-check.mjs --fetch <门禁命令…> # 先 git fetch 再复算
 *   node scripts/base-check.mjs --json <门禁命令…>  # 机器可读（碎片/脚本消费）
 *   node scripts/base-check.mjs --keep <门禁命令…>  # 保留临时 worktree（人工排查）
 *
 * **合并前那一档**（ISSUE #1591）：
 *
 *   node scripts/base-check.mjs --base               # 复算「钩子里那批全仓判据」
 *   node scripts/base-check.mjs --base --json        # 机器可读（逐条给归属）
 *   node scripts/base-check.mjs --base "tsc --noEmit" # 只复算点名的那几条
 *
 * `<门禁命令…>` 是**你被拦住的那一条**，按它在文档/钩子里的写法给，例如：
 *
 *   node scripts/base-check.mjs check-ui-primitives
 *   node scripts/base-check.mjs node scripts/check-ui-primitives.cjs
 *   node scripts/base-check.mjs pnpm exec vitest run tests/check-title-bar-clearance.test.ts
 *
 * 也支持「只给等宽标签」的简写：`.githooks/pre-commit` 里 `run "<标签>" <命令>`
 * 的标签可以直接当参数（脚本自己去钩子里查那条命令 —— 标签是唯一的，
 * 不抄第二份命令清单）。
 *
 * 退出码：`0` = 事实已复算（三态都算成功，结论在输出里）；`1` = 复算过程本身失败
 * （不是 git 检出 / 取不到上游引用 / 命令拼不出来）—— 与「判据红了」分开，
 * 因为后者是本脚本要**报告**的事实、不是它的失败。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";

/* git 与 ref 层、钩子解析层、判决层各自拆成同目录模块（ISSUE #1811 拆 R5
 * 超限文件）：主文件只留编排与 CLI。下面**只 import 编排层真正用到的**，
 * 其余一律走 `export … from` —— 那两件事别混着写：一条 `import` 名单与一条
 * `export` 名单各抄一份「谁是公开面」，早晚会漂开（漂开时 tsc 报的是
 * 「未使用 import」，而它看起来像「清掉的死代码」）。 */
import {
  git,
  isGitCheckout,
  resolveAttributionRef,
  resolveMergeBaseRef,
  ROOT,
} from "./base-check/git-ref.mjs";
import { resolveGateCommand, resolveMergeBatch, runGate } from "./base-check/hook-steps.mjs";
import { didNotRunSide, judge, judgeMergeState, nextSteps } from "./base-check/verdict.mjs";
import { linkDependencies, unlinkDependencies } from "./base-check/snapshot-link.mjs";

export {
  git,
  isGitCheckout,
  resolveAttributionRef,
  resolveMergeBaseRef,
  resolveUpstreamRef,
  ROOT,
} from "./base-check/git-ref.mjs";
export {
  commandTargetState,
  groupSteps,
  mayDecideOnCleanSnapshot,
  normalizeRun,
  readHookSteps,
  resolveGateCommand,
  resolveMergeBatch,
  runGate,
  tokenize,
} from "./base-check/hook-steps.mjs";
export {
  isDidNotRunShaped,
  isTimeoutShaped,
  judge,
  judgeMergeState,
  nextSteps,
  runState,
} from "./base-check/verdict.mjs";

/**
 * 复算一次（编排本体）。
 *
 * 临时 worktree 建在系统临时目录（**不在仓库旁边**）：§13.6.2 的示例写
 * `../.wt-base-check`，那会把 worktree 留在仓库的父目录里，忘记删就永久占位
 * （而且会被某些工具的目录遍历扫到）。放 `os.tmpdir()` 下不会有这个问题。
 *
 * @param {{argv: string[], label: string, ref: string, keep?: boolean, json?: boolean, mergeState?: {into: string} | null}} input
 *   （`mergeState` 是 `--merge-state` 那一档的输入：`into` 是合并目标 ref。只接
 *   单命令档；给它的那一跑问的是「分支 ⊕ 目标」那棵树，见 `evaluateMergeState()`。）
 * @returns {number} 退出码（0 = 事实已复算；1 = 复算过程失败）
 */
export function baseCheck({ argv, label, ref, keep = false, json = false, mergeState = null }) {
  /* `--merge-state`（ISSUE #3043）：本检出绿、平台红的现场要量的是**合并态**那棵树
   * （分支 ⊕ 目标分支），不是本地这棵。它接在单命令档上：本地有红的现场五态归因
   * 已经够用，只有「本地全绿」才轮得到第三种树。 */
  if (mergeState) {
    return evaluateMergeState({
      commands: [{ argv, label }],
      into: mergeState.into,
      ref,
      keep,
      json,
    });
  }
  return baseCheckMany({
    commands: [{ argv, label }],
    ref,
    keep,
    json,
    /* 单命令档的输出形状是**既有契约**（`--json` 的三个字段被用例与碎片里的
     * 那句事实引用着）：一批那条入口给的是行表，这一档仍给
     * `{label, verdict, currentCode, baseCode, commit}`。 */
    shape: "single",
  });
}

/**
 * 在**干净的上游快照**上跑一组命令（`baseCheck` 的单命令档是它的一个特例）。
 *
 * 为什么要把「建/收临时 worktree」从单命令那档里提出来：合并前的复算面不是一条判据，
 * 而是**门禁里所有硬闸类**（tsc / eslint / 结构硬规则 / 棘轮…）。每条命令各建一次
 * worktree 等于把同一个快照 `git worktree add` 十几遍 —— 而 `git worktree add` 的
 * 代价随检出大小走（本仓库实测每条命令一次是分钟量级）。这里一次建、多条命令共用，
 * 收尾仍然一次。
 *
 * 四种情形（`summary` 逐字对应）：
 *   · 全部绿 ⇒ `base-green`（上游基线干净，这一批没有要复算的事实）；
 *   · 任一条**没跑出结论**（127 / 退 2 / 一条用例都没收集到）⇒ `inconclusive`，且**整批**
 *     不构成证据 —— 127 与「跑了且红」在退出码上同形（Node 的 `MODULE_NOT_FOUND` 也是 1），
 *     而退 **2** 与退 1 只差一个码位（ISSUE #2791）：拿它们当「别线的红」是把人往错方向送；
 *   · 有红、且红的那些在基线上**同样命中** ⇒ `baseline-red`（别线的红，逐条列出）；
 *   · 有红、但基线上绿 ⇒ `yours`（本检出的红）。
 *
 *   `onTiming` 是**可选的逐格计时回调**（ISSUE #2832）：本检出每条门、快照建树、快照侧每条门
 *   各回调一次（`label` 带「本检出:/快照:」前缀区分两侧，快照建树单独一格）。只记账、
 *   不参与任何判决 —— 不给就是没有这一格，行为与改动前逐字一致。
 * @param {{commands: Array<{argv: string[], label: string, baseSide?: boolean}>, ref: string, keep?: boolean, json?: boolean, shape?: "single" | "batch", onTiming?: (label: string, ms: number) => void, onProgress?: (label: string, index: number, count: number) => void}} input
 * @returns {number} 退出码（0 = 事实已复算；1 = 复算过程失败）
 */
export function baseCheckMany({
  commands,
  ref,
  keep = false,
  json = false,
  shape = "batch",
  onTiming = undefined,
  onProgress = undefined,
}) {
  /* 本检出那一侧：**先跑、先收**（不建 worktree 就能判掉的情形不付这笔 —— 同
   * `baseCheck` 的旧口径）。 */
  /** @type {Array<{code: number, output: string}>} */
  const current = [];
  for (const [i, c] of commands.entries()) {
    onProgress?.(`本检出:${c.label}`, i + 1, commands.length);
    const t0 = performance.now();
    current.push(runGate(c.argv, ROOT));
    onTiming?.(`本检出:${c.label}`, performance.now() - t0);
  }
  if (current.every((r) => r.code === 0)) {
    return reportMany(
      {
        ref,
        /* 「本检出全绿」这件事本身有两种读法（已修 / 判据只在别的输入面触发），
         * 由 `nextSteps` 按 `current-green` 的话术说 —— 与单命令档同一个词，
         * 免得同一个事实在两条入口上说成两回事。 */
        summary: "current-green",
        rows: commands.map((c, i) => ({
          label: c.label,
          currentCode: current[i]?.code ?? 127,
          baseCode: null,
        })),
      },
      { json, shape },
    );
  }

  /** 本次尝试过的候选目录（成功那个是 worktree，其余都只是空目录）—— 收尾一律清。 */
  const attempts = [];
  let worktreePath = null;
  /** 本检出 `node_modules` 链进快照的那个 reparse point（见 `linkDependencies`）。 */
  let dependencyLink = null;
  try {
    // `--detach` 是必须的：上游 ref 是 remote-tracking 分支，直接 checkout 会
    // 让 git 拒绝（「already checked out」/ 进不了分离态）。复核只需一个只读快照。
    //
    // **建一次、失败了换一个目录再建一次**：这一层在并发跑门禁时是环境噪声的受害者
    // （实测 `.git/index: index file open failed: Not a directory`，见 `GIT_ENV_DENY`
    // 那段）。两次都失败才是真失败 —— 不许把它读成「复算不出结论」。
    const snapshotT0 = performance.now();
    for (let attempt = 0; attempt < 2 && !worktreePath; attempt++) {
      const candidate = fs.mkdtempSync(path.join(os.tmpdir(), "comfy-base-check-"));
      attempts.push(candidate);
      // `mkdtempSync` 建出的目录必须为空，而 `git worktree add` 要求目标**不存在**。
      fs.rmSync(candidate, { recursive: true, force: true });
      const add = git(["worktree", "add", "--detach", candidate, ref]);
      if (add.ok) {
        worktreePath = candidate;
      } else if (attempt === 1) {
        fail(`建临时 worktree 失败（${ref}）：${add.stderr}`);
        return 1;
      }
    }
    if (!worktreePath) {
      /* 循环保证到不了这里（两次都失败已在上面的 `attempt === 1` 分支 return 1）——
       * 显式收口只是让类型收窄，不是判据。 */
      fail(`建临时 worktree 失败（${ref}）：两次都没成功`);
      return 1;
    }
    /* 快照里**没有 `node_modules`**（`git worktree` 只检出受版本控制的文件），
     * 而这一批里有近一半判据要它 —— tsc / eslint / 走 TS AST 的那几条。
     * 缺了它的表现是**最坏的一种**：`Cannot find module 'typescript'` 退出 1，
     * 与「判据跑了且红」逐字同形（`commandTargetState` 只认得 `node <相对路径>`
     * 那一形态，`pnpm exec` 的目标在文件系统上不存在）。实测漏这一手时，
     * `--base` 全批里有 9 条这样「红」着报出来。
     *
     * 处置：把本检出的 `node_modules` **符号链接**进快照。方向是只读那一侧
     * （判据在快照里跑，不写依赖树），而 pnpm 自己的 `node_modules/<pkg>` 本来就
     * 是指向 store 的链接 —— 这一手不改变任何既有语义，只是让快照看得见依赖。
     * 刻意**不**用 `cp`：那是把依赖树整份复制（本仓库实测 GB 量级），而它每次
     * 复算都要付一遍。 */
    dependencyLink = linkDependencies(ROOT, worktreePath);
    onTiming?.("快照建树(worktree add + 链依赖)", performance.now() - snapshotT0);
    const commit = git(["rev-parse", "--short", "HEAD"], worktreePath).stdout;
    const rows = [];
    for (const [i, c] of commands.entries()) {
      const cur = current[i]?.code ?? 127;
      onProgress?.(`快照:${c.label}`, i + 1, commands.length);
      /* `baseSide: false` ⇒ **不在快照上跑**（理由见 `CHAINED_STEPS` 那条注释）：
       * 它的 `baseCode` 记 `null`（= 未跑），判决只看本检出那一侧。 */
      const baseT0 = performance.now();
      const base = c.baseSide === false ? null : runGate(c.argv, worktreePath);
      if (base !== null) {
        onTiming?.(`快照:${c.label}`, performance.now() - baseT0);
      }
      /* 两侧的输出都要传给 `judge`：`load-flake` 那一档看的正是「两边是不是**都**
       * 超时形态」—— 本检出那一次的输出原本只在 `current` 里躺着、判完就丢，
       * 于是这一档在 `--base` 这一批里判不出来（ISSUE #1641）。 */
      const curOutput = current[i]?.output;
      const baseOutput = base === null ? undefined : base.output;
      /* `load-flake` 那一档要看**两侧**的输出，而 `summarizeRows` 会把整批再判
       * 一遍（它只看「这一行是不是超时形态」，不看上一轮的 `verdict`）—— 所以
       * 两份输出都要落进行里，不能只在 `judge()` 那一次调用里传一下就丢。
       * `output` 是**本检出**这一次的全文：行里已经有 `baseOutputTail`（末 20 行），
       * 但本检出那一侧此前一个字都没留（ISSUE #1641）。 */
      const rowVerdict = judge({
        currentCode: cur,
        baseCode: base === null ? null : base.code,
        currentOutput: curOutput,
        baseOutput,
      });
      rows.push({
        label: c.label,
        currentCode: cur,
        baseCode: base === null ? null : base.code,
        /* `base === null` ⇒ 这一条只在单侧跑（`baseSide: false`）：`judge` 认得
         * `null`，把它读成 `yours`（「没比较过」不是「别线上也红」）。 */
        verdict: rowVerdict,
        ...(curOutput ? { output: curOutput } : {}),
        ...(baseOutput ? { baseOutput } : {}),
        /* 127 与「一条用例都没收集到」在退出码上是同形的，行里只看得见那个数字 ——
         * 所以把「哪一侧、为什么」写进行里（ISSUE #1652），报告才能直接点名，
         * 而不是让人自己去翻 `baseOutputTail`。 */
        ...(rowVerdict === "inconclusive"
          ? { didNotRun: didNotRunSide({ cur, curOutput, base, baseOutput }) }
          : {}),
        ...(base && base.code !== 0 ? { baseOutputTail: tail(base.output) } : {}),
      });
    }
    return reportMany({ ref, commit, summary: summarizeRows(rows), rows }, { json, shape });
  } finally {
    /* 未成为 worktree 的候选目录（建失败那一次留下的空目录）直接删。 */
    for (const candidate of attempts) {
      if (candidate !== worktreePath) {
        fs.rmSync(candidate, { recursive: true, force: true });
      }
    }
    if (worktreePath && !keep) {
      /* 顺序要紧：**先摘掉那条指回本检出 `node_modules` 的链接**，再让 git 摘登记。
       * 两个清理动作在 Windows 上都会**穿 junction 走进目标目录**逐个删，而目标就是
       * 调用者的工作树 —— 实测一次 `git worktree remove --force` 之后，主树的
       * `node_modules/.bin` 连根上的受版本控制文件一起没了（复算工具销毁了它正在
       * 复算的那棵树）。摘不掉就**不摘 worktree**：宁可留下一个临时目录并说清楚，
       * 也不拿销毁工作树换一次复算的整洁。 */
      const linkGone = unlinkDependencies(dependencyLink);
      if (dependencyLink && !linkGone) {
        process.stderr.write(
          "[base-check] 快照里的 node_modules 链接没摘掉 —— **跳过 worktree 清理**：" +
            "继续删会穿链接删进本检出。请手工删除这个目录：" +
            `${worktreePath}\n`,
        );
      } else {
        // 先让 git 摘掉登记，再兜底 rm —— `git worktree remove` 在目录已被删时
        // 会失败，所以两条都要（顺序不能反）。
        git(["worktree", "remove", "--force", worktreePath]);
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
    } else if (worktreePath) {
      process.stdout.write(`[base-check] 保留临时 worktree：${worktreePath}\n`);
    }
  }
}

/**
 * 合并态复算（`--merge-state`，ISSUE #3043）—— 本检出绿、平台红的现场要量的**第三种树**。
 *
 * 平台 PR 建的是**合并态**（分支 ⊕ 目标分支），而 `baseCheckMany` 的短路在「本检出全绿」
 * 时给 `current-green`（「无需复算」）—— 那句话的隐含前提是「本地这棵树就是被判的那棵树」，
 * 合并态恰恰不是。这里把那棵树真建出来量一遍：临时 worktree 落在 `into` 上，
 * `git merge --no-commit --no-ff <HEAD>` 合出「分支 ⊕ 目标」的工作树与索引
 * （与平台合并预览同一内容；不加 `--no-ff` 会被快进吞掉本分支），然后跑同一组命令。
 *
 * 判决走 `judgeMergeState()`（三档：current-green **带证据** / merge-red / inconclusive）；
 * 冲突建不出树 ⇒ 整档 `inconclusive` 并点名冲突面 —— 平台同样解不动（那一形 PR 不派生 CI）。
 *
 * 本地有红的现场不进这一档：退回 `baseCheckMany` 的五态归因（那条路早就能回答「谁的红」）。
 *
 * @param {{commands: Array<{argv: string[], label: string}>, into: string, ref: string, keep?: boolean, json?: boolean}} input
 * @returns {number} 退出码（0 = 事实已复算；1 = 复算过程失败）
 */
function evaluateMergeState({ commands, into, ref, keep = false, json = false }) {
  /* 本检出那一侧：先跑、先收（与 `baseCheckMany` 同口径）。 */
  /** @type {Array<{code: number, output: string}>} */
  const current = [];
  for (const c of commands) {
    current.push(runGate(c.argv, ROOT));
  }
  if (!current.every((r) => r.code === 0)) {
    return baseCheckMany({ commands, ref, keep, json, shape: "single" });
  }
  const headSha = git(["rev-parse", "HEAD"]).stdout;
  const intoSha = git(["rev-parse", "--verify", "--quiet", into]).stdout;
  if (!headSha || !intoSha) {
    fail(
      `取不到合并态的两端（HEAD=${headSha || "无"}，${into}=${intoSha || "无"}）—— ` +
        "先 `git fetch`，或用 `--merge-into <ref>` 点名另一条目标 ref",
    );
    return 1;
  }
  process.stdout.write(
    `[base-check] 合并态：本检出绿（${commands.length} 条），复算跑在 ` +
      `${into}@${intoSha.slice(0, 8)} ⊕ HEAD ${headSha.slice(0, 8)} 这棵树上 —— ` +
      "本地绿证明不了它绿（ISSUE #3043）\n",
  );
  /** @type {string[]} */
  const attempts = [];
  let worktreePath = null;
  let dependencyLink = null;
  try {
    for (let attempt = 0; attempt < 2 && !worktreePath; attempt++) {
      const candidate = fs.mkdtempSync(path.join(os.tmpdir(), "comfy-base-check-merge-"));
      attempts.push(candidate);
      fs.rmSync(candidate, { recursive: true, force: true });
      const add = git(["worktree", "add", "--detach", candidate, intoSha]);
      if (add.ok) {
        worktreePath = candidate;
      } else if (attempt === 1) {
        fail(`建合并态 worktree 失败（${into}@${intoSha.slice(0, 8)}）：${add.stderr}`);
        return 1;
      }
    }
    if (!worktreePath) {
      /* 循环保证到不了这里（两次都失败已在上面的 `attempt === 1` 分支 return 1）——
       * 显式收口与 `baseCheckMany` 同一个用途：让类型收窄，不是判据。 */
      fail(`建合并态 worktree 失败（${into}@${intoSha.slice(0, 8)}）：两次都没成功`);
      return 1;
    }
    dependencyLink = linkDependencies(ROOT, worktreePath);
    /* `--no-commit`：要的是「合并后的树」，不是一笔合并提交 —— 停在提交之前，
     * 工作树与索引已经是那棵树，跑判据足够。 */
    const merge = git(["merge", "--no-commit", "--no-ff", headSha], worktreePath);
    if (!merge.ok) {
      const conflicts = git(
        ["-c", "core.quotePath=false", "diff", "--name-only", "--diff-filter=U"],
        worktreePath,
      ).stdout;
      const conflictFiles = conflicts.split("\n").filter(Boolean);
      const conflictList = `${conflictFiles.slice(0, 5).join("、")}${conflictFiles.length > 5 ? " …" : ""}`;
      const why =
        conflictFiles.length > 0
          ? `与 ${into} 有冲突（${conflictFiles.length} 份）：${conflictList}`
          : `git merge 失败：${tail(merge.stderr, 5)}`;
      process.stdout.write(`[base-check] 合并态建不出来 —— ${why}\n`);
      printMergeStateReport({
        json,
        summary: "inconclusive",
        into,
        intoSha,
        headSha,
        rows: commands.map((c, i) => ({
          label: c.label,
          currentCode: current[i]?.code ?? 0,
          mergeCode: null,
          verdict: "inconclusive",
          didNotRun: why,
        })),
      });
      return 0;
    }
    const rows = [];
    for (const [i, c] of commands.entries()) {
      const run = runGate(c.argv, worktreePath);
      const verdict = judgeMergeState({
        currentCode: current[i]?.code ?? 0,
        mergeCode: run.code,
        mergeOutput: run.output,
      });
      rows.push({
        label: c.label,
        currentCode: current[i]?.code ?? 0,
        mergeCode: run.code,
        verdict,
        ...(run.code === 0 ? {} : { mergeOutputTail: tail(run.output) }),
        ...(verdict === "inconclusive"
          ? {
              didNotRun: didNotRunSide({
                cur: current[i]?.code ?? 0,
                curOutput: current[i]?.output,
                base: run,
                baseOutput: run.output,
              }),
            }
          : {}),
      });
    }
    const summary = rows.some((r) => r.verdict === "inconclusive")
      ? "inconclusive"
      : rows.some((r) => r.verdict === "merge-red")
        ? "merge-red"
        : "current-green";
    printMergeStateReport({ json, summary, into, intoSha, headSha, rows });
    return 0;
  } finally {
    for (const candidate of attempts) {
      if (candidate !== worktreePath) {
        fs.rmSync(candidate, { recursive: true, force: true });
      }
    }
    if (worktreePath && !keep) {
      /* 顺序与 `baseCheckMany` 同一条铁律：先摘 node_modules 链接再摘登记 ——
       * `git worktree remove --force` 会穿 junction 删进本检出（那次实测连根拔了
       * 主树的 node_modules）。摘不掉链接就跳过清理并点名，不拿工作树换整洁。 */
      const linkGone = unlinkDependencies(dependencyLink);
      if (dependencyLink && !linkGone) {
        process.stderr.write(
          "[base-check] 快照里的 node_modules 链接没摘掉 —— **跳过 worktree 清理**：" +
            `继续删会穿链接删进本检出。请手工删除这个目录：${worktreePath}\n`,
        );
      } else {
        /* 合并失败的那一档树上有 MERGE_HEAD / 未合并条目，先 abort（失败忽略）再摘。 */
        git(["merge", "--abort"], worktreePath);
        git(["worktree", "remove", "--force", worktreePath]);
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
    } else if (worktreePath) {
      process.stdout.write(`[base-check] 保留临时 worktree：${worktreePath}\n`);
    }
  }
}

/**
 * 合并态那一档的报告打印（这一档有**自己的 JSON 形状**，不挤进 `--base` 那份契约）。
 *
 * @param {{json: boolean, summary: "current-green" | "inconclusive" | "merge-red", into: string, intoSha: string, headSha: string, rows: Array<{label: string, currentCode: number, mergeCode: number | null, verdict: string, didNotRun?: string, mergeOutputTail?: string}>}} input
 */
function printMergeStateReport({ json, summary, into, intoSha, headSha, rows }) {
  const tree = `${into}@${intoSha.slice(0, 8)} ⊕ HEAD ${headSha.slice(0, 8)}`;
  if (json) {
    process.stdout.write(`${JSON.stringify({ summary, tree, rows }, null, 2)}\n`);
    return;
  }
  for (const r of rows) {
    process.stdout.write(
      `  · ${r.mergeCode === 0 ? "绿" : r.verdict}  ${r.label}` +
        `（本检出 ${r.currentCode} / 合并态 ${r.mergeCode ?? "未跑"}）\n`,
    );
    if (r.didNotRun) {
      process.stdout.write(`      ↳ 没跑出结论：${r.didNotRun}\n`);
    }
  }
  process.stdout.write(`[base-check] 结论：${summary}（树：${tree}）\n`);
  for (const line of nextSteps(summary, { ref: into })) {
    process.stdout.write(`[base-check] ${line}\n`);
  }
  for (const r of rows) {
    if (!r.mergeOutputTail) {
      continue;
    }
    process.stdout.write(`[base-check] 「${r.label}」合并态输出末尾：\n`);
    process.stdout.write(
      `${r.mergeOutputTail
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n")}\n`,
    );
  }
}

/* 依赖链接那一层在 `base-check/snapshot-link.mjs`（ISSUE #3043 拆出：本文件加合并态
 * 那一档后越过 900 行硬闸，而这一对自包含、有自己的用例）。re-export 保留：
 * `tests/base-check-snapshot-link.test.ts` 与碎片里引用的名字不变。 */
export { linkDependencies, unlinkDependencies } from "./base-check/snapshot-link.mjs";
/* 「没跑出结论」的**哪一侧、哪一种**是判决话术，实现在 verdict.mjs（ISSUE #3043 拆出，
 * 理由同上）。re-export 保留：tests 与 `reportMany` 引用的名字不变。 */
export { didNotRunSide } from "./base-check/verdict.mjs";

/**
 * 一组行 → 整批的结论（纯函数，两向都能被用例钉住）。
 *
 * **优先级是 `inconclusive` 最高**，不是「有红就报红」：127 说明这一条**没跑起来**，
 * 而「没跑起来」与「跑了且红」在退出码上同形 —— 把整批结论落在它上面等于拿一个
 * 无法归因的读数下判决。
 *
 * `yours` 压过 `load-flake`：你自己引入的那条必须改代码，而负载假红只需要隔离复跑
 * 一次 —— 报成 `load-flake` 会让「有一条真红」这件事被一条抖动盖住（同下一条理由）。
 * `load-flake` 压过 `baseline-red`：混着一批「别线的红」时，若其中也有超时形态的，
 * 整批报 `baseline-red` 会让人把抖动一起登记进 `KNOWN_FAILED_FILES`。
 *
 * @param {Array<{currentCode: number, baseCode: number | null, output?: string, currentOutput?: string, baseOutput?: string, didNotRun?: string}>} rows
 * @returns {"current-green" | "inconclusive" | "baseline-red" | "yours" | "load-flake"}
 */
export function summarizeRows(rows) {
  if (rows.length === 0) {
    return "inconclusive";
  }
  /* 逐条全走同一份 `judge()`（ISSUE #2400）：0 码但「一条用例都没收集到」的行
   * 在 judge 里落 inconclusive，「段绿 + 逐条里混着一条没判的」在整批这里就折成
   * inconclusive（段码 2），不再只在 baseline-red 那一支才被读出来。 */
  const verdicts = rows.map((r) =>
    judge({
      currentCode: r.currentCode,
      baseCode: r.baseCode,
      /* 两个来源都收：行里显式给了 `currentOutput` 就用它，否则回落到
       * `output`（本检出那一次的全文，见上面 rows.push 的注释）。 */
      currentOutput: r.currentOutput ?? r.output,
      baseOutput: r.baseOutput,
    }),
  );
  if (verdicts.includes("inconclusive")) {
    return "inconclusive";
  }
  if (verdicts.every((v) => v === "current-green")) {
    return "current-green";
  }
  /* 混着「别线的红」与「你的红」时，**按更严重的那一档报**（`yours`）——
   * 别线的红可以就地收掉或登记，而你自己引入的那条必须改代码，两者都要人看见；
   * 报成 `baseline-red` 会让人以为整批都与自己无关。 */
  if (verdicts.includes("yours")) {
    return "yours";
  }
  if (verdicts.includes("load-flake")) {
    return "load-flake";
  }
  return "baseline-red";
}

/**
 * 整批结论的「下一动作」话术 —— 与单命令档同源（`nextSteps`），只在有红时点名是哪几条。
 * @param {"current-green" | "inconclusive" | "baseline-red" | "yours" | "load-flake"} summary
 * @param {Array<{label: string, verdict?: string}>} reds
 * @param {{ref: string}} context
 * @returns {string[]}
 */
export function nextStepsMany(summary, reds, { ref }) {
  if (summary === "current-green") {
    return nextSteps("current-green", { ref });
  }
  const head = reds.map((r) => `${r.label}（${r.verdict}）`);
  return [`红的那几条：${head.join("、")}。`, ...nextSteps(summary, { ref })];
}

/**
 * 输出末 N 行（红线常在末尾；全量输出会把结论挤出屏幕）。
 *
 * @param {unknown} text
 * @param {number} [lines]
 * @returns {string}
 */
function tail(text, lines = 20) {
  const all = String(text ?? "")
    .trimEnd()
    .split("\n");
  return all.slice(-lines).join("\n");
}

/**
 * 复算过程本身失败（与「判据红了」分开）。
 *
 * @param {unknown} message
 */
function fail(message) {
  process.stderr.write(`[base-check] ${message}\n`);
}

/**
 * 一**批**判据的结论打印（`--base` 那条入口）。
 *
 * 逐行列出「本检出码 / 基线码 / 归属」，再给整批的下一动作 —— 合并前要看的是
 * 「这一批里哪几条会挡路、其中哪几条不是我的」，而不是每一条各自的散文。
 *
 * @param {{ref: string, commit?: string, summary: "current-green" | "inconclusive" | "baseline-red" | "yours" | "load-flake", rows: Array<{label: string, currentCode: number, baseCode: number | null, verdict?: string, didNotRun?: string, baseOutputTail?: string}>}} result
 * @param {{json: boolean, shape?: "single" | "batch"}} opts
 * @returns {number}
 */
function reportMany(result, { json, shape = "batch" }) {
  const { ref, commit, summary, rows } = result;
  /* 单命令档：形状与 `baseCheck` 的既有契约逐字一致（见调用点那条注释）。 */
  if (shape === "single") {
    const only = rows[0] ?? {
      label: "（空）",
      currentCode: 127,
      baseCode: null,
    };
    const single = {
      label: only.label,
      ref,
      verdict: summary,
      currentCode: only.currentCode,
      baseCode: only.baseCode,
      ...(commit ? { commit } : {}),
      ...(only.didNotRun ? { didNotRun: only.didNotRun } : {}),
      ...(only.baseOutputTail ? { baseOutputTail: only.baseOutputTail } : {}),
    };
    if (json) {
      process.stdout.write(`${JSON.stringify(single, null, 2)}\n`);
      return 0;
    }
    process.stdout.write(`[base-check] 判据：${single.label}\n`);
    process.stdout.write(
      `[base-check] 结论：${single.verdict}` +
        `（本检出 ${single.currentCode}，${ref}${commit ? ` @ ${commit}` : ""} ${
          single.baseCode ?? "未跑"
        }）\n`,
    );
    if (only.didNotRun) {
      process.stdout.write(`[base-check] 没跑出结论：${only.didNotRun}\n`);
    }
    if (only.baseOutputTail) {
      process.stdout.write(`[base-check] 基线那次输出的末尾：\n`);
      process.stdout.write(
        `${only.baseOutputTail
          .split("\n")
          .map((l) => `    ${l}`)
          .join("\n")}\n`,
      );
    }
    for (const line of nextSteps(single.verdict, { ref })) {
      process.stdout.write(`[base-check] ${line}\n`);
    }
    return 0;
  }
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  const reds = rows.filter((r) => r.currentCode !== 0);
  process.stdout.write(
    `[base-check] 合并前复算：${rows.length} 条判据 —— ` +
      `红 ${reds.length} 条（基线 ${ref}${commit ? ` @ ${commit}` : ""}）\n`,
  );
  for (const r of rows) {
    const mark = r.currentCode === 0 ? "绿" : (r.verdict ?? "红");
    process.stdout.write(
      `  · ${mark}  ${r.label}（本检出 ${r.currentCode} / 基线 ${r.baseCode ?? "未跑"}）\n`,
    );
    /* 「没跑出结论」的三种形态在退出码上同形（127 / 收集不到 / 判据自己退 2），
     * 只有码位与输出里的指纹分得开 —— 而这一行决定了人是去修代码、去查环境，
     * 还是去清它点名的那个前置（ISSUE #1652 与 #2791）。 */
    if (r.didNotRun) {
      process.stdout.write(`      ↳ 没跑出结论：${r.didNotRun}\n`);
    }
  }
  process.stdout.write(`[base-check] 结论：${summary}\n`);
  for (const line of nextStepsMany(summary, reds, { ref })) {
    process.stdout.write(`[base-check] ${line}\n`);
  }
  /* 基线那次输出的末尾只对**红的**那几条打（全绿时打出来只会把结论挤出屏幕，
   * 同 `tail()` 那条理由）。 */
  for (const r of reds) {
    if (!r.baseOutputTail) {
      continue;
    }
    process.stdout.write(`[base-check] 「${r.label}」基线输出末尾：\n`);
    process.stdout.write(
      `${r.baseOutputTail
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n")}\n`,
    );
  }
  return 0;
}

/** @param {string[]} argv */
function main(argv) {
  /* `--merge-into <ref>` 是**值旗标**：它的值要从 argv 里摘出来，不能混进 args
   * （args 是要复算的命令本身，混进去会被当成命令的第一个词）。 */
  let mergeInto = null;
  /** @type {string[]} */
  const cleaned = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) {
      /* `noUncheckedIndexedAccess` 下的形状兜底：进程给不出这一位时没有词可摘。 */
      continue;
    }
    if (a === "--merge-into") {
      mergeInto = argv[i + 1] ?? "";
      i++;
      continue;
    }
    if (a.startsWith("--merge-into=")) {
      mergeInto = a.slice("--merge-into=".length);
      continue;
    }
    cleaned.push(a);
  }
  argv = cleaned;
  const args = argv.filter((a) => !a.startsWith("--"));
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const JSON_OUT = flags.has("--json");

  if (!isGitCheckout()) {
    fail("当前目录不是 git 检出 —— 没有「上游基线」可复算");
    return 1;
  }
  if (flags.has("--fetch")) {
    const f = git(["fetch", "--prune"]);
    if (!f.ok) {
      fail(`git fetch 失败（可去掉 --fetch 用现有引用复算）：${f.stderr}`);
      return 1;
    }
  }
  /* `--base`：**合并前**那一档（空参数 = 「这次 PR 准备并的那一批」）。
   * 与「被拦下时复算一条」共用同一套事实与话术，只是面从一条变成一批。
   * 连**基线引用**都是两个问题：这一档要「并进去会不会红」⇒ 只认主干；
   * 事后那一档要「这红是不是本来就有的」⇒ 也优先主干，只有当主干与 HEAD 同义时
   * 才退回 `@{u}` 那套候选（理由与实测见 `resolveAttributionRef`）。 */
  const isBatch = flags.has("--base");
  /* `--merge-state`（ISSUE #3043）：只接**单命令档**（被拦下时复算那一条）。
   * `--base` 那一批问的是「并进去会不会红」，它的对象本来就是合并语义 ——
   * 把两档混在一条命令上只会让「哪一档在判哪棵树」说不清。 */
  if (flags.has("--merge-state") && isBatch) {
    fail("--merge-state 只接单命令档；--base 那一批已经是合并语义，不需要它");
    return 1;
  }
  if (mergeInto !== null && !flags.has("--merge-state")) {
    fail("--merge-into 要跟 --merge-state 一起用（它只回答「合并态那棵树红不红」）");
    return 1;
  }
  if (flags.has("--merge-state") && mergeInto === "") {
    fail("--merge-into 后面要带一个 ref（例：--merge-into origin/master）");
    return 1;
  }
  /** 事后复算（单命令档）那条给 `{ref, why}`：基线该取主干还是 `@{u}` 是有条件的，
   *  而**选了哪一条**必须说出口 —— 不然一份写着 `origin/<自己的分支>` 的报告读起来
   *  像「与主干比过」，实际是拿自己跟自己比（ISSUE #1913 的那次误判就是这么来的）。 */
  const attribution = isBatch ? null : resolveAttributionRef();
  const ref = isBatch ? resolveMergeBaseRef() : (attribution?.ref ?? null);
  if (!ref) {
    fail(
      isBatch
        ? "取不到要并进去的那条（各 remote 的 master / 本地 master）—— 先 `git fetch` 再复算"
        : "取不到上游 master 引用 —— 先 `git fetch`（或确认克隆带了远端分支）再复算",
    );
    return 1;
  }
  if (attribution?.why) {
    process.stdout.write(`[base-check] ${attribution.why}\n`);
  }
  const base = isBatch ? resolveMergeBatch(args) : null;
  if (base && !base.ok) {
    fail(base.error);
    return 1;
  }
  if (base) {
    return baseCheckMany({
      commands: base.commands,
      ref,
      keep: flags.has("--keep"),
      json: JSON_OUT,
    });
  }
  const resolved = resolveGateCommand(args);
  if (!resolved.ok) {
    fail(resolved.error);
    return 1;
  }
  return baseCheck({
    argv: resolved.argv,
    label: resolved.label,
    ref,
    keep: flags.has("--keep"),
    json: JSON_OUT,
    mergeState: flags.has("--merge-state") ? { into: mergeInto ?? "origin/master" } : null,
  });
}

/* 只在被直接执行时跑 main（被 import 时只暴露纯函数给用例）。 */
if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}
