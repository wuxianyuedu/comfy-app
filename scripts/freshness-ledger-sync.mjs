/**
 * 新鲜度账的「跨分支」那一半：从机器自有分支 `ci/freshness-ledger` 读（回看）、往它推（回写）。
 * 从 `scripts/freshness-ledger.mjs` 拆出来，是因为后者已贴近 `scripts/**` 900 行硬闸
 * （§12.6 R5），而这部分是「机制层」、和「本地工作树账」的声明层本就该分开。
 *
 * 设计形状见规范 §13.5.4 + ISSUE #2247：
 *  - 读取侧**绝不发网络请求**：`git show <已 fetch 的本地 ref>:<rel>` 只在本地对象库取。
 *  - 回写侧不触发流水线（分支键只有 `master:` + commit 带 `[ci skip]`）、不回写 PR 源分支
 *    （触发者只限每日定时任务，可信事件 ⇒ 同仓 `repo-code:rw`）。
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  FRESHNESS_TRACKS,
  contextSubject,
  freshnessTrack,
  gitUser,
} from "./freshness-ledger.mjs";

/** 新鲜度账回写去的机器自有分支（ISSUE #2247）。不推 `master`、更不推作者的源分支。 */
export const FRESHNESS_LEDGER_BRANCH = "ci/freshness-ledger";

/**
 * 从一条 git ref（默认 `ci/freshness-ledger`）读一份新鲜度账，用于「平台每日跑绿的账
 * 不落回工作树、只在机器分支上」的回看（ISSUE #2247）。
 *
 * 读不出（ref 不存在 / 该路径在 ref 上不存在 / 坏 JSON / 不是对象）返回 `null`，
 * 调用方据此回退到工作树账。**绝不发网络请求**：`git show` 只在本地对象库取。
 *
 * @param {{root: string, rel: string, branch?: string}} args
 * @returns {Record<string, unknown> | null}
 */
export function readBranchLedger({ root, rel, branch }) {
  const ref =
    branch || process.env.FRESHNESS_LEDGER_BRANCH || FRESHNESS_LEDGER_BRANCH;
  const res = spawnSync("git", ["show", `${ref}:${rel}`], {
    cwd: root,
    encoding: "utf8",
  });
  if (res.error || res.status !== 0 || typeof res.stdout !== "string") return null;
  try {
    const parsed = JSON.parse(res.stdout);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 把当前工作树里已刷新（跑绿）的新鲜度账回写到机器自有分支 `ci/freshness-ledger`（#2247）。
 *
 * 仅在 `FRESHNESS_LEDGER_PUSH=1` 时真正推（由 `.cnb.yml` 每日档三格显式带上），
 * 其余上下文（本地 `build:tracked`、PR 流水线）一律 no-op，不会误推。
 *
 * 一次把**三份**账一并推上分支：本 runner 刷新过的那份用工作树里的新鲜副本，其余两份
 * 从分支上取最新（若有），保证分支上始终是「每份各自最近一次」的并集，而不是被某一份
 * 覆盖成只剩自己。
 *
 * 回写失败（没权限 / 没 fetch 到 / 冲突）只返回 `{pushed:false, reason}`，**不**让跑法
 * 脚本的结论被污染（`writeFreshness` 已经拿到了跑绿结论）。
 *
 * @param {{root: string, kinds: string[]}} args
 * @returns {{pushed: boolean, reason?: string}}
 */
export function pushFreshnessLedger({ root, kinds }) {
  // 只在平台侧（CNB 流水线）真正推：本地 `build:tracked`、开发者自己分支跑都不会动账；
  // PR 流水线本来就不跑这三格（跑法脚本只在「每日档 / 单跑口」里被调用）。
  // 用 CNB 的平台身份环境变量判定（与 `gitUser` 同源），**不**在 `.cnb.yml` 逐格写 env——
  // 因为「每日档」与「单跑口」同名 stage 正文须逐字相同（tests/no-platform-ci-config.test.ts 钉死），
  // 写在 stage 里会让 daily 与 oneshot 正文分叉、破坏判据。
  const platformUser =
    process.env.CNB_BUILD_USER_NICKNAME ||
    process.env.CNB_COMMITTER ||
    process.env.CNB_BUILD_USER;
  if (!platformUser) {
    return { pushed: false, reason: "not-platform" };
  }
  /* ⚠️ **只有主干主体才回写**（判据主体分权，ISSUE #2300）：PR 上下文回写会把「这次 PR 的
   * 账」推到机器分支上，而那一份是**主干**的账 —— 主干的读数里混进 PR 的记录之后，PR 的
   * 记录就替主干作了证（那正是「机器账权威」那条要防的倒过来形态）。
   * 每日档那几格带 `COMFY_CI_SUBJECT=master` ⇒ **每日档回写照旧**（这一段刻意放在平台
   * 身份之后：本地那一支的 `reason` 仍是 `not-platform`，两处不能各说一套）。 */
  if (contextSubject() !== "master") {
    return { pushed: false, reason: "not-master-subject" };
  }
  const branch =
    process.env.FRESHNESS_LEDGER_BRANCH || FRESHNESS_LEDGER_BRANCH;
  const allRels = [
    ...new Set(Object.values(FRESHNESS_TRACKS).map((t) => t.ledger)),
  ];
  const freshRels = new Set(kinds.map((k) => freshnessTrack(k).ledger));
  /* 把分支上「另外两档」的最新副本取回工作树，避免只推自己那份把别的覆盖掉。
   * 取不回（分支上还没有 / 路径不存在）就留工作树原样，下一拍再补。 */
  for (const rel of allRels) {
    if (freshRels.has(rel)) continue;
    const fromBranch = readBranchLedger({ root, rel, branch });
    if (fromBranch) {
      try {
        writeFileSync(
          path.join(root, rel),
          `${JSON.stringify(fromBranch, null, 2)}\n`,
          "utf8",
        );
      } catch {
        /* 忽略：下一拍再补 */
      }
    }
  }
  /* 拉取分支最新（拿到前面 stage 已推的账），让本次提交基于它、避免互相覆盖。 */
  spawnSync("git", ["fetch", "origin", branch], { cwd: root, encoding: "utf8" });
  const who = gitUser("ci");
  const date = new Date().toISOString().slice(0, 10);
  const addRes = spawnSync("git", ["add", ...allRels], {
    cwd: root,
    encoding: "utf8",
  });
  if (addRes.status !== 0) return { pushed: false, reason: "add-failed" };
  const commitRes = spawnSync(
    "git",
    [
      "-c",
      `user.name=${who}`,
      "-c",
      `user.email=${who}@noreply.ci`,
      "commit",
      "-m",
      `chore(freshness): record ${date} [ci skip]`,
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (commitRes.status !== 0) return { pushed: false, reason: "commit-failed" };
  const pushRes = spawnSync(
    "git",
    ["push", "--force-with-lease", "origin", `HEAD:refs/heads/${branch}`],
    { cwd: root, encoding: "utf8" },
  );
  if (pushRes.status !== 0) return { pushed: false, reason: "push-failed" };
  return { pushed: true };
}
