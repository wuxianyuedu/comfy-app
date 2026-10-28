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
  if (res.error || res.status !== 0 || typeof res.stdout !== "string")
    return null;
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
 * 把一次 git 调用的两条流收成**一行**读数。
 *
 * 为什么必须有这一件（ISSUE #2344）：回写失败那三个出口过去只念一个词
 * （`add-failed` / `commit-failed` / `push-failed`），git 的 stderr 一个字都没转发 ——
 * 于是「commit 为什么失败」这件事在那一跑的日志里**不存在**，下一次撞上还得从头查。
 * 这是硬规则 27 那句「效应不许只转述自己的 stdout（丢 stderr 是这一族最重的事故）」
 * 在同一段代码上的第二次发生。
 *
 * @param {{stdout?: string, stderr?: string} | null} res
 * @returns {string}
 */
function gitTail(res) {
  const text = `${res?.stderr ?? ""}${res?.stdout ?? ""}`
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" / ");
  /* 只留尾部：git 的结论在最后一行，而钩子失败时前面是一整屏逐步骤输出 ——
   * 这一句要进「回写未执行」那一行，不许把整段日志顶进那格。 */
  return text === "" ? "(git 没给出任何输出)" : text.slice(-400);
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
 * ⚠️ **失败之前先把 `git add` 撤回去**（ISSUE #2344）：`add` 成功而 `commit` 失败时，
 * 索引里留着的就是那两份**入库的**账本文件，而同一跑后面每一格「按暂存区判」的判据
 * （`--staged` 那一族）读的都是这个面 —— 一次不成功的回写污染的是**整跑**的输入，
 * 账面却只红一条用例。撤回本身失败也要念出来：那说明索引仍然是脏的。
 *
 * @param {{root: string, kinds: string[], run?: (args: string[]) => {status: number | null, stdout?: string, stderr?: string, error?: unknown}}} args
 *        `run` 是 git 的执行者（默认 `spawnSync("git", …)` 于 `root`）—— 注入它是为了让
 *        「commit 被钩子拒掉」这一支有执行者，而不是要人再造一次现场（同 `runGate` 的取舍）。
 * @returns {{pushed: boolean, reason?: string}}
 */
export function pushFreshnessLedger({ root, kinds, run }) {
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
  /* ⚠️ 主体=master 之外还要**事件是每日那一类**：单跑口（`api_trigger_build` /
   * `web_trigger_*`）跑的是**当前分支**的代码，它跑绿写的是那条分支的账 ——
   * 回写进机器分支等于让那条分支的记录替主干作证（那正是「机器账权威」要防的
   * 倒过来形态）。每日三条触发口（定时 / 手点 / API）才回写。
   * ⚠️ 事件名**按前缀/整串**认，与 `scripts/check-daily-attendance.mjs` 的
   * `isDailyDispatch()` 同一口径（换时刻不打红它）。 */
  const event = String(process.env.CNB_EVENT ?? "");
  const dailyEvent =
    event.startsWith("crontab:") ||
    event === "web_trigger_daily" ||
    event === "api_trigger_daily";
  if (contextSubject() !== "master" || !dailyEvent) {
    return { pushed: false, reason: "not-master-subject" };
  }
  const branch = process.env.FRESHNESS_LEDGER_BRANCH || FRESHNESS_LEDGER_BRANCH;
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
  const git =
    run ?? ((args) => spawnSync("git", args, { cwd: root, encoding: "utf8" }));
  /* 「撤回」只在这之后有意义：`add` 一旦成功，索引里就留下了这两三份账本，
   * 而失败的那一步把整跑后面所有格的输入面换成了它们（ISSUE #2344）。 */
  const unstage = () => {
    const res = git(["reset", "-q", "--", ...allRels]);
    if (res && res.status === 0) return "";
    return (
      "；⚠ 撤回暂存也失败了 ⇒ **索引仍然是脏的**，同一跑后面按暂存区判的那几条" +
      `读的是这一格留下的面（撤回的 git 原文：${gitTail(res)}）`
    );
  };
  git(["fetch", "origin", branch]);
  const who = gitUser("ci");
  const date = new Date().toISOString().slice(0, 10);
  const addRes = git(["add", ...allRels]);
  if (addRes.status !== 0) {
    return {
      pushed: false,
      reason: `add-failed —— git 原文：${gitTail(addRes)}${unstage()}`,
    };
  }
  const commitRes = git([
    "-c",
    `user.name=${who}`,
    "-c",
    `user.email=${who}@noreply.ci`,
    "commit",
    "-m",
    `chore(freshness): record ${date} [ci skip]`,
  ]);
  if (commitRes.status !== 0) {
    /* 这一支是 #2344 的当事形态：`add` 已经做完、`commit` 被拒（钩子、身份、
     * 「没有东西可提交」都算），过去到这里就**直接返回**，把 add 留下的暂存区不清回去。 */
    return {
      pushed: false,
      reason: `commit-failed —— git 原文：${gitTail(commitRes)}${unstage()}`,
    };
  }
  const pushRes = git([
    "push",
    "--force-with-lease",
    "origin",
    `HEAD:refs/heads/${branch}`,
  ]);
  if (pushRes.status !== 0) {
    /* 提交已经落地 ⇒ 索引是干净的，这里**不许**再撤回（撤了就把已经成功的提交
     * 的改动重新 stage 成「待提交」，那是第二次错）。原因照旧要带原文。 */
    return {
      pushed: false,
      reason: `push-failed —— git 原文：${gitTail(pushRes)}`,
    };
  }
  return { pushed: true };
}
