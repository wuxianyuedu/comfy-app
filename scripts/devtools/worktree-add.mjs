/**
 * worktree-add.mjs —— 安全建一棵 linked worktree（ISSUE #5174，与 `worktree:remove` 成对）。
 *
 * 硬规则 30：落点只能是仓库根的 `.worktrees/` 或系统临时目录；不许落在 `.git/` 下
 * （vitest 的 fs.deny 会让用例在模块加载期就 deny），不许把新树的 `node_modules`
 * 指向主检出（`git worktree remove --force` 会顺着链接把主检出依赖整棵删空）。
 * 「删」已经有工具，「建」是最容易埋下这两个雷的时刻，所以在这里把禁戒变成判据。
 *
 * 用法：`pnpm worktree:add <路径> [--branch <名>|--detach <ref>]`
 * 退码：0 = 建好；1 = git 建树失败；2 = 用法 / 落点 / 链接禁戒不成立。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveGitDir } from "../lib/git-dir.mjs";
import { runGateStep } from "../launcher-core/shell.mjs";

const ROOT = process.cwd();

/**
 * 落点判据。纯函数，便于用例直接喂形状。
 *
 * `gitDir` 由调用方问 `resolveGitDir()` 取（链接工作树里 `.git` 是文件，硬拼指不到）；
 * 本函数只判形状，不自己拼检出目录。
 *
 * @param {{target:string, root:string, tmp?:string, gitDir?:string}} input
 * @returns {{ok:boolean, reason:string}}
 */
export function checkWorktreeLocation({ target, root, tmp = os.tmpdir(), gitDir = "" }) {
  const p = path.resolve(target);
  /** @param {string} s */
  const norm = (s) => path.resolve(s).replaceAll("\\", "/").toLowerCase();
  /** @param {string} parent @param {string} child */
  const inside = (parent, child) => {
    const a = norm(parent).endsWith("/") ? norm(parent) : `${norm(parent)}/`;
    return norm(child).startsWith(a);
  };
  if (p.split(/[\\/]/).includes(".git")) {
    return {
      ok: false,
      reason: "落点不许在 .git/ 下（git 自己的簿记目录，且 vitest fs.deny 会 deny）",
    };
  }
  if (gitDir && inside(gitDir, p)) {
    return { ok: false, reason: "落点在仓库 .git/ 目录内" };
  }
  if (inside(path.join(root, ".worktrees"), p) || inside(tmp, p)) {
    return { ok: true, reason: "" };
  }
  return {
    ok: false,
    reason: `落点只能是 ${path.join(root, ".worktrees")}/ 或系统临时目录 ${tmp}/ 之下`,
  };
}

/** @param {string} target */
function hasDependencyLink(target) {
  try {
    return fs.lstatSync(path.join(target, "node_modules")).isSymbolicLink();
  } catch {
    return false;
  }
}

/** @param {string[]} argv */
function main(argv) {
  const rest = [...argv];
  const branchAt = rest.indexOf("--branch");
  const detachAt = rest.indexOf("--detach");
  const target = rest[0];
  if (!target || target.startsWith("-")) {
    process.stderr.write("用法：pnpm worktree:add <路径> [--branch <名>|--detach <ref>]\n");
    return 2;
  }
  if (branchAt !== -1 && detachAt !== -1) {
    process.stderr.write("[worktree:add] --branch 与 --detach 互斥，一次只选一种。\n");
    return 2;
  }
  const verdict = checkWorktreeLocation({
    target,
    root: ROOT,
    gitDir: resolveGitDir(ROOT) ?? "",
  });
  if (!verdict.ok) {
    process.stderr.write(`[worktree:add] ✗ ${verdict.reason}\n`);
    return 2;
  }
  if (fs.existsSync(target)) {
    if (hasDependencyLink(target)) {
      process.stderr.write(
        `[worktree:add] ✗ ${target}/node_modules 是指向主检出的链接 ⇒ 拒绝建树\n` +
          "（git worktree remove --force 会沿链接删空主检出依赖，硬规则 30）\n",
      );
      return 2;
    }
    process.stderr.write(`[worktree:add] ✗ ${target} 已存在，拒绝覆盖。\n`);
    return 2;
  }
  const mode =
    branchAt === -1
      ? detachAt === -1
        ? []
        : ["--detach", String(rest[detachAt + 1] ?? "")]
      : ["--branch", String(rest[branchAt + 1] ?? "")];
  const res = runGateStep("git", ["worktree", "add", path.resolve(target), ...mode], {
    cwd: ROOT,
    timeoutMs: 120_000,
    echo: true,
  });
  if (res.status !== 0) {
    process.stderr.write(
      `[worktree:add] git worktree add 退 ${String(res.status)}：${res.stderr}\n`,
    );
    return 1;
  }
  process.stdout.write(
    `[worktree:add] ✓ ${path.resolve(target)}\n` +
      "[worktree:add] 每树自装依赖：pnpm install --frozen-lockfile（不要指向主检出的 node_modules）\n",
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
