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
 *   · `inconclusive`  —— 命令在其中一侧**没跑起来** ⇒ 不构成证据。两条入口：
 *     ① 退出码 127（找不到模块 / 命令）；② **一条用例都没收集到**（`DID_NOT_RUN_SIGNATURES`，
 *     ISSUE #1652）：基线那一侧因依赖解析失败时，退出码是 1（vitest 收集失败 / Node 的
 *     `MODULE_NOT_FOUND`）—— 与「判据跑了且红」逐字同形，只读退出码必然读成
 *     `baseline-red`。最典型的成因是那条判据只存在**本检出未提交的改动**里：基线的
 *     worktree 是一个干净的上游快照，看不到工作区的未提交文件（这是正确语义，不是缺陷
 *     —— 本判据要复算的就是「干净的线上基线」）。两种入口都**不许**读成「别线的红」。
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
 * 即：绿压过一切；「没跑起来」压过一切红（127 与「一条用例都没收集到」都算）。
 *
 * ── 第三条入口：Windows 上的 `pnpm exec …` 形态（ISSUE #1652 顺带）──────
 *
 * `pnpm` 在 Windows 上是 `.cmd` 垫片，`spawnSync` 不开 `shell` 就找不到它
 * （`ENOENT` ⇒ 127 ⇒ `inconclusive`）。这不算判错（它确实跑不起来），但話术里必须
 * 直接说出口，否则人以为是自己命令写错了。两条出路：改用 `node node_modules/<pkg>/<bin>`
 * 形态，或（判据自己）给非 `node` 的命令开 `shell`（见 `runGate` 的 `NEEDS_SHELL`）。
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
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chainedSteps } from "./base-check/chained-steps.mjs";

/**
 * 「被复算的那份检出」= **调用时的 cwd**，不是脚本自己的位置。
 *
 * 这两者在人手里是同一个（在仓库根跑），但在用例里不是（临时仓库里跑真脚本）——
 * 而按脚本位置锚定会把「复算谁的基线」这件事**绑死在安装位置**上：临时仓库里
 * 跑它，它复算的却是 /workspace 的基线，两条红绿与输入毫无关系。
 * git 命令本来就以 cwd 为语义（`spawnSync` 不给 `cwd` 时继承进程的），所以
 * 这里跟着 cwd 走也最贴近 `git` 本身的口径。
 */
const ROOT = process.cwd();
/**
 * 钩子（「有哪些门禁步骤」的清单）**从被复算的那份检出读** —— 与 `ROOT` 同源。
 *
 * 这一条是实测撞出来的：原来锚在**脚本安装位置**（`import.meta.url` 的上一级），理由是
 * 「标签 ⇄ 命令的对应关系是仓库级的」—— 那个理由对「查标签」成立，对 `--base`
 * 不成立：`--base` 的语义是「**这批**判据在这份检出上会怎么样」，而「这批」正是
 * 这份检出的钩子说的。锚在安装位置时，在两个不同的检出上跑同一条命令会各自拿到
 * **对方那份钩子**，而输出看起来完全正常（实测：临时仓库里报「50 条判据」，那 50
 * 条来自 `/workspace` 的钩子、在临时仓库里一条都跑不起来 ⇒ 整批假红）。
 *
 * 与 `ROOT` 的那条注释是同一个病（「复算谁的基线」不该绑死在安装位置），
 * 所以处置也同源：跟着 `cwd` 走。
 */
const HOOK = path.join(ROOT, ".githooks", "pre-commit");

/**
 * 上游引用的候选顺序 —— **不写死 `cnb/master`**（§13.6.2 的示例里是它，但检出的
 * remote 名随克隆方式变；本地实测是 `origin`）：
 *   ① 当前分支的上游（`@{u}`，最贴近「我这份检出是从哪来的」）；
 *   ② 各 remote 的 `master`（`origin/master` / `cnb/master` / …）；
 *   ③ 本地 `master`（浅检出 / 单机仓库）。
 * 取不到任何一个即判复算失败并给出口，而不是静默拿一个错的基。
 *
 * @param {string} [cwd]
 * @returns {string | null}
 */
export function resolveUpstreamRef(cwd = ROOT) {
  /** @param {string} ref */
  const tryRef = (ref) =>
    git(["rev-parse", "--verify", "--quiet", ref], cwd).ok;
  const upstream = git(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    cwd,
  );
  if (upstream.ok && upstream.stdout && tryRef(upstream.stdout)) {
    return upstream.stdout;
  }
  const remotes = git(["remote"], cwd);
  if (remotes.ok) {
    for (const remote of remotes.stdout.split("\n").map((s) => s.trim())) {
      if (!remote) continue;
      const ref = `${remote}/master`;
      if (tryRef(ref)) return ref;
    }
  }
  if (tryRef("master")) return "master";
  return null;
}

