#!/usr/bin/env node
/**
 * check-merge-parents.mjs — 「合并提交必须双亲」的提交门槛（规范 §13.6.1 / ISSUE #1594）
 *
 * **立案现场**：一次解冲突之后，合并结果落成了**单亲提交** —— 树是对的、拓扑是错的，
 * 平台侧因此认不出「已合并」，`mergeable_state` 一直停在 conflict，而本地钩子四组全绿。
 * 根因是 `git checkout`（含 `checkout -b`）在合并进行中会**静默清掉** `.git/MERGE_HEAD`
 * 与 `.git/MERGE_MSG`（实测：`git checkout -b other` 直接吞掉 MERGE_HEAD、退出码 0、
 * 不留任何痕迹），此后 `git commit` 照常成一个单亲提交。
 *
 * **判据**：提交信息**声明自己是合并**（`Merge …` 形态）时，本次提交必须真的有两个父。
 * 「声明」取自 git 自己写下的合并信息（`Merge branch 'x'` / `Merge remote-tracking …`
 * / `Merge tag …` / `Merge commit …` / `Merge pull request …`），不引入第二份清单。
 * `MERGE_HEAD` 不在而消息是合并信息 —— 那就是回退发生的形态，**当场阻断**。
 *
 * **为什么落在 `prepare-commit-msg` 而不是 `pre-commit`**：
 *   · `pre-commit` **看不到本次的消息** —— 实测 `COMMIT_EDITMSG` 在 pre-commit 时仍停在
 *     **上一条**提交的信息上（git 先跑钩子、后落盘消息）；
 *   · `prepare-commit-msg` 收到 `$2`（source），可干净地把 `--amend` 排除在判据之外 ——
 *     amend 的消息照样是 `Merge branch 'x'`、`MERGE_HEAD` 也照样不在，但它的父提交
 *     从 HEAD **继承**（结果仍是双亲），拿它当判据会 100% 误报真正修合并信息的人。
 *
 * **为什么「父提交数」不能只看 `MERGE_HEAD` 在不在**：本次提交将要落几个父，git 的
 * 事实只有两处 —— ① `.git/MERGE_HEAD` 有几行（每行一个被合并的父）；② 没有它时就是
 * 「`HEAD` 一个父」。所以判据是 `1 + MERGE_HEAD 行数`，与 `--merge-commit` 那侧
 * 事后复算的拓扑同源。
 *
 * **边界（都取保守放行，与 §13.6.1 同一口径：判据无从命中时不该误报）**：
 *   · source = `commit`（`--amend` / `-c` / `-C` / cherry-pick / revert）→ 放行：
 *     这些形态的父提交不从 MERGE_HEAD 来，消息里的合并字样不足以判定；
 *   · 取不到消息（文件不可读 / 空）→ 放行；
 *   · 非 git 目录（tarball 解包 / 裸目录）→ 放行并说明；
 *   · 消息里有合并字样但**不是**首行声明的形态（如正文提到 "Merge branch"）→ 放行：
 *     判据只认 git 自己会写的那几种首行，宁可漏、不可误报。
 *
 * 用法：
 *   node scripts/check-merge-parents.mjs <消息文件> [source]   # 由 .githooks/prepare-commit-msg 调用
 *   node scripts/check-merge-parents.mjs --status              # 只体检，不阻断（调试用）
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

/**
 * git 自己会写下的合并信息形态（首行）。
 *
 * 这几条是**事实来源**，不是手写清单：`git merge` 的默认消息由 git 的
 * `fmt_merge_msg()` 生成，形态就是 `Merge <被合的东西>`（branch / remote-tracking
 * branch / tag / commit / 本地化前的英文）。`Merge pull request #N` 是平台侧
 * merge commit 合并时写下的形态。故意只认首行：正文里出现 "Merge branch" 不构成声明。
 */
const MERGE_MESSAGE_RE =
  /^Merge (?:branch|remote-tracking|tag|commit|pull request|ref)\b/;

/**
 * 在仓库内跑一条 git 命令；失败时回 ""（裸目录 / 浅克隆里取不到值）。
 *
 * @param {string[]} args
 * @returns {string}
 */
function git(args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/** 本次提交将要落在几个父上：`HEAD` 一个，加上 `MERGE_HEAD` 的每一行（一个被合并的父）。 */
function pendingParentCount() {
  const mergeHead = git(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]);
  if (!mergeHead) return 1;
  // `git rev-parse MERGE_HEAD` 会把每一行都打出来（多父合并时不止一行）。
  return mergeHead.split(/\s+/).filter(Boolean).length + 1;
}

