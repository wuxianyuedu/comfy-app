#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:master 分支提交守卫(供 .githooks/pre-commit 与 CI 调用)
/**
 * master 分支提交守卫 —— 规范见 docs/standards/13-提交与-code-review.md §13.6。
 *
 * 背景:仓库主分支 master 应当只接受「分支开发 + PR 合并」的变更。此前 `master`
 * 既没有平台侧保护、也没有本地门槛,直接 `git commit` 就能改主干:绕过 PR 评审与
 * CI 门禁的变更会静默进历史,等发现时已经很难回退(主干是所有人的基线)。
 *
 * 本脚本把「不在 master 上直接提交」固化成机器门槛,三层口径:
 *   ① 直连本地 master 的提交 —— 拦截(没走分支/PR);
 *   ② 合并进 master 的提交(merge commit 的第二父为 master) —— 放行,
 *      PR 合并在 CNB 平台侧完成,不该被本地门槛二次阻挡;
 *   ③ 未处于提交场景(CI 里没有 .git 状态、或手动执行做体检) —— 放行并提示。
 *
 * 判定依据(为什么不是只看 `git rev-parse --abbrev-ref HEAD`):
 *   pre-commit 钩子在**合并提交**时 HEAD 就是 master,只看分支名会把「PR 合并」
 *   一起拦掉;而 `origin/master` 也可能恰好等于本地 master(刚 pull 过),
 *   不能用来区分。可用的事实是「本次提交有几个父」:
 *   合并提交有 2 个父(被合分支 + master),普通提交只有 1 个。HEAD 存在且
 *   父提交数 > 1 时,本次提交是合并 → 放行。
 *
 * 判定依据(为什么不用 `git symbolic-ref HEAD` 之外的平台事实):
 *   CNB 在推送层锁定分支(create-branch-lock)只能阻止**推送**,拦不住本地
 *   直接提交后再推送;本地门槛是这条链路里唯一能在「提交那一刻」给反馈的位置。
 *
 * 服务端复核(--pr-check,平台侧 pull_request 流水线调用):
 *   注意:平台侧流水线配置(.cnb.yml)已按额度约束删除(ISSUE #623,见规范 13.5.3),
 *   本形态目前**没有调用方**——保留是因为它是判据本身(三种拓扑由
 *   tests/check-branch-guard.test.ts 用真仓库跑),日后重启平台侧直接用。
 *   这里的判据**不能复用上面的「分支名」**:CNB 在 pull_request 事件上 checkout 的
 *   是**预合并提交**(gh merge 语义),容器里 HEAD 的分支名是**目标分支**(实测
 *   `symbolic-ref HEAD` = master、父提交数 1)——照搬会 100% 误报「直接向 master 提交」。
 *   可用的、且不受「源分支名」影响的 git 事实是 git 在合并提交里写下的
 *   `Merge: <target> <source>`:把它与 **PR 目标分支**(CNB_PULL_REQUEST_TARGET_SHA
 *   指向的那条分支,由调用方传入)比对,即可判定「源分支 == 目标分支」。
 *   - 没有 `Merge:` 行(树内合并 / 非合并提交)→ 放行:PR 一定带源分支,
 *     缺这行说明上游的 checkout 形态变了,不误报;
 *   - 只有一个 `Merge:` 行(fast-forward / rebase 预合并)→ 无法区分,放行并说明。
 *
 *   用拓扑(而不是分支名)判,是因为平台**允许**创建 source=master 的 PR ——
 *   那正是本条要拦的场景,而「这是不是 PR 事件」回答不了它。
 *   触发者也能把流水线里的那一行删掉(PR 类事件是「不可信事件」,流水线配置取自
 *   源分支),因此判定必须自持:删了它就是让流水线当场失败,而不是静默不检查。
 *
 * 服务端复核之二(--merge-commit,平台侧 push 流水线调用):
 *   同样已无调用方(见上),保留作判据与日后复用。
 *   master 的 push 事件上 HEAD **就是**合并提交,「HEAD 在 master 上 = 直连主干」
 *   会把每一次正常的 PR 合并都拦下。push 事件只该问一件事:这次落到 master 的
 *   是不是**合并提交**。父提交数 > 1 → 放行(PR 合并的正常形态);
 *   ≤ 1 → 说明有变更绕过 PR 写进了主干(--no-verify 就能做到),正是要拦的。
 *
 * 用法:
 *   node scripts/check-branch-guard.cjs              # 提交场景检查(违规即阻断)
 *   node scripts/check-branch-guard.cjs --status     # 只看当前分支现状
 *   node scripts/check-branch-guard.cjs --pre-commit # 显式声明提交场景
 *   node scripts/check-branch-guard.cjs --pr-check   # 服务端复核:源分支不能是目标分支
 *   node scripts/check-branch-guard.cjs --merge-commit # 服务端复核:落到 master 的必须是合并提交
 */