/**
 * **合并前复算要拿哪条当基线** —— 与 `resolveUpstreamRef` 是**两个问题**。
 *
 * `resolveUpstreamRef()` 回答的是「我这份检出是从哪来的」（首选 `@{u}`），那对
 * 「被拦下时复算：这红是不是本来就有的」是对的 —— 与你对比的就是你这条线的上游。
 *
 * 但 `--base` 问的是**另一个**问题：「并进 `master` 之后会不会红」。在 PR 分支上
 * `@{u}` 是**你自己的分支**（推送时就设上了），拿它当基线等于「自己跟自己比」——
 * 输出是「50 条全绿」，看起来一切正常，而它一个字节都没回答「并进去会怎样」。
 * （实测撞到的就是这个形态。）
 *
 * 所以这一档**只认「要并进去的那条」**：候选是各 remote 的 `master`，再退回本地
 * `master`。**刻意不退回 `@{u}`** —— 宁可判「取不到基线」让人显式给一条，也不拿
 * 一个语义不对的引用充数（同 `resolveUpstreamRef` 那句「取不到就报失败，而不是静默
 * 拿一个错的基」）。
 *
 * @param {string} [cwd]
 * @returns {string | null}
 */
export function resolveMergeBaseRef(cwd = ROOT) {
  /** @param {string} ref */
  const tryRef = (ref) =>
    git(["rev-parse", "--verify", "--quiet", ref], cwd).ok;
  const remotes = git(["remote"], cwd);
  if (remotes.ok) {
    for (const remote of remotes.stdout.split("\n").map((s) => s.trim())) {
      if (!remote) continue;
      const ref = `${remote}/master`;
      if (tryRef(ref)) return ref;
    }
  }
  if (tryRef("master")) return "master";
  return null;
}

/**
 * 会改写「仓库在哪 / 索引在哪」的环境变量 —— 一律剥掉。
 *
 * 为什么：本脚本的语义是「在**这个**检出里，拿**这个**上游引用复算」，而这些变量
 * 一旦从调用环境里带进来，`git` 就不再操作那个检出 —— 实测（并发跑门禁时）撞到
 * `fatal: .git/index: index file open failed: Not a directory`：`git worktree add`
 * 的 `Preparing worktree` 那一步成功了，紧接着读索引时被一个外来的 `GIT_*` 指到了
 * 别处。这类继承来的变量**不报错、只改指向**，正是最坏的一类失效。
 *
 * @type {string[]}
 */
const GIT_ENV_DENY = [
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
];

/**
 * 剥掉 `GIT_ENV_DENY` 之后的进程环境（其余原样，保住 PATH / HOME 等）。
 *
 * @returns {NodeJS.ProcessEnv}
 */
function cleanGitEnv() {
  const env = { ...process.env };
  for (const key of GIT_ENV_DENY) delete env[key];
  return env;
}

/**
 * 在给定工作目录跑一条 git 命令。
 *
 * @param {string[]} args
 * @param {string} [cwd]
 * @returns {{ok: boolean, status: number, stdout: string, stderr: string}}
 */
function git(args, cwd = ROOT) {
  try {
    const r = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: cleanGitEnv(),
    });
    return {
      ok: r.status === 0,
      status: r.status ?? -1,
      stdout: String(r.stdout ?? "").trim(),
      stderr: String(r.stderr ?? "").trim(),
    };
  } catch (err) {
    return {
      ok: false,
      status: -1,
      stdout: "",
      stderr: String(err instanceof Error ? err.message : err),
    };
  }
}

/** 本检出是不是 git 仓库（不在检出里就没有「上游基线」这回事）。 */
export function isGitCheckout(cwd = ROOT) {
  return git(["rev-parse", "--is-inside-work-tree"], cwd).ok;
}

/**
 * 把一个「门禁命令」参数数组规范化成 `{ label, argv }`。
 *
 * 接受三种写法（都在 §13.6.2 的现场出现过）：
 *   · 钩子标签：`check-ui-primitives`（唯一命中 `.githooks/pre-commit` 的
 *     `run "<标签>" <命令>` 那一行，命令从钩子里取，不抄第二份）；
 *   · 裸脚本名：`scripts/check-ui-primitives.cjs`（补 `node` 前缀）；
 *   · 完整命令：`node scripts/x.cjs --strict` / `pnpm exec vitest run …`（原样）。
 *
 * 标签匹配**必须唯一** —— 命中 0 条或多条都判失败并列出候选，别猜。
 *
 * @param {string[]} input
 * @param {string} [hookPath]
 * @returns {{ok: true, label: string, argv: string[]} | {ok: false, error: string}}
 */
export function resolveGateCommand(input, hookPath = HOOK) {
  const first = input[0];
  if (first === undefined) {
    return { ok: false, error: "没有给门禁命令（用法见脚本头）" };
  }
  // 只给一个词、且不以路径/命令形态出现 ⇒ 当成钩子标签查。
  if (input.length === 1 && !first.includes("/") && !first.includes(".")) {
    const steps = readHookSteps(hookPath);
    const hits = steps.filter((s) => s.label === first);
    if (hits.length === 1 && hits[0]) {
      return { ok: true, label: hits[0].label, argv: hits[0].argv };
    }
    if (hits.length === 0) {
      const labels = steps.map((s) => s.label).join("\n    ");
      return {
        ok: false,
        error: `钩子里没有标签「${first}」。可用的标签：\n    ${labels}`,
      };
    }
    return {
      ok: false,
      error: `标签「${first}」在钩子里命中 ${hits.length} 条，无法唯一确定`,
    };
  }
  // 裸脚本名 ⇒ 补 `node`（仓库里 Node 是共同前提，§9.5）。
  if (input.length === 1 && /\.(cjs|mjs|js)$/.test(first)) {
    return { ok: true, label: first, argv: ["node", first] };
  }
  return { ok: true, label: input.join(" "), argv: input };
}

