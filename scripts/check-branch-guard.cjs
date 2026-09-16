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
 * 判据的**场景判据**(为什么不能借用 CNB_PULL_REQUEST):
 *   服务端复核的调用方是 .cnb.yml 的 pull_request 流水线,那里 CNB_PULL_REQUEST
 *   为 true,但 PR 的**预合并提交**在容器里 HEAD 的分支名不是 master —— 抓不到
 *   「源分支就是 master」这件事。而触发者可能把 .cnb.yml 里的那一行删掉(PR 类
 *   事件是「不可信事件」,流水线配置取自源分支),因此本脚本必须自己独立判定,
 *   不能依赖流水线里的那条命令还在。
 *
 * 用法:
 *   node scripts/check-branch-guard.cjs          # 提交场景检查(违规即阻断)
 *   node scripts/check-branch-guard.cjs --status # 只看当前分支现状
 *   node scripts/check-branch-guard.cjs --pr-check # PR 源分支复核(--ci-alias 的同义词)
 *   node scripts/check-branch-guard.cjs --ci-alias # 同上,供 .cnb.yml 显式声明
 */
/**
 * 判据版本 —— 本值一变,「旧版本挡下了什么」就有缺口:.cnb.yml 里那条调用行属于
 * PR 类「不可信事件」的配置(取自源分支),可能被人删掉。回归测试
 * tests/cnb-pipeline-gates.test.ts 用它核对 .cnb.yml 的调用——守卫排在第 1 条,
 * 版本不符时真的会被拦下,而不是「看起来还在跑」。
 */
const GUARD_VERSION = "2";
const { execFileSync } = require("node:child_process");

/**
 * 受保护的主分支名 —— 与 .cnb.yml 的触发分支、规范 §13.6 一致。
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

  if (statusOnly) {
    console.log(
      "[branch-guard] 当前分支 " + (result.branch || "(detached)") +
      ",父提交数 " + result.parents + " → " + result.reason
    );
    return;
  }

  // --pr-check / --ci-alias:服务端复核的调用形态。判据与本地钩子完全相同——
  // 同一个脚本、同一份 evaluate(),不另写一条「CI 专用」的分支名判断。
  if (process.argv.includes("--pr-check") || process.argv.includes("--ci-alias")) {
    console.log(
      "[branch-guard] v" + GUARD_VERSION + " PR 源分支复核:分支 " +
      (result.branch || "(detached)") + ",父提交数 " + result.parents
    );
  }

  if (result.blocked) {
    printBlockedTip(result.branch);
    process.exit(1);
  }
  console.log("[branch-guard] OK(" + result.reason + ")");
}

module.exports = { evaluate, currentBranch, parentCount, PROTECTED_BRANCH };

if (require.main === module) main();