/**
 * 判据版本 —— 本值一变,「旧版本挡下了什么」就有缺口:平台侧那条调用行属于
 * PR 类「不可信事件」的配置(取自源分支),可能被人删掉。调用方必须同时核这个
 * 版本号(守卫要排在第 1 条,版本不符时真的会被拦下,而不是「看起来还在跑」)。
 * 平台侧流水线删除后核对方随之消失(见规范 13.5.3),重启时按这条口径补上核对。
 */
const GUARD_VERSION = "2";
const { execFileSync } = require("node:child_process");

/**
 * 受保护的主分支名 —— 与规范 §13.6 一致。
 *
 * 平台层**不许**用 `git create-branch-lock`(locked: true):它锁的是整个分支的
 * 写入,连 PR 合并一起拦掉,master 一旦被锁任何 PR 都无法合并。要「禁直接 push、
 * 但放行 PR 合并」只有「保护分支 + 禁直接 push + 需要评审批准」这一条路。
 */
const PROTECTED_BRANCH = "master";

/** 在仓库内跑一条 git 命令;失败时回 ""(钩子在裸仓库/浅克隆里可能取不到值)。 */
function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

/** 取 `--key value` / `--key=value` 形态的入参;缺省返回 ""。 */
function argValue(key) {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === key) return argv[i + 1] || "";
    if (argv[i].startsWith(key + "=")) return argv[i].slice(key.length + 1);
  }
  return "";
}

/** 当前 HEAD 的分支名;处于分离 HEAD(detached)时为 ""。 */
function currentBranch() {
  return git(["symbolic-ref", "--quiet", "--short", "HEAD"]);
}

/** HEAD 存在时返回父提交数;HEAD 不存在(首个提交)返回 0。 */
function parentCount() {
  const rev = git(["rev-list", "--parents", "-n", "1", "HEAD"]);
  if (!rev) return 0;
  return Math.max(rev.split(/\s+/).length - 1, 0);
}

/** 逐条列出「为什么放行 / 为什么阻断」,返回值便于测试直接断言。 */
function evaluate() {
  const branch = currentBranch();
  const parents = parentCount();
  const merge = parents > 1;

  if (branch !== PROTECTED_BRANCH) {
    return { blocked: false, branch, parents, merge, reason: "不在受保护分支上" };
  }
  if (merge) {
    return {
      blocked: false,
      branch,
      parents,
      merge,
      reason: "本次是合并提交(PR 合并),允许落在 " + PROTECTED_BRANCH,
    };
  }
  return {
    blocked: true,
    branch,
    parents,
    merge,
    reason: "在 " + PROTECTED_BRANCH + " 上直接提交",
  };
}