/**
 * **合并前那一批**：把「这次 PR 准备并进去的判据面」从钩子里现算出来。
 *
 * ── 为什么这一档要存在（ISSUE #1591 立案的那个洞）──────────────────────
 *
 * 平台侧是 **squash 合并**，那一步**不跑本地钩子**；而 ISSUE #623 之后
 * **已无 CI 兜底**（§13.5.3）。于是「我的分支绿」到「master 绿」之间那一跳
 * **没有任何判据**：`tsc` 在本地钩子的 A 组里跑过、在 PR 分支上确实是绿的，
 * 但推上去 squash 进 `master` 时谁都没再看一眼。§13.6.2 的末段把这件事写成
 * 「合并前跑一遍 `pnpm check:all`：这一条没有自动执行者」—— 这一条就是那个空位。
 *
 * ── 它为什么不是「再抄一份判据清单」────────────────────────────────────
 *
 * 待复算的面从 **`.githooks/pre-commit` 的步骤行**里取（`readHookSteps`，同一个
 * 已存在的解析器），再按下面三条**形态**筛：
 *
 *   ① 有 `--staged` 的步骤**不收** —— 它们的语义就是「只看本次暂存改动」，
 *      拿它去复算上游快照等于问一个它回答不了的问题（上游那份没有你的暂存区）；
 *   ② 只在**暂存改动命中某个目录**时才做事的步骤（`shell-gate` / `visual-gate` /
 *      `storybook-check --changed`）不收 —— 同因：它们的判决**依赖本次改动**，
 *      在干净快照上跑要么立刻返回 0、要么判的是快照自己的形态，两种都不是
 *      「合并后会不会红」这个问题的答案；
 *   ③ `base-check` 自己**不收**（那会递归）。
 *
 * 剩下的就是 A 组那条 `tsc --noEmit`、B 组那条 `eslint`，与 D 组里一批**全仓判据**
 * （结构硬规则 / 棘轮 / 复用 / 文档同步）。它们在干净快照上跑出来的红绿，才是
 * 「并进去之后 `master` 会不会红」的直接读数 —— 与「被拦下时复算一条」用的是
 * 同一套事实与同一套话术，只是面从一条变成一批。
 *
 * **零参数就是「这一批」**：要收窄（比如只关心某几条）就把它们当参数给进来
 * （钩子标签 / 脚本名 / 整条命令都认，同 `resolveGateCommand`）。
 *
 * @param {string[]} input 用户显式点名的命令（为空 ⇒ 用上面算出来的那一批）
 * @param {string} [hookPath]
 * @returns {{ok: true, commands: Array<{argv: string[], label: string, baseSide?: boolean}>} | {ok: false, error: string}}
 */
export function resolveMergeBatch(input = [], hookPath = HOOK) {
  if (input.length > 0) {
    const one = resolveGateCommand(input, hookPath);
    if (!one.ok) return one;
    return { ok: true, commands: [{ argv: one.argv, label: one.label }] };
  }
  const steps = [...groupSteps(hookPath), ...readHookSteps(hookPath)];
  if (steps.length === 0) {
    return {
      ok: false,
      error:
        "读不到 .githooks/pre-commit 的步骤 —— 合并前那一批复算不出来，" +
        "请显式点名要复算的判据（用法见脚本头）",
    };
  }
  const commands = steps.filter((s) => mayDecideOnCleanSnapshot(s.argv));
  if (commands.length === 0) {
    return {
      ok: false,
      error: "钩子里没有一条「可在干净快照上判决」的判据 —— 复算不出任何事实",
    };
  }
  /* **第二个来源**：挂在 `--base` 这批里、但不在钩子步骤上的判据（见
   * `scripts/base-check/chained-steps.mjs` 的头注释 —— 那一族天然进不了钩子的理由、
   * 两条口径与事实来源都写在那里，不在本文件里复述，免得两处各说一遍）。 */
  return {
    ok: true,
    commands: [
      ...commands,
      ...chainedSteps({ root: ROOT, resolveBaseRef: resolveMergeBaseRef, git }),
    ],
  };
}

