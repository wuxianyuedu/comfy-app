#!/usr/bin/env node
/**
 * ship-preflight.mjs —— `pnpm ship` 的**阶段 0**：本检出的读数与本地门（规范 §13.6 / §13.5.25 / §13.10.9）。
 *
 * 为什么单独一件：这一格判的全是**本检出自己的事实**（在不在分支上、带进来哪些碎片、
 * 依赖新鲜度、本机实例在不在跑），与 `ship-platform.mjs` 那四段正相反 —— 后者只经
 * `run` 摸平台、不读本检出的形状；而把它留在 `ship.mjs` 里时，装配层被这一段的
 * 200 多行推过了 `check-infra-file-size.cjs` 的 900 硬闸（#2189 之后第二次撞上）。
 * 拆法照旧按职责、不按行数。
 *
 * ── 这一格的四条纪律 ──────────────────────────────────────────
 *
 * 1. **读数不参与退码**：碎片挂在哪张单上（`ticketReading`）、提单人 / 优先级
 *    （`issueAuthoring`）、本机实例在不在跑（`logInstanceReading`）都只念一行，
 *    一次也不改结论。做成硬闸的后果是「为了让读数好看随手填一个值」——
 *    那比没有读数更坏（§13.10.8 / ISSUE #2175）。
 * 2. **判断在 `ship-core.mjs`**：建分支那一步的四态由 `decideCreateBranch` 给，
 *    这里只发 `git checkout -b` 那一跳；碎片取数面与 `planCommands` 同一形。
 * 3. **取不到事实源就落 2**：基线不存在、slug 取不到 ⇒ 不是「通过」也不是「红」。
 * 4. **dry-run 只念计划、不动 ref**：一处例外是 `--branch` 的建分支 —— 预览里只把它
 *    写成第一跳，`branch` 的读数换成计划中的名字，但 `git checkout` 一次都不发。
 *
 * 返回值是**判别式**（`action`），因为这一段的出口比其余段多：有的直接给码、
 * 有的要把累积的 `codes` 交给 `finish` 收口、dry-run 又走自己那一条。把
 * 「哪个出口怎么收尾」留在装配层，本文件一次也不打印「结论」。
 */
import process from "node:process";

import { CODE, decideCreateBranch, planCommands } from "./ship-core.mjs";
import { issueAuthoring, ticketReading } from "./ship-ticket.mjs";
import { logInstanceReading } from "./ship-reap.mjs";
import { parsePorcelain } from "./ship-local.mjs";

/**
 * 跑阶段 0。
 *
 * @param {{
 *   run: (cmd:string,args:string[])=>import("./ship-exec.mjs").ExecResult,
 *   log: (s:string)=>void,
 *   relay: (r:{stdout:string,stderr?:string})=>void,
 *   opt: any,
 *   root: string,
 *   up: {remote:string|null, base:string|null, source:string},
 *   baseRef: string|null,
 *   baseBranch: string|null,
 *   slug: string|null,
 *   cnbOk: boolean,
 *   handle: string|null,
 *   readInstances: (root:string)=>Promise<{running?:boolean, pids?:number[], via?:string|null}>,
 *   platform?: string,
 * }} ctx
 * @returns {Promise<
 *   | {action:"stop", codes:number[], code:number}
 *   | {action:"finish", codes:number[]}
 *   | {action:"dry-run", codes:number[]}
 *   | {action:"continue", codes:number[], branch:string, sha:string, frags:string[],
 *      staged:string[], unstagedModified:string[], untracked:string[]}
 * >}
 *   `stop` = 原样返回那个码（不打印「结论」，与本段此前那几处提前 return 同形）；
 *   `finish` = 把 `codes` 交给装配层的 `finish`；`dry-run` = 装配层直接退 `GREEN`。
 */