/**
 * 服务端复核(--pr-check):判「PR 的源分支有没有超出目标分支的提交」。
 *
 * **为什么不能复用上面的「分支名」判据**:CNB 在 pull_request 事件上 checkout 的是
 * **预合并提交**(把目标分支合进源分支的临时提交),容器里 `symbolic-ref HEAD` 恒等于
 * **目标分支**(实测 `master`)——照搬「HEAD 在 master 上就是直连主干」会 100% 误报,
 * 把每一条正常 PR 都拦死(PR #633 第一次跑就是这么红的,见 Issue #623 的构建记录)。
 *
 * **为什么不用 `Merge:` 行**:git 在合并提交里只写**两个父的 sha**,不写分支名
 * (`Merge: 1284c48 d2d76e8`)。`git name-rev` 能从 sha 反查分支名,但它按可达性猜,
 * 目标分支与源分支互相归并过之后两边都能反查到同一个名字——判据会随拓扑漂移,
 * 不是事实。
 *
 * **实际可用的判据是拓扑**:问「源分支相对目标分支有没有**独有**的提交」。
 * `git rev-list --count <目标分支>..HEAD`:
 *   - `> 0` → 源分支确有超出目标分支的提交 → 这是一个真实的 PR → 放行;
 *   - `= 0` → 源分支没有任何超出目标分支的提交,即它就是目标分支(或其祖先)
 *     → 这正是本条要拦的场景(平台允许创建 source=master 的 PR)→ 阻断。
 * 判据只用提交拓扑,与分支叫什么名字无关,也不受预合并形态影响。
 *
 * 目标分支由调用方经 `--target <branch>` 传入(缺省 `master`)。
 *
 * 边界(都取保守放行,理由与本地钩子一致:判据无从命中时不该误报):
 *   - 目标分支在本地取不到(浅克隆 / 单分支检出)→ 判不了,放行并说明;
 *   - HEAD 本身就是目标分支的 tip(`= 0` 的另一种成因是「源分支落后目标分支」,
 *     平台允许这种 PR,它的意义是让 CI 在落后分支上重跑)→ 只有当 `origin/<目标分支>`
 *     也在本地且 HEAD 是它的祖先时才放行;否则按上面的口径阻断。
 */
function evaluatePr(targetBranch) {
  const branch = currentBranch();
  const parents = parentCount();
  const target = targetBranch || PROTECTED_BRANCH;

  /** 目标分支的引用:优先 `origin/<target>`(容器里只有这一份),再退回本地同名分支。 */
  const targetRef = ["origin/" + target, target].find((ref) => git(["rev-parse", "--verify", "--quiet", ref]));

  return judgePrByAhead(target, targetRef, { branch, parents });
}

/** 把「源分支是否超出目标分支」这一步单独拆出来,便于直接断言(不需要造仓库)。 */
function judgePrByAhead(target, targetRef, ctx) {
  if (!targetRef) {
    return {
      ...ctx,
      blocked: false,
      reason: "本地取不到目标分支 " + target + "(浅克隆 / 单分支检出),无法判定(保守放行)",
    };
  }
  const aheadRaw = git(["rev-list", "--count", targetRef + "..HEAD"]);
  const ahead = Number.parseInt(aheadRaw, 10);
  if (!Number.isFinite(ahead)) {
    return { ...ctx, blocked: false, reason: "无法计算 " + targetRef + "..HEAD 的提交数(保守放行)" };
  }
  if (ahead > 0) {
    return {
      ...ctx,
      blocked: false,
      ahead,
      reason: "源分支有 " + ahead + " 个提交不在 " + target + " 上(正常 PR)",
    };
  }
  return {
    ...ctx,
    blocked: true,
    ahead,
    reason: "源分支没有任何超出 " + target + " 的提交 —— 源分支就是 " + target,
  };
}