/**
 * 消息文件的前若干行里的首行声明（跳过后面的注释与空行）。
 *
 * @param {string} messageFile
 * @returns {boolean}
 */
function readMergeClaim(messageFile) {
  let text;
  try {
    text = fs.readFileSync(messageFile, "utf8");
  } catch {
    return false;
  }
  const firstLine = text.split("\n").find((line) => line.trim() !== "") ?? "";
  return MERGE_MESSAGE_RE.test(firstLine.trim());
}

/**
 * 逐条给出「为什么放行 / 为什么阻断」，返回值便于测试直接断言。
 * @param {{messageFile: string, source: string}} input
 */
export function evaluate({ messageFile, source }) {
  // ① amend / cherry-pick / revert / `-c` `-C`：父提交不从 MERGE_HEAD 来，消息里的
  //    合并字样不足以判定（amend 一个合并提交时消息照样是 Merge…，而结果仍是双亲）。
  if (source === "commit") {
    return {
      blocked: false,
      parents: null,
      reason: `source=${source}（父提交不从 MERGE_HEAD 来，不判）`,
    };
  }

  // ② 非 git 目录：判据无从命中，放行并说明（与 check-branch-guard 同口径）。
  if (!git(["rev-parse", "--git-dir"])) {
    return {
      blocked: false,
      parents: null,
      reason: "不在 git 检出里，判据无从命中（保守放行）",
    };
  }

  // ③ 消息没声明自己是合并 → 本次提交不是合并，与「父提交数」无关。
  if (!readMergeClaim(messageFile)) {
    return {
      blocked: false,
      parents: pendingParentCount(),
      reason: "提交信息未声明是合并",
    };
  }

  // ④ 声明了合并 → 必须真的有两个父。
  const parents = pendingParentCount();
  if (parents > 1) {
    return {
      blocked: false,
      parents,
      reason: `声明是合并且确有 ${parents} 个父提交`,
    };
  }
  return {
    blocked: true,
    parents,
    reason:
      "提交信息声明是合并（Merge …），但本次提交只有一个父提交（MERGE_HEAD 不在）",
  };
}

/** 阻断时打印人类可读的出口（怎么改），不只报错。 */
function printBlockedTip() {
  console.error("");
  console.error(
    "[merge-parents] 阻断:提交信息声明是合并,但本次提交只有一个父(规范 §13.6.1)。",
  );
  console.error(
    "[merge-parents] 常见根因:合并进行中执行了 git checkout / git checkout -b /",
  );
  console.error(
    "[merge-parents]   git branch -f + checkout —— 它们会静默清掉 .git/MERGE_HEAD。",
  );
  console.error(
    "[merge-parents] 后果:树是对的、拓扑是错的,平台侧认不出「已合并」,PR 会一直显示冲突。",
  );
  console.error("[merge-parents] 正确做法(在解冲突的那条分支上重建合并):");
  console.error(
    "[merge-parents]   git reset --soft HEAD^                  # 退回合并前,改动全留在索引",
  );
  console.error(
    "[merge-parents]   git merge --no-commit <被合分支>       # 重新起合并(--no-commit 不必重新解冲突)",
  );
  console.error(
    "[merge-parents]   git commit                            # 此时 MERGE_HEAD 在场,落成双亲提交",
  );
  console.error(
    "[merge-parents] 若这确实不是合并提交(消息写错了):改掉首行,别用 --no-verify 绕过。",
  );
}

function main() {
  const argv = process.argv.slice(2);
  const statusOnly = argv.includes("--status");
  const positional = argv.filter((a) => !a.startsWith("--"));
  const messageFile = positional[0] || ".git/COMMIT_EDITMSG";
  const source = positional[1] || "";

  const result = evaluate({ messageFile, source });

  if (statusOnly) {
    console.log(
      `[merge-parents] 消息文件 ${messageFile},source ${source || "(非 git 提供)"} → ${result.reason}`,
    );
    return;
  }
  if (result.blocked) {
    console.error(`[merge-parents] ${result.reason}`);
    printBlockedTip();
    process.exit(1);
  }
  console.log(`[merge-parents] OK(${result.reason})`);
}

// 只在被直接运行时执行 CLI（被 import 时不跑）。
//
// ⚠️ 判「是不是直接运行」用**路径解析后比较**，不是拼 `file://${argv[1]}`：后者在
// Windows 上（`file:///C:/…` vs `file://C:\…`）恒不相等 ⇒ `main()` 一次都不跑而
// 退出码恒 0 —— 正是本仓库最怕的「判据在场、却什么都不做」。同族写法见
// `scripts/check-deps-freshness.mjs`。
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  main();
}