export async function runPreflightStage(ctx) {
  const {
    run,
    log,
    relay,
    opt,
    root,
    up,
    baseRef,
    baseBranch,
    slug,
    cnbOk,
    handle,
    readInstances,
    platform = process.platform,
  } = ctx;
  /** 本段累积的结论（与装配层同一个口径：只追加，由调用方合并）。 */
  const codes = /** @type {number[]} */ ([]);

  const head = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  let branch = head.stdout.trim();
  if (head.status !== 0 || !branch) {
    log(
      "[ship] 取不到 HEAD ⇒ 非 git 检出 / 游离 HEAD，这一格没有结论（不是「通过」）",
    );
    return { action: "stop", codes, code: CODE.NOT_RUN };
  }
  /* ── 建分支那一格（`--branch`，显式才动 ref）──────────────────
   * 这一格原本只会打印一句「先 git checkout -b feat/<描述>」然后退 1 —— 于是脚本在
   * 「人还没有分支」的时刻是旁观者：第一次跑的屏幕输出全部作废，人得先离开这条链
   * 手动建完再回来跑第二遍。名字仍然只由人给（判断不在这里），脚本只补「动 ref」
   * 那半件机械事；四态的判断在 `decideCreateBranch`。 */
  const wantName = (opt.branch || "").trim();
  const cb = decideCreateBranch({
    requested: wantName || null,
    current: branch,
    existsLocal: wantName
      ? run("git", [
          "show-ref",
          "--verify",
          "--quiet",
          `refs/heads/${wantName}`,
        ]).status === 0
      : false,
    existsRemote: wantName
      ? run("git", [
          "show-ref",
          "--verify",
          "--quiet",
          `refs/remotes/${up.remote || "origin"}/${wantName}`,
        ]).status === 0
      : false,
  });
  if (cb.requested) {
    if (cb.act) {
      if (opt.dryRun) {
        log(
          `[ship] --dry-run：不建分支。计划里第一跳是 git checkout -b ${cb.branch}；` +
            `下面几行的读数仍取自当前 HEAD（${branch}）—— 预览不替人动 ref。`,
        );
        branch = cb.branch;
      } else {
        const co = run("git", ["checkout", "-b", cb.branch]);
        relay(co);
        if (co.status !== 0) {
          log(
            `[ship] 建分支没成（exit ${co.status}）⇒ 停：后面每一跳的分支名都取自它，` +
              "这一格没有结论，不拿一次失败的 checkout 冒充「已经在分支上」。",
          );
          codes.push(CODE.RED);
          return { action: "finish", codes };
        }
        log(
          `[ship] ✓ 已建并切到分支 ${cb.branch}（未提交的改动照带）。` +
            "本地 `master` 上若还留着误提交，本脚本**不动**它——`git reset --hard` 是" +
            "破坏性动作，AGENTS 硬规则 6 那三步由人执行。",
        );
        branch = cb.branch;
      }
      codes.push(CODE.GREEN);
    } else if (cb.code === CODE.RED || cb.code === CODE.NOT_RUN) {
      log(`[ship] ${cb.reason}`);
      codes.push(cb.code);
      return { action: "finish", codes };
    } else {
      log(`[ship] ${cb.reason}`);
      codes.push(CODE.GREEN);
    }
  }
  if (branch === "master" || branch === "HEAD") {
    log(
      `[ship] 当前在 \`${branch}\` 上。本仓不许直连主干（硬规则 6）⇒ 先：git checkout -b feat/<描述>`,
    );
    codes.push(CODE.RED);
    return { action: "finish", codes };
  }
  const shaRes = run("git", ["rev-parse", "HEAD"]);
  const sha = shaRes.stdout.trim();
  const dirty = run("git", ["status", "--porcelain"]);
  const { staged, unstagedModified, untracked } = parsePorcelain(dirty.stdout);
  /* 「单 PR 单变更」数的是**这条分支相对上游带进来的**碎片。这一格错过两次，
   * 两次都是「挑了最省事的那个取数面」：
   *   ① `git ls-files changelog.d` → 数出 **118 份**（整个目录的存量）⇒ 恒真，
   *      那条守卫等于没有，而它看起来像在判什么，比不判更糟；
   *   ② 改成只看工作树 → 第一次跑把碎片提交掉之后，工作树干净 ⇒ **恒假**，
   *      于是 `pnpm ship --merge`（同一条分支上的第二次跑）在 preflight 就被拒。
   * 正确的面是**两者取并**：分支相对上游基线已提交的 + 还没提交的。
   * 「同一条分支上重跑要还能过」这一向是 ② 的修法自己带出来的，见用例。 */
  const branchFragRes = baseRef
    ? run("git", [
        "diff",
        "--name-only",
        `${baseRef}...HEAD`,
        "--",
        "changelog.d",
      ])
    : { stdout: "" };
  const workFragRes = run("git", [
    "status",
    "--porcelain",
    "--",
    "changelog.d",
  ]);
  const frags = [
    ...new Set([
      ...branchFragRes.stdout
        .split("\n")
        .map((s) => s.trim())
        .filter((p) => p.endsWith(".md")),
      ...workFragRes.stdout
        .split("\n")
        .map((l) => l.slice(2).trim()) // `XY <path>`：前两列是状态位
        .filter((p) => p.endsWith(".md")),
    ]),
  ];

  log(
    `[ship] 分支 ${branch} · sha ${sha.slice(0, 8)} · 仓库 ${slug || "(取不到)"}` +
      ` · 远端 ${up.remote || "(无)"} · 基线 ${baseRef || "(取不到)"}` +
      `（来源 ${up.source}${baseRef === null ? " ⇒ 碎片那一查没有事实源，见下" : ""}）`,
  );
  log(
    `[ship] 暂存 ${staged.length} 项 · 未暂存 ${unstagedModified.length} 项 · 未跟踪 ${untracked.length} 项 · changelog.d 碎片 ${frags.length} 份`,
  );
  /* 「这次变更挂在哪张单子上」在这一格念出来 —— 它是**读数**，不参与退码。
   * 放在这里而不是别处的理由：这是整条链上唯一一处「碎片文件名 + 首行段落」都还在手边、
   * 而写动作一个都没发生的时刻。此前的读数时机只有最危险那一格（`--close-issue` 在
   * **合并已发生之后**才发现标题里没有号），那等于让「没立案」一路走到主干。 */
  const ticket =
    frags.length > 0 ? ticketReading({ root, fragments: frags }) : null;
  if (ticket) {
    for (const l of ticket.lines) {
      log(l);
    }
  }
  /* 单子的另外两格：谁提的、按什么优先级 —— 同样是读数，不参与退码（ISSUE #2175）。
   * 「提单人」这一格平台给不了：issue 是被 token 的账号本体创建的，多份并行检出回读到的
   * `author` 逐字相同（实测），而提交那一侧的通道（git author 子地址）在单子上不存在
   * —— 见 `docs/guides/git-identity.md` §4。留痕因此只能写在单子上。
   * 出口那两句只在「缺单」或「没配留痕」时念：都在场时不必每次刷屏。 */
  for (const l of issueAuthoring({
    handle,
    platform,
    root,
    showExits: !handle || (ticket?.anonymousFixed.length ?? 0) > 0,
  }).lines) {
    log(l);
  }
  /* 本检出的应用服务此刻在不在跑 —— 一格**读数**，不参与退码。放在这里是理由：这是
   * 整条链上唯一一处「还没动手、而机器的状态可以顺手交代」的时刻。真收在 `--reap`
   * （见 `ship.mjs` 的 `main`），两半共用同一条归属判据；读不出来就念「读不出来」，不圆成「无」。 */
  try {
    logInstanceReading(log, await readInstances(root));
  } catch (e) {
    log(
      `[ship] 本检出应用实例：读不出来（${e instanceof Error ? e.message : String(e)}）` +
        " ⇒ 这一格不构成结论，也不参与退码",
    );
  }
  if (unstagedModified.length + untracked.length > 0 && opt.adds.length === 0) {
    log(
      "[ship] 还有未暂存的改动，而本次没给 --add ⇒ 暂存面由你负责，脚本不替你 `git add -A`。",
    );
  }
  if (baseRef === null) {
    log(
      `[ship] 取不到可比的上游基线（上游 ${up.base ?? "(无)"} 不存在或这条分支还没有上游）` +
        " ⇒ 「分支带进来了哪些碎片」这一格**没有事实源**。这不是「没有碎片」，" +
        "也不是「通过」：先 `git fetch` 或给这条分支设上游（`git branch -u <远端>/master`）。\n",
    );
    codes.push(CODE.NOT_RUN);
    return { action: "finish", codes };
  }
  if (frags.length === 0) {
    log(
      `[ship] 没有 changelog.d/ 碎片（比的是 ${baseRef}...HEAD 与工作树）` +
        " ⇒ 单 PR 单变更那条不成立（§13.10.5）。先补一份。",
    );
    codes.push(CODE.RED);
    return { action: "finish", codes };
  }
  if (!slug) {
    log(
      `[ship] 取不到远端 \`${up.remote ?? "(未解析出远端名)"}\` 的 org/repo` +
        " ⇒ 后面的平台动作没有执行者（不是「不需要」）",
    );
    codes.push(CODE.NOT_RUN);
    return { action: "finish", codes };
  }

  if (opt.dryRun) {
    log("[ship] --dry-run：下面是将要执行的命令，**一条都没跑**：");
    for (const c of planCommands({
      branch,
      sha,
      slug,
      adds: opt.adds,
      hasMessage: Boolean(opt.message || opt.messageFile),
      merge: opt.merge,
      closeIssue: opt.closeIssue,
      cleanBranch: opt.cleanBranch,
      createBranch: cb.act ? cb.branch : null,
      remote: up.remote,
      baseBranch,
      handle: handle || null,
    })) {
      log(`        $ ${c}`);
    }
    return { action: "dry-run", codes };
  }
  if (!cnbOk) {
    log(
      "[ship] 这台机器上没有可用的 cnb ⇒ 平台侧那几段（PR / 轮询 / 合并）没有执行者。",
    );
    log(
      "[ship] 本地两段照跑；跑完请自己开 PR。这一格记「没跑起来」，不记「已完成」。",
    );
  }

  const fresh = run("node", ["scripts/check-deps-freshness.mjs"]);
  if (fresh.status !== 0) {
    log(
      "[ship] 依赖新鲜度红了（硬规则 25）⇒ 先 `git pull` + `pnpm install` 再回来。",
    );
    codes.push(CODE.RED);
    return { action: "finish", codes };
  }
  codes.push(CODE.GREEN);

  return {
    action: "continue",
    codes,
    branch,
    sha,
    frags,
    /* 工作树三列状态由本段读一次、交给 commit 那一段用：同一轮里读两次会让
     * 「该暂存什么」与「刚才念的读数」出现两个答案。 */
    staged,
    unstagedModified,
    untracked,
  };
}
