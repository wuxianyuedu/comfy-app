/**
 * worktree-remove.mjs —— 收掉一棵 linked worktree：**先摘 `node_modules` 链接、确认它真没了，
 * 再让 git 注销登记**（ISSUE #2997）。
 *
 * 为什么要有入口，而不是手敲两条命令：临时 worktree（`.git/wt-*` 那类）的 `node_modules`
 * 有两种形态 —— `mklink /J` / Node `symlink(...,"junction")` 的 junction，与 MSYS `ln -s`
 * / Node `symlink(...,"dir")` 的 symlink。**同一条外部命令对两者的结果不同**：一次
 * `cmd /c rmdir` 摘得掉 junction，对 MSYS symlink 退 145 且链接仍在；而收尾那串命令常把
 * 退出码丢掉。留下的链接随后会被 `git worktree remove --force` 顺着走进**主检出**，
 * 把依赖树删空 —— 症状是 `ls -A node_modules` 为 0，要重跑 `pnpm install` 才恢复。
 * 本入口用 Node 的 lstat / rmdir / unlink 走同一条路径，**两形结果一致**。
 *
 * 三件事，每一步的结论都来自原值：
 *   ① 按链接形态摘掉它（{@link unlinkDependencies}，只摘链接本体，不穿透目标）；
 *   ② 用 **lstat** 确认链接本体真的没了（`existsSync` 对断链为假，不能当结论）；
 *   ③ 才调 `git worktree remove --force`；收尾再回读链接目标仍在。
 * 摘不掉就**不摘 worktree**并退 1：宁可在临时区留一棵目录，也不拿主检出的依赖换整洁。
 *
 * 用法：`pnpm worktree:remove <worktree 路径>`（在主检出里跑；目标不能是主 worktree 自己）。
 * 退出码：0 = 收尾完成；1 = 有事实是红的（链接没摘掉 / git 注销失败 / 目标被删穿）；
 * 2 = 用法或前置不成立（没给路径 / 目标不在 `git worktree list` 里 / 目标就是主 worktree）。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { unlinkDependencies } from "./base-check.mjs";

const ROOT = process.cwd();

/**
 * 大小写与分隔符对齐（git 输出是正斜杠；Windows 路径比较不分大小写）。
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function samePath(a, b) {
  /** @type {(p: string) => string} */
  const norm = (p) => path.resolve(p).replaceAll("\\", "/");
  const left = norm(a);
  const right = norm(b);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** `git worktree list --porcelain` 里登记在案的路径；第一条是主 worktree。 */
function listWorktrees() {
  const res = spawnSync("git", ["-c", "core.quotePath=false", "worktree", "list", "--porcelain"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (res.status !== 0) {
    return null;
  }
  const entries = [];
  for (const line of res.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      entries.push(line.slice("worktree ".length).trim());
    }
  }
  return entries;
}

/**
 * 链接本体还在不在：`existsSync` 对断链为假，所以只认 lstat。
 *
 * @param {string} link
 * @returns {boolean}
 */
function linkStillThere(link) {
  try {
    fs.lstatSync(link);
    return true;
  } catch {
    return false;
  }
}

/**
 * 0/1/2 三种退码，原文写出去；不吞退出码。
 *
 * @param {number} code
 * @param {string} message
 * @returns {number}
 */
function fail(code, message) {
  process.stderr.write(`[worktree-remove] ✗ ${message}\n`);
  return code;
}

/**
 * @param {Array<string>} argv 不含 node 与脚本名
 * @returns {number} 退出码
 */
function main(argv) {
  const raw = argv[0];
  if (!raw || raw.startsWith("-")) {
    process.stderr.write(
      "用法：pnpm worktree:remove <worktree 路径>\n" +
        "  先摘 `<路径>/node_modules` 链接、确认链接本体没了，再 `git worktree remove --force`。\n",
    );
    return 2;
  }
  const target = path.resolve(raw);
  const worktrees = listWorktrees();
  if (!worktrees) {
    return fail(1, `取不到 worktree 清单（在 ${ROOT} 跑 \`git worktree list\` 失败了）`);
  }
  const registered = worktrees.find((p) => samePath(p, target));
  if (!registered) {
    return fail(
      2,
      `目标 ${target} 不在 \`git worktree list\` 里 —— 已注销就用 \`git worktree prune\`，` +
        "别直接删目录",
    );
  }
  const mainWorktree = worktrees[0];
  if (mainWorktree && samePath(mainWorktree, target)) {
    return fail(2, `目标是主 worktree 本身（${target}）：这里只收 linked worktree`);
  }
  if (!fs.existsSync(target)) {
    return fail(2, `目标目录不存在（${target}）：登记还在就用 \`git worktree prune\``);
  }

  const link = path.join(target, "node_modules");
  let stat = null;
  try {
    stat = fs.lstatSync(link);
  } catch {
    /* 没有 node_modules：下面按「无需摘链」继续。 */
  }
  let linkTarget = null;
  if (stat?.isSymbolicLink()) {
    linkTarget = path.resolve(path.dirname(link), fs.readlinkSync(link));
    process.stdout.write(`[worktree-remove] 摘链接（只摘链接本体）：${link}\n`);
    const removed = unlinkDependencies(link);
    if (!removed || linkStillThere(link)) {
      /* 摘不掉就不摘 worktree：`git worktree remove --force` 会穿链接删进目标。 */
      return fail(
        1,
        `链接没摘掉（${link}）⇒ **跳过 worktree 清理**，请手工处理这个链接后重跑`,
      );
    }
  } else if (stat) {
    process.stdout.write(`[worktree-remove] ${link} 是真目录，不是链接 ⇒ 不动它（随 worktree 一起收）\n`);
  }

  const removed = spawnSync("git", ["worktree", "remove", "--force", target], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (removed.status !== 0) {
    return fail(
      1,
      `git worktree remove --force 退 ${removed.status ?? "未知"}：${(removed.stderr || "").trim()}`,
    );
  }
  /* git 报成功但目录还在时兜底 —— 此时链接已经摘掉，递归删不会穿进任何目标。 */
  fs.rmSync(target, { recursive: true, force: true });
  if (fs.existsSync(target)) {
    return fail(1, `worktree 目录没收干净：${target}`);
  }

  if (linkTarget && !fs.existsSync(linkTarget)) {
    return fail(1, `链接目标被删穿了：${linkTarget}（这条链接不该被穿透）`);
  }
  process.stdout.write(
    `[worktree-remove] ✓ 收尾完成 | worktree=${target} | 链接=${stat?.isSymbolicLink() ? "已摘" : "无"}` +
      `${linkTarget ? ` | 目标仍在=${linkTarget}` : ""}\n`,
  );
  return 0;
}

process.exit(main(process.argv.slice(2)));