/**
 * **挂在 `--base` 这批里、但不在 `.githooks/pre-commit` 步骤上的**判据。
 *
 * 为什么这一族不能由 `readHookSteps` 收上来：它们**天然进不了钩子**，而理由与
 * 「代价高」无关 —— 是**本地看不到那个形态**。首发成员是
 * `scripts/check-commit-claims.mjs`（「提交信息里的声明 ⇄ 那次提交的事实」）：
 *
 *   · 声明说的是**某一次提交**的树（「§x.y 照旧保留」），核对必须手上有那次提交的
 *     事实；而丢失发生在**平台侧 squash** 那一刻，本地钩子跑的时候那次提交还没诞生
 *     （实测：`ad81a912` / `bdabd26f` / `b9bedd37` 在 `master` 上都是**单亲**，
 *     信息里却带 `Merge origin/master into …` 字样 —— `check-merge-parents` 在
 *     squash 之后判不出来，因为单亲是它的正常形态）；
 *   · 硬塞进钩子只会让人学会绕开它（§13.6.2 的边界原话）。
 *
 * 而 `--base` 正是「合并前 / 事后盘点，人点一次就跑一次」那一档：它手上有上游引用、
 * 有干净快照，本来就是「对着一批提交算事实」的地方 —— 挂在这里**零新通道**
 * （§13.6.2 / §13.5.4 的按需召唤）。
 *
 * **判什么、判在哪一次提交**：合并前那档的语义是「**这一批准备并进去的提交**」，
 * 所以给的是**本检出相对基线的那些提交**（`<ref>..HEAD`）—— 与 `--base` 问的
 * 「并进去之后会不会红」同源。没有待并提交时（已在基线上）给空，判据自己报 0 次
 * 提交，不报假红。
 *
 * 每条都要带 `label`（行表里点名用），并走 `mayDecideOnCleanSnapshot` 的同一套
 * 排除理由 —— 它**不依赖暂存区**（判的是提交对象），所以照收。
 *
 * @returns {Array<{argv: string[], label: string}>}
 */
/**
 * 钩子里 `run_group <id> "<说明>" sh -c '<命令>'` 那四条 —— **A 组与 B 组是它们**。
 *
 * 为什么单独解析这一族：`.githooks/pre-commit` 把 tsc 与 eslint 从 D 组的 `run` 步骤
 * 里拿出来**并行成组**（`run_group A "tsc --noEmit" sh -c 'pnpm exec tsc --noEmit'`），
 * 于是 `readHookSteps()`（只认 `run "<标签>" <命令>`）**看不见它们** —— 而这两条恰好
 * 就是 ISSUE #1591 立案的那两条（19 条 tsc 错落进 `master`）。只读 `run` 的解析器
 * 会让「合并前复算」漏掉最该复算的那两条，且表现为「静默少两行」。
 *
 * 只收**单行的** `run_group`（`sh -c '…'` 一行写完的那两条）；C 组那条的 `sh -c` 是
 * 多行脚本（它自己调 `run-affected-tests.mjs` 拼清单），D 组那条同理 —— 它们不是
 * 「一条判据一条命令」的形状，取不出可复算的单条命令，故按「解析不到就不收」处理。
 *
 * @param {string} hookPath
 * @returns {Array<{label: string, argv: string[]}>}
 */
export function groupSteps(hookPath = HOOK) {
  let text;
  try {
    text = fs.readFileSync(hookPath, "utf8");
  } catch {
    return [];
  }
  const out = [];
  /* `run_group <id> "<说明>" sh -c '<命令>'` —— 只认整行闭合的单引号，多行脚本不匹配。 */
  const re = /^run_group\s+\S+\s+"([^"]+)"\s+sh -c '([^'\n]+)'\s*$/gm;
  for (const m of text.matchAll(re)) {
    const label = m[1];
    const command = m[2];
    if (!label || !command) continue;
    out.push({ label, argv: tokenize(command) });
  }
  return out;
}

/**
 * 一条指令**能不能在干净的上游快照上判决** —— 判据是它的**参数形态**，不是名字。
 *
 * 为什么按参数而不按名字：名字是自由的（`check-*` / `*-gate` / `storybook-check`），
 * 而「这条判据的输入里有没有『本次改动』」是有形态的：
 *   · `--staged` / `--changed` —— 明说只看暂存 / 本次改动（`check-deps-freshness`
 *     `--staged`、`storybook-check --changed`）；
 *   · 只在特定目录有改动时才做事的那几条（`shell-gate` / `visual-gate`）**没有参数
 *     可认**，所以它们由调用点显式列在下面 —— 这份名单是「名字以外的形态」的兜底，
 *     新增同类时要一起加（漏了不会静默：那一步在干净快照上返回 0 或判快照自身形态，
 *     表现为多一条恒绿的行，人看得见）。
 *
 * @param {string[]} argv
 * @returns {boolean}
 */
export function mayDecideOnCleanSnapshot(argv) {
  const joined = argv.join(" ");
  if (argv.some((a) => a === "--staged" || a === "--changed")) return false;
  /** 只对「本次改了什么」作答的步骤（它们的判决依赖暂存区，干净快照里没有）。 */
  const CHANGED_SCOPED = ["scripts/shell-gate.mjs"];
  if (CHANGED_SCOPED.some((p) => joined.includes(p))) return false;
  /** `base-check` 自己：复算里再复算会递归。 */
  if (argv.some((a) => a.endsWith("base-check.mjs"))) return false;
  return true;
}

/**
 * 从 `.githooks/pre-commit` 里读出 `run "<标签>" <命令…>` 的步骤。
 *
 * 只认**步骤行**、不认文件全文 —— 同 `check-gate-executors.cjs` 的理由：
 * 全文匹配会把散文里被提到的脚本一起打进来（那边实测凭空多出三份）。
 *
 * @param {string} hookPath
 * @returns {Array<{label: string, argv: string[]}>}
 */