/** 阻断时打印人类可读的出口(怎么改),不只报错。 */
function printBlockedTip(branch) {
  console.error("");
  console.error("[branch-guard] 阻断:检测到直接向 " + branch + " 分支提交(规范 13.6)。");
  console.error("[branch-guard] " + branch + " 只接受「分支开发 → PR → 评审 → 合并」的变更。");
  console.error("[branch-guard] 正确做法:");
  console.error("[branch-guard]   git checkout -b feat/<简短描述>     # 新建工作分支");
  console.error("[branch-guard]   git commit                           # 在新分支上提交");
  console.error("[branch-guard]   git push origin HEAD                # 推送并创建 PR");
  console.error("[branch-guard] 已经提交在 " + branch + " 上(尚未 push)时,把提交搬走再推:");
  console.error("[branch-guard]   git branch feat/<简短描述>           # 用当前提交建分支");
  console.error("[branch-guard]   git reset --hard origin/" + branch + " # " + branch + " 回退到远端状态");
  console.error("[branch-guard]   git checkout feat/<简短描述>         # 继续开发");
  console.error("[branch-guard] 若确实是 PR 合并提交被误判:确认 HEAD 有 2 个父提交后走 --no-verify 并说明原因。");
}

function main() {
  const statusOnly = process.argv.includes("--status");
  const result = evaluate();
  const mergeCommit = process.argv.includes("--merge-commit");

  if (statusOnly) {
    console.log(
      "[branch-guard] 当前分支 " + (result.branch || "(detached)") +
      ",父提交数 " + result.parents + " → " + result.reason
    );
    return;
  }

  // --pr-check:服务端复核。判据与本地钩子**不同**(见 evaluatePr 的说明):
  // 这里 HEAD 是预合并提交,分支名恒等于目标分支,只能按提交拓扑判。
  if (process.argv.includes("--pr-check")) {
    const target = argValue("--target") || PROTECTED_BRANCH;
    const pr = evaluatePr(target);
    console.log(
      "[branch-guard] v" + GUARD_VERSION + " PR 源分支复核:HEAD 分支 " +
      (pr.branch || "(detached)") + ",父提交数 " + pr.parents +
      ",目标分支 " + target
    );
    if (pr.blocked) {
      console.error("");
      console.error("[branch-guard] 阻断:" + pr.reason + "(规范 13.6)。");
      console.error("[branch-guard] " + PROTECTED_BRANCH + " 只接受「分支开发 → PR → 评审 → 合并」的变更。");
      console.error("[branch-guard] 把改动放到一条特性分支上再开 PR:");
      console.error("[branch-guard]   git checkout -b feat/<简短描述>     # 新建工作分支");
      console.error("[branch-guard]   git push origin HEAD                # 推送并创建 PR");
      process.exit(1);
    }
    console.log("[branch-guard] OK(" + pr.reason + ")");
    return;
  }

  if (mergeCommit) {
    // master 的 push 事件上 HEAD 就是合并提交:PR 已经合进来了,判据换成「合并提交即放行」。
    // 先按分支分流:不在受保护分支上时这条判据无从命中,不该误报。
    if (result.branch !== PROTECTED_BRANCH) {
      console.log("[branch-guard] OK(不在 " + PROTECTED_BRANCH + " 上,push 复核不适用)");
      return;
    }
    if (result.parents > 1) {
      console.log("[branch-guard] v" + GUARD_VERSION + " push 复核:HEAD 有 " + result.parents + " 个父提交(PR 合并提交) → 放行");
      return;
    }
    console.error("");
    console.error("[branch-guard] 阻断:master 上出现非合并提交(" + result.reason + "),规范 13.6。");
    console.error("[branch-guard] 这说明有变更绕过了 PR:本地门槛可被 --no-verify 绕过,平台侧请确认分支保护已开启。");
    process.exit(1);
  }

  if (result.blocked) {
    printBlockedTip(result.branch);
    process.exit(1);
  }
  console.log("[branch-guard] OK(" + result.reason + ")");
}

module.exports = { evaluate, currentBranch, parentCount, PROTECTED_BRANCH };

if (require.main === module) main();
