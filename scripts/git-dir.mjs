/**
 * git-dir.mjs —— 「本检出的 `.git` 到底在哪」的**唯一实现**，以及落在它里面的
 * 机器本地文件该放哪。
 *
 * ── 为什么要单独成一份 ──────────────────────────────────────────────
 *
 * 这件事此前有**三份**各自实现（`precommit-timing.mjs` 里一份正确的、
 * `check-deps-freshness.mjs` 里一份语义不同的、`premerge-proof.mjs` 里一段内联的），
 * 外加若干处直接 `path.join(root, ".git", …)` 硬拼。硬拼那一批在两种检出上是错的：
 *
 *   · **worktree**（`git worktree add` 建的那一份）里，`<root>/.git` 是一个
 *     **指向 `…/.git/worktrees/<name>` 的文件**，不是目录；
 *   · 设了 `GIT_DIR` 环境变量时，真正的 git 目录与仓库根**可以毫无关系**。
 *
 * 而本仓**恰好就靠 worktree 跑事后复算**（`base-check.mjs` 建临时快照检出）。硬拼那一份
 * 会把账写到别处去 —— 写进去的那侧不报错，读的那侧只是「永远读不到」，
 * 于是「这次没留下证据」看起来就像「这次没有证据要留」。
 *
 * ── 契约：读不出就回 `null`，**不退回猜一个路径** ────────────────────
 *
 * `check-deps-freshness.mjs` 里那一份读不出时退回 `<root>/.git` 并把可用性交给调用方判。
 * 那是一种**不同的契约**，不是这一份的重复 —— 所以本模块刻意不采纳它：
 * 猜出来的路径会让「不知道」在下游被读成「知道，而且答案是 `.git`」。
 * 统一成 `null` 之后，「不在检出里」这件事必须在调用点显式处理，
 * 而那是这一族唯一正确的失效方向（宁可少写一份文件，不可写到别处）。
 *
 * ── 一条拿返回值之前要知道的形状 ────────────────────────────────────
 *
 * 返回的是 **git 自己给的正斜杠形式**（`C:/Users/…/repo/.git`），不是 `path.join`
 * 那种平台形式。拿去 `path.join(gitDir, name)` 拼落点没问题（Win32 两种分隔符都收），
 * 但**别拿它做字符串相等 / `includes` 比较** —— 与 `path.join` 的结果两种拼法永不相等，
 * 而反向断言（`not.toContain`）在这种比较下**恒真**，落错了地方也测不出来。
 * 要比就先归一，见 `tests/git-dir.test.ts` 里那句 `norm()`。
 *
 * 留在原地没并过来的（另案，理由见各自文件）：`check-deps-freshness.mjs` 那份
 * 退回式实现，以及 `check-reformat-only.cjs` / `launcher-core/run.mjs` /
 * `ci-workspace-probe.mjs` 里几处硬拼的 `.git/<某个引用文件>`。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

/**
 * 这份工作区此刻是不是停在「`git merge` 已解完冲突、提交还没落地」那一态
 * （`$GIT_DIR/MERGE_HEAD` 在场）。
 *
 * 判据是 git 自己在合并过程中写的状态文件 —— 它也是「`git commit` 将要产生的这次提交
 * 有两个父提交、且第二个就是被合并进来的那个 rev」的唯一权威信号。**不拿别的近似**：
 * `git merge-base` 看不出来（HEAD 还没动）、`--is-ancestor` 也看不出来（同上），
 * 而「暂存区里有什么」更是无关（自己改依赖也是这个形态）。
 *
 * `$GIT_DIR` 一律经 `resolveGitDir()`：链接工作树（`git worktree`）里 `.git` 是个
 * **文件**不是目录，拿 `<根>/.git/MERGE_HEAD` 硬拼会永远读不到，于是靠它降档的判据
 * **静默不降**（本文件头「另案」那条清单讲的就是这个形状）。
 *
 * @param {string} root 检出根（或检出内任一路径）
 * @returns {boolean} 读不到 git 目录时返回 `false` —— 保守方向：宁可照旧多判一次，
 *                    也不把「查不了」读成「没问题」。
 */
export function hasInProgressMerge(root) {
  try {
    const gitDir = resolveGitDir(root);
    return gitDir ? fs.existsSync(path.join(gitDir, "MERGE_HEAD")) : false;
  } catch {
    return false;
  }
}

/**
 * 本检出的 git 目录绝对路径；不在检出里时返回 `null`。
 *
 * 走 git 而不是自己判断「`.git` 是目录还是文件」：`rev-parse --absolute-git-dir`
 * 一条命令就把 worktree 指针、`GIT_DIR`、裸仓库三种形态全解了，
 * 而手判只能覆盖自己想到的那一种。
 *
 * @param {string} [cwd] 检出内任一路径
 * @returns {string | null} git 目录绝对路径，或 `null`
 */
export function resolveGitDir(cwd = process.cwd()) {
  const r = spawnSync("git", ["rev-parse", "--absolute-git-dir"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (r.status !== 0) {
    return null;
  }
  const dir = String(r.stdout ?? "").trim();
  return dir || null;
}

/**
 * 「机器本地、不入库」的那个文件该落在哪 —— 统一落在 git 目录里。
 *
 * 本仓已经有两户住在这儿（`comfy-premerge-proof.json` / `comfy-precommit-timing.jsonl`），
 * 理由同一条：**它描述的是这台检出的状态，不是项目的内容**，所以既不该进 `git status`、
 * 也不该被并行检出共享（A 的证据给 B 作证 = 假绿）。`log/` 不是替代落点 ——
 * 那是应用运行期的日志布局（规范 §4），与开发者机器上的钩子状态不是一件事。
 *
 * git 目录取不到时回 `null`（⇒ 调用方**跳过**这次写，而不是猜一个路径写出去）。
 *
 * @param {string} root 检出根
 * @param {string} name 文件名或子目录名（不含路径分隔符）
 * @param {(cwd?: string)=>string | null} [resolve] 注入点（测试用）
 * @returns {string | null} 绝对路径，或 `null`
 */
export function gitScratchPath(root, name, resolve = resolveGitDir) {
  const gitDir = resolve(root);
  if (!gitDir) {
    return null;
  }
  return path.join(/* turbopackIgnore: true */ gitDir, name);
}