export function readHookSteps(hookPath = HOOK) {
  let text;
  try {
    text = fs.readFileSync(hookPath, "utf8");
  } catch {
    return [];
  }
  const steps = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*run\s+"([^"]+)"\s+(.+?)\s*$/);
    if (!m) continue;
    const label = m[1];
    const command = m[2];
    if (label === undefined || command === undefined) continue;
    // 命令里可能带行内注释（`--strict` 之后跟 `# …`）—— 去掉注释再分词。
    const bare = command.replace(/\s+#.*$/, "").trim();
    steps.push({ label, argv: tokenize(bare) });
  }
  return steps;
}

/**
 * 极简分词：按空白切，尊重单/双引号。
 *
 * 不做 shell 展开（`$VAR` / 通配符）—— 钩子里的步骤本来就不依赖展开
 * （它们走 `pnpm exec` / `node`，参数是显式的）。真需要 shell 语法的命令
 * 请**整条**作为参数传进来，本脚本会原样 `spawn` 给复核的那份检出。
 *
 * @param {string} line
 * @returns {string[]}
 */
export function tokenize(line) {
  const out = [];
  let cur = "";
  let quote = null;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * 把一次 spawn 结果归一成 `{ code, output }`（同 `tests/helpers/gate-repo.ts` 的口径）。
 *
 * @param {import("node:child_process").SpawnSyncReturns<string>} r
 * @returns {{code: number, output: string}}
 */
export function normalizeRun(r) {
  if (r.error) return { code: 127, output: String(r.error.message) };
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return { code: r.status ?? -1, output };
}

/**
 * 命令的**目标条目**（脚本文件 / 目录）在给定工作目录里存不存在。
 *
 * 为什么需要这一步：基线 worktree 是一个**干净的上游快照**，看不到本检出的未提交
 * 文件。一条「本检出有、未提交」的判据在基线侧会因 `MODULE_NOT_FOUND` 退出 ——
 * 而 Node 那条路径的退出码是 **1**，与「判据跑了且红」逐字同形（实测过：只读退出码
 * 必然误判）。所以「跑不起来」必须由**目标存不存在**判，不能由退出码判。
 *
 * 只对**能识别的形态**（`node <相对路径>`）做这一步：`pnpm exec` / `vitest` 这类
 * 目标不在文件系统上的命令交给它们自己报错（那时退出码与消息会说明问题）。
 *
 * @param {string[]} argv
 * @param {string} cwd
 * @returns {{kind: "ok"} | {kind: "missing", target: string} | {kind: "unknown"}}
 */
export function commandTargetState(argv, cwd) {
  const [cmd, first] = argv;
  if (cmd !== "node" || !first || first.startsWith("-"))
    return { kind: "unknown" };
  const target = path.resolve(cwd, first);
  return fs.existsSync(target)
    ? { kind: "ok" }
    : { kind: "missing", target: first };
}

/**
 * Windows 上必须经 `cmd.exe` 才起得来的命令 —— 垫片形态（`.cmd` / `.bat`）。
 *
 * 为什么要有这条：`pnpm` 在 Windows 上是 `pnpm.cmd`，而 `spawnSync` **默认不开
 * shell**（这是有意的，为了不被命令行注入）—— 于是 `spawnSync("pnpm", …)` 报
 * `ENOENT` ⇒ 归一成 127 ⇒ 整条 `base-check` 变成 `inconclusive`。实测这是 ISSUE
 * #1652 里「Windows 上 `pnpm exec …` 形态一律 inconclusive」的成因，而报告里一个字
 * 都没提，人会以为是自己命令写错了。
 *
 * 只收**这一个**形态：其余命令（`node` / 绝对路径的二进制）在 Windows 上也是可执行
 * 文件，走 shell 只会多一层 cmd.exe 与它自己的引号规则（而参数里可能有含空格的路径）。
 *
 * @param {string} cmd
 * @returns {boolean}
 */
function needsShell(cmd) {
  return process.platform === "win32" && (cmd === "pnpm" || cmd === "npm");
}

/**
 * 在给定工作目录跑一次门禁。**只做「跑 + 收码」**，判决在 `judge()`。
 *
 * `pnpm` 一律经 `pnpm exec`（AGENTS 硬规则 1：禁 npm/npx）；`node` 用当前
 * 可执行文件（`process.execPath`）而不是裸 `node`，避免复核环境里 PATH 上
 * 是另一套 Node。Windows 上的垫片形态经 `needsShell()` 开一层 shell（见它的注释）。
 *
 * @param {string[]} argv
 * @param {string} cwd
 * @returns {{code: number, output: string}}
 */
export function runGate(argv, cwd) {
  const state = commandTargetState(argv, cwd);
  if (state.kind === "missing") {
    // 127 是本脚本自己的「没跑起来」哨兵（`normalizeRun` 用同一个码）。
    return {
      code: 127,
      output: `[base-check] 目标不存在于该工作目录：${state.target}`,
    };
  }
  const [cmd, ...rest] = argv;
  if (cmd === undefined) {
    return { code: 127, output: "[base-check] 命令是空的" };
  }
  const finalCmd = cmd === "node" ? process.execPath : cmd;
  const r = spawnSync(finalCmd, rest, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    /* Windows 的垫片形态（`pnpm.cmd`）只有 cmd.exe 解释得了 —— 不开 shell 就是
     * `ENOENT`，而那个读数会被读成「判据没跑起来」，与真实原因（形态不对）差着
     * 一层。POSIX 上 `needsShell` 恒 false，语义一字不变。 */
    shell: needsShell(cmd),
    /* 同样走干净环境：被判的判据自己也可能是 git 判据（`check-branch-guard` 等），
     * 继承来的 `GIT_*` 会让它判的**不是这个检出**。 */
    env: { ...cleanGitEnv(), CI: "1" },
  });
  return normalizeRun(r);
}

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
 * 一次运行的**三种状态**（不是两种）—— 见 `runState()`。
 * @typedef {"ran" | "did-not-run" | "unknown"} RunState
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
  if (DID_NOT_RUN_SIGNATURES.some((re) => re.test(text))) return "did-not-run";
  if (run.code === 127) return "did-not-run";
  if (run.code === 0 || run.code === 1 || run.code === 2) return "ran";
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
 * **「跑不起来」不是「判据红了」**：判据没跑起来时非零退出码与「跑了且红」同形 ——
 * 只读退出码必然把后者读成前者，而这两件事的下一动作完全相反（一个去修代码，一个去
 * 查命令/环境为什么不对）。所以先判这一档，且**两条入口都要**：
 *   · 退出码 127（找不到模块 / 命令）；
 *   · **一条用例都没收集到**（`runState()` 的指纹，ISSUE #1652）—— 它退的是 **1**，
 *     与「判据跑了且红」逐字同形，而静态的「目标存不存在」看不见它（目标在、是它
 *     运行时的依赖链断了）。基线快照里 `@testing-library/jest-dom` →
 *     `Cannot find package '@adobe/css-tools'` ⇒ `Tests  no tests` 就是这一格。
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
  if (currentCode === 0) return "current-green";
  /* 「跑不起来」两条入口都在最前面：127（找不到模块 / 命令）与「一条用例都没收集到」。
   * 两侧都要看 —— 本检出那一侧收集不到时，这一次复算问的根本不是「谁的红」。 */
  const current = runState({ code: currentCode, output: currentOutput });
  const base = runState({ code: baseCode ?? 0, output: baseOutput });
  if (current === "did-not-run" || base === "did-not-run") {
    return "inconclusive";
  }
  /* `baseCode === null` = **这一条只在单侧跑**（`baseSide: false`）：它的对象是本检出
   * 这条线上的提交对象，基线快照里没有它们，所以「没比较过」不是「别线上也红」。
   * 它红的时候唯一的可能是「这次提交的声明与它自己的树矛盾」⇒ 纯粹的 `yours`。 */
  if (baseCode === null) return "yours";
  /* 两侧都红、且**两侧的输出都带超时指纹** ⇒ 负载假红优先于 `baseline-red`。
   * 只在单侧超时形态不降这一档（那更像「你让它变慢了」，归 `yours`）。 */
  if (
    baseCode !== 0 &&
    isTimeoutShaped(currentOutput) &&
    isTimeoutShaped(baseOutput)
  ) {
    return "load-flake";
  }
  return baseCode !== 0 ? "baseline-red" : "yours";
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
    return [
      "你的检出上这条判据已经是绿的（已修 / 或它只在别的输入面上触发）—— 无需复算。",
    ];
  }
  if (verdict === "inconclusive") {
    return [
      "命令在其中一侧**没跑起来**，不是「判据红了」——这次不构成「别线的红」的证据。",
      "两种形态（判据自己会把命中的是哪一种打在 `did-not-run` 那行里）：",
      "  · **一条用例都没收集到**（`Tests  no tests` / `Cannot find package|module` /",
      "    `ERR_MODULE_NOT_FOUND`）—— 它退的是 1，与「判据跑了且红」同形，所以只读",
      "    退出码必然误判。最常见于 ① 那条判据只存在**本检出的未提交改动**里",
      "    （基线是干净的上游提交，看不到它）；② 基线 worktree 的依赖链法出了问题",
      "    （`node_modules` 是**符号链接**过去的，链路断在临时目录那一侧）。",
      "    先做的动作：`cd` 进那个 worktree 跑一次 `pnpm install --frozen-lockfile`，",
      "    或把 worktree 建到与目标侧**同一个盘 / 同一个根**下（`--keep` 会把路径打出来）；",
      "  · **127**（找不到模块 / 命令）—— 命令写错、路径相对本检出，或 Windows 上写的是",
      "    `pnpm exec …`（`pnpm` 是 `.cmd` 垫片；改用 `node node_modules/<pkg>/<bin>` 形态）。",
      "先让它在本检出里真能跑（提交或修正命令），再复算。",
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

/**
 * 复算一次（编排本体）。
 *
 * 临时 worktree 建在系统临时目录（**不在仓库旁边**）：§13.6.2 的示例写
 * `../.wt-base-check`，那会把 worktree 留在仓库的父目录里，忘记删就永久占位
 * （而且会被某些工具的目录遍历扫到）。放 `os.tmpdir()` 下不会有这个问题。
 *
 * @param {{argv: string[], label: string, ref: string, keep?: boolean, json?: boolean}} input
 * @returns {number} 退出码（0 = 事实已复算；1 = 复算过程失败）
 */
export function baseCheck({ argv, label, ref, keep = false, json = false }) {
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
 *   · 任一条**没跑起来**（127）⇒ `inconclusive`，且**整批**不构成证据 ——
 *     127 与「跑了且红」在退出码上同形（Node 的 `MODULE_NOT_FOUND` 也是 1），
 *     拿它当「别线的红」是把人往错方向送；
 *   · 有红、且红的那些在基线上**同样命中** ⇒ `baseline-red`（别线的红，逐条列出）；
 *   · 有红、但基线上绿 ⇒ `yours`（本检出的红）。
 *
 * @param {{commands: Array<{argv: string[], label: string, baseSide?: boolean}>, ref: string, keep?: boolean, json?: boolean, shape?: "single" | "batch"}} input
 * @returns {number} 退出码（0 = 事实已复算；1 = 复算过程失败）
 */
export function baseCheckMany({
  commands,
  ref,
  keep = false,
  json = false,
  shape = "batch",
}) {
  /* 本检出那一侧：**先跑、先收**（不建 worktree 就能判掉的情形不付这笔 —— 同
   * `baseCheck` 的旧口径）。 */
  /** @type {Array<{code: number, output: string}>} */
  const current = [];
  for (const c of commands) current.push(runGate(c.argv, ROOT));
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
  try {
    // `--detach` 是必须的：上游 ref 是 remote-tracking 分支，直接 checkout 会
    // 让 git 拒绝（「already checked out」/ 进不了分离态）。复核只需一个只读快照。
    //
    // **建一次、失败了换一个目录再建一次**：这一层在并发跑门禁时是环境噪声的受害者
    // （实测 `.git/index: index file open failed: Not a directory`，见 `GIT_ENV_DENY`
    // 那段）。两次都失败才是真失败 —— 不许把它读成「复算不出结论」。
    for (let attempt = 0; attempt < 2 && !worktreePath; attempt++) {
      const candidate = fs.mkdtempSync(
        path.join(os.tmpdir(), "comfy-base-check-"),
      );
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
    linkDependencies(ROOT, worktreePath);
    const commit = git(["rev-parse", "--short", "HEAD"], worktreePath).stdout;
    const rows = [];
    for (const [i, c] of commands.entries()) {
      const cur = current[i]?.code ?? 127;
      /* `baseSide: false` ⇒ **不在快照上跑**（理由见 `CHAINED_STEPS` 那条注释）：
       * 它的 `baseCode` 记 `null`（= 未跑），判决只看本检出那一侧。 */
      const base = c.baseSide === false ? null : runGate(c.argv, worktreePath);
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
        ...(base && base.code !== 0
          ? { baseOutputTail: tail(base.output) }
          : {}),
      });
    }
    return reportMany(
      { ref, commit, summary: summarizeRows(rows), rows },
      { json, shape },
    );
  } finally {
    /* 未成为 worktree 的候选目录（建失败那一次留下的空目录）直接删。 */
    for (const candidate of attempts) {
      if (candidate !== worktreePath) {
        fs.rmSync(candidate, { recursive: true, force: true });
      }
    }
    if (worktreePath && !keep) {
      // 先让 git 摘掉登记，再兜底 rm —— `git worktree remove` 在目录已被删时
      // 会失败，所以两条都要（顺序不能反）。
      git(["worktree", "remove", "--force", worktreePath]);
      fs.rmSync(worktreePath, { recursive: true, force: true });
    } else if (worktreePath) {
      process.stdout.write(`[base-check] 保留临时 worktree：${worktreePath}\n`);
    }
  }
}

/**
 * 把本检出的依赖树**链**进干净快照（符号链接，只读方向）。
 *
 * 为什么必须有：`git worktree add` 只检出受版本控制的文件，`node_modules`
 * 不在其中 —— 而 `--base` 那一批里近一半判据要它（tsc / eslint / TS AST 那几条）。
 * 缺了它不是「跑不了」，而是**跑出一个看起来像红的读数**：Node 找不到模块时退出
 * 码是 1，与「判据跑了且红」同形，于是「合并后会不会红」这个问题的答案被污染。
 *
 * 只链 `node_modules` 这一项：其余缺件（`.env` / `db.sqlite` / `.next`）都在
 * 「判据自己该不该在快照上跑」的判定里 —— 要它们才跑得动的判据本就不该进这一批。
 *
 * 失败（已有同名目录 / 权限）不打红：那是「这一条判据在这个快照上跑不起来」，
 * 由 `inconclusive` 那一档接管，不是复算过程本身的失败。
 *
 * @param {string} from 本检出根
 * @param {string} to 快照根
 */
function linkDependencies(from, to) {
  const target = path.join(to, "node_modules");
  const source = path.join(from, "node_modules");
  if (fs.existsSync(target) || !fs.existsSync(source)) return;
  try {
    fs.symlinkSync(source, target, "junction");
  } catch {
    try {
      /* `junction` 是 Windows 上不需要提权的形态（`dir` 要开发者模式）；
       * POSIX 上没有这个 type，退回默认。 */
      fs.symlinkSync(source, target);
    } catch {
      /* 链不上就让它按「没跑起来」报 —— 由 `inconclusive` 那一档说清楚。 */
    }
  }
}

/**
 * 判决是 `inconclusive` 时，**是哪一侧、哪一种形态**（报告用它点名）。
 *
 * 单独成函数而不是从 `runState` 反推：那句话要说的是「127」与「一条用例都没收集到」
 * 的区分，而后者只在**输出**里看得见 —— 报告里给出的是「哪一侧说什么」，不是又一个
 * 需要人去解读的退出码。
 *
 * @param {{cur: number, curOutput?: string, base: {code: number, output?: string} | null, baseOutput?: string}} input
 * @returns {string}
 */
export function didNotRunSide({ cur, curOutput, base, baseOutput }) {
  const sides = [];
  if (cur === 127) sides.push("本检出：127（找不到模块 / 命令）");
  else if (isDidNotRunShaped(curOutput))
    sides.push("本检出：一条用例都没收集到");
  /* 基线那一侧的 `runGate` 结果整个传进来（`base.output`），而不是另拿一份
   * `baseOutput` —— 两个来源曾经在这里错位过一次（报告恒空），只留一条路。 */
  const baseCode = base ? base.code : null;
  const baseText = base ? String(base.output ?? "") : String(baseOutput ?? "");
  if (baseCode === 127) sides.push("基线：127（找不到模块 / 命令）");
  else if (baseCode !== null && baseCode !== 0 && isDidNotRunShaped(baseText)) {
    sides.push("基线：一条用例都没收集到");
  }
  return sides.join("；");
}

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
  if (rows.length === 0) return "inconclusive";
  if (rows.every((r) => r.currentCode === 0)) return "current-green";
  const verdicts = rows
    .filter((r) => r.currentCode !== 0)
    .map((r) =>
      judge({
        currentCode: r.currentCode,
        baseCode: r.baseCode,
        /* 两个来源都收：行里显式给了 `currentOutput` 就用它，否则回落到
         * `output`（本检出那一次的全文，见上面 rows.push 的注释）。 */
        currentOutput: r.currentOutput ?? r.output,
        baseOutput: r.baseOutput,
      }),
    );
  if (verdicts.includes("inconclusive")) return "inconclusive";
  /* 混着「别线的红」与「你的红」时，**按更严重的那一档报**（`yours`）——
   * 别线的红可以就地收掉或登记，而你自己引入的那条必须改代码，两者都要人看见；
   * 报成 `baseline-red` 会让人以为整批都与自己无关。 */
  if (verdicts.includes("yours")) return "yours";
  if (verdicts.includes("load-flake")) return "load-flake";
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
  if (summary === "current-green") return nextSteps("current-green", { ref });
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
          single.baseCode === null ? "未跑" : single.baseCode
        }）\n`,
    );
    if (only.didNotRun) {
      process.stdout.write(`[base-check] 没跑起来：${only.didNotRun}\n`);
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
      `  · ${mark}  ${r.label}（本检出 ${r.currentCode} / 基线 ${
        r.baseCode === null ? "未跑" : r.baseCode
      }）\n`,
    );
    /* 「没跑起来」的两种形态在退出码上同形，只有输出里的指纹分得开 —— 而这一行
     * 决定了人是去修代码还是去查环境（ISSUE #1652）。 */
    if (r.didNotRun) {
      process.stdout.write(`      ↳ 没跑起来：${r.didNotRun}\n`);
    }
  }
  process.stdout.write(`[base-check] 结论：${summary}\n`);
  for (const line of nextStepsMany(summary, reds, { ref })) {
    process.stdout.write(`[base-check] ${line}\n`);
  }
  /* 基线那次输出的末尾只对**红的**那几条打（全绿时打出来只会把结论挤出屏幕，
   * 同 `tail()` 那条理由）。 */
  for (const r of reds) {
    if (!r.baseOutputTail) continue;
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
   * 与「被拦下时复算一条」共用同一套事实与话术，只是面从一条变成一批 ——
   * 连**基线引用**都是两个问题：那一档只认「要并进去的那条」（理由见
   * `resolveMergeBaseRef`），而事后复算认「我这条线的上游」。 */
  const isBatch = flags.has("--base");
  const ref = isBatch ? resolveMergeBaseRef() : resolveUpstreamRef();
  if (!ref) {
    fail(
      isBatch
        ? "取不到要并进去的那条（各 remote 的 master / 本地 master）—— 先 `git fetch` 再复算"
        : "取不到上游 master 引用 —— 先 `git fetch`（或确认克隆带了远端分支）再复算",
    );
    return 1;
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
  });
}

/* 只在被直接执行时跑 main（被 import 时只暴露纯函数给用例）。 */
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  process.exit(main(process.argv.slice(2)));
}
