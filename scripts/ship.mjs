#!/usr/bin/env node
/**
 * ship.mjs — 「从工作树到 `master`」的**编排**入口（规范 §13.6）。
 *
 * ── 为什么要有它 ────────────────────────────────────────────────
 *
 * 本仓的**判定层**已经很全：`pre-commit` 那批形态与静态判据（**默认档跑哪些会随治理线变**，
 * 全套另有 `COMFY_HEAVY_GATES=1` 那一档，见规范 §13.5.25 —— 所以这里不抄组数与步数）、
 * `pre-push` 自动跑
 * `premerge-check.mjs` 并落一份机器证明、平台侧 `质量门禁` 那一趟 build、
 * `base-check.mjs` 复算主干基线。缺的是**把它们按顺序跑完并如实转述**的那一层 ——
 * 它此前由每个执行者临时手写一遍，于是同一件事长出 N 套走法，而每一套都可能
 * 在它自己没想到的地方静默判错。
 *
 * 本脚本的形状照 `premerge-check.mjs` 那一族（同一个作者决定的同一件事）：
 * **合成一条命令，并且不发明第二套编排** —— 所有「绿不绿」的结论都来自既有执行者
 * 的**原值**，脚本一次也不自己判。
 *
 *   | 要做的事            | 谁在做（既有实现，本脚本只调用 / 只读它的产物）              |
 *   | ------------------- | ----------------------------------------------------------- |
 *   | 不在 master 上直提  | `check-branch-guard.cjs`（组 0，由 `git commit` 触发）       |
 *   | 提交门槛            | `.githooks/pre-commit`（由 `git commit` 触发，本脚本不重跑） |
 *   | 合并前固定动作三段  | `.githooks/pre-push` → `premerge-proof.mjs`（由 push 触发）  |
 *   | 「红是我的还是主干」| `base-check.mjs`（本脚本在 CI 红时调它，不自己归因）         |
 *   | 流水线终态          | 平台 build 的 `data.status`（`cnb … -v` 的 JSON）            |
 *   | 合没合上            | PR 的 `is_merged` + **回读解析出的主干基线顶端**            |
 *
 * ── 模块形状（一份 900 行硬闸装不下整条链，而按行数切会把因果切散）──────
 *
 *   · `ship-core.mjs`     —— **判断**：参数、阶段表、三态码的合成、平台 JSON 里
 *     哪一格才是终态。纯函数，不起进程、不读文件之外的事实。
 *   · `ship-exec.mjs`     —— **效应适配**：`cnb` 垫片怎么起、stderr 怎么接、
 *     一次性临时文件落在 git 目录哪儿。只因宿主而变。
 *   · `ship-platform.mjs` —— **平台侧四段**：PR / 轮询 / verdict / 合并并回读。
 *     只经注入的 `run` 摸世界，所以整段可被假执行者跑完。
 *   · 本文件              —— **本地三段 + 装配**：preflight / commit / push，
 *     以及「谁跑了、各段结论是什么」的那一处记账（`codes` + `finish`）。
 *
 * 拆的是**变化方向**：加一个阶段只动本文件与 `ship-platform.mjs`，改 Windows 垫片
 * 只动 `ship-exec.mjs`。对外行为、命令行、退出码、打印原文一字不改。
 *
 * ── 三条写进代码的纪律（不是文档承诺）──────────────────────────
 *
 * 1. **不发明判定。** 终态只认两个原值：build 的 `data.status`、PR 的 `is_merged`。
 *    信封上那个 `status: 200` 是 **HTTP 状态**，与「流水线过没过」毫无关系 ——
 *    把它当结论读，会把一条从没跑起来的 build 报成成功（实测踩过：非 JSON 输出里
 *    两个字段同名，`grep '^status:'` 恒取到 200，于是白轮询几十次）。
 *    所以取数只走 `cnb … -v` 的 **JSON**，且只读 `data.*`。
 * 2. **退出码三态，与 `premerge-check.mjs` / `base-check.mjs` 同口径。**
 *    `0` 走到终态且事实为绿；`1` **有事实是红的**；`2` **有一步没跑起来**
 *    （`cnb` 不在 / 取不到 build / 非 git 检出）。`2` 压过 `1`：
 *    「没拿到测量」与「测量结果是红的」是两件事，混起来就是静默失效。
 * 3. **合并是显式动作。** 默认止于阶段 5（打印下一动作）。要合就 `--merge`。
 *
 * ── 它**不做**什么 ─────────────────────────────────────────────
 *
 *   · **不代写提交信息**。提交信息是判断（症状、读数、因果），不是排版。
 *     树脏而没给 `--message` ⇒ 退 1 并说清为什么停在这里。
 *   · **不 `git add -A`**。暂存面是「这次提交包含什么」的声明，要由调用方给
 *     （`--add <path>` 逐个点名，或你自己先 `git add`）。它会**打印**暂存了什么、
 *     以及还有什么没暂存。
 *   · **不重跑 `premerge-check`**。push 钩子已经跑过并落了证明；重跑是分钟级的
 *     重复付费，且两份结论会开始漂移。这里只**读**那份证明。
 *   · **不生成因果句进提交信息**：`check-commit-claims.mjs` 会把「§x.y 照旧保留」
 *     「`<path>` 一个字没动」「N 处收到 0」三种句式拿提交树复核。所以 PR 正文
 *     只填它**量到的**（diffstat、碎片标题、失败 stage 名），不填推断。
 *   · **不碰 `--force` / 不改历史 / 不删分支**。
 *   · **不替 issue 写内容**。`--close-issue` 只做一件机械事：把落地那一行点名的
 *     单子置 `closed / completed`，然后**独立回读** `state` / `state_reason` /
 *     `closed_at` 三件原值打出来。那条「已落地 + 读数 + 因果」的记录评论是判断，
 *     与提交信息同一档，不由编排层生成 —— 生成出来的那句话必然是一句
 *     「它说它做了」，而这一族存在的意义恰恰是不采信这种话。
 *
 * ── 用法 ───────────────────────────────────────────────────────
 *
 *   pnpm ship                                  # 到「CI 出终态 + 打印下一动作」为止
 *   pnpm ship --message "…"                    # 需要它代为提交时给出提交信息（单行）
 *   pnpm ship --message-file .git/msg.txt      # 多行提交信息走文件 —— `pnpm run` 会把
 *                                              #  argv 里的真换行改写成字面量 \n，多行别从命令行进
 *   pnpm ship --add src/a.ts --add changelog.d/0-x.md --message "…"   # 由它代为暂存（逐个点名，不 -A）
 *   pnpm ship --title "…"                      # 覆盖标题（默认取分支第一笔非常规提交）
 *   pnpm ship --merge                          # 允许在 CI 绿时执行 squash 合并
 *   pnpm ship --merge --close-issue            # 合上之后关掉落地那一行点名的 issue
 *                                              #  （显式才做；只跟在**验真的合并**之后，
 *                                              #   误带在没有合并的那一跳上 ⇒ 退 2 并说明）
 *   pnpm ship --dry-run                        # 只打印将要执行的命令，一条都不执行（阻塞照报）
 *   pnpm ship --only=preflight               # 单跑阶段 0 看读数字段（其余段都排在它后面，
 *                                            #  单跑会落不出任何结论 ⇒ 退 2，见 `finish`）
 *   pnpm ship --no-wait                        # 建完 PR 就停，不轮询 build
 *
 * 阶段名：preflight · commit · push · pull-request · poll · verdict · merge
 */
import fs from "node:fs";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveGitDir } from "./git-dir.mjs";
import {
  CODE,
  combineShipCodes,
  looksNewlineMangled,
  parseArgs,
  parseSlug,
  PHASES,
  planCommands,
  readProof,
  resolveUpstream,
} from "./ship-core.mjs";
import { makeRunner, safeRead, short, writeScratch } from "./ship-exec.mjs";
import {
  closeIssues,
  createOrReusePull,
  mergeAndVerify,
  pollUntilTerminal,
  reportVerdict,
} from "./ship-platform.mjs";

/**
 * 把 `git status --porcelain` 的输出**按列**分成「已暂存 / 未暂存（已修改）/ 未跟踪」三档。
 *
 * ⚠️ 必须按列取状态位，**绝不能先 `trim()`**：porcelain 每行是 `XY <路径>`，前两字符
 * `X`=索引状态、`Y`=工作树状态。先 `trim()` 会把行首空格吃掉，于是未暂存的 ` M file`
 * 塌成 `M file` 被误判成已暂存（ISSUE #2073）—— 那一句读数谎报，还会让
 * 「还有未暂存的改动」提醒永不触发。
 *
 * @param {string} stdout `git status --porcelain` 的原始输出
 * @returns {{staged: string[], unstagedModified: string[], untracked: string[]}}
 */
function parsePorcelain(stdout) {
  /** @type {string[]} */
  const staged = [];
  /** @type {string[]} */
  const unstagedModified = [];
  /** @type {string[]} */
  const untracked = [];
  for (const raw of String(stdout).split("\n")) {
    if (!raw) continue;
    const x = raw[0]; // 索引状态
    const y = raw[1]; // 工作树状态
    if (x === "?") {
      untracked.push(raw.slice(3)); // `?? <path>`
      continue;
    }
    // X 是索引里的真实状态（非空格、非未跟踪、非忽略）⇒ 已暂存。
    if (x !== " " && x !== "!") staged.push(raw.slice(3));
    // Y 是工作树里的真实改动（非空格、非忽略）⇒ 未暂存（已修改）。
    if (y !== " " && y !== "!") unstagedModified.push(raw.slice(3));
  }
  return { staged, unstagedModified, untracked };
}

/**
 * 对外入口：跑一遍编排，**无论走到哪个出口都清掉自己写的临时文件**。
 *
 * 提交信息与 PR 正文都是当场拼出来的原文，留在盘上没有用处 ——
 * 而 `.workbuddy/` 是 gitignored，所以「忘了删」不会进历史、只会一直堆着。
 * 实测前几轮真跑就在 `.workbuddy/` 里留了 3 份提交信息。
 *
 * 清理放在 `finally` 而不是每个调用点后面，是因为**最常见的失败路径本身就是一个
 * 提前 return**（钩子拦下提交时 `return finish(codes)` 就发生在写完临时文件之后）——
 * 「用完顺手删一句」在这种形状下照样漏，而且漏的恰好是没人回头看的那几次。
 *
 * @param {Parameters<typeof runFlow>[0]} [deps] 注入点
 * @returns {Promise<number>} 进程退出码（三态）
 */
export async function main(deps = {}) {
  /** @type {string[]} */
  const tmpFiles = [];
  try {
    return await runFlow(deps, tmpFiles);
  } finally {
    for (const p of tmpFiles) {
      try {
        fs.unlinkSync(p);
      } catch {
        // 已经被删 / 从来没写成：清理尽力而为，不该改变这一次编排的结论。
      }
    }
  }
}

/**
 * 主编排。所有外部效应都从 `deps` 注入，所以它可以被完整单测（见 `tests/ship.test.ts`）。
 *
 * @param {{
 *   root?: string,
 *   run?: (cmd:string,args:string[])=>import("./ship-exec.mjs").ExecResult,
 *   probeCnb?: ()=>boolean,
 *   resolveGitDir?: (cwd?:string)=>string | null,
 *   log?: (s:string)=>void,
 *   sleep?: (ms:number)=>void,
 *   now?: ()=>number,
 *   args?: string[],
 * }} deps 注入点（由 `main` 总是给全，所以这里不标可选 —— 标了会让后面那个
 *    必需参数报 TS1016「required 不能跟在 optional 之后」）
 * @param {string[]} tmpFiles 临时文件回收清单，由 `main` 建并在 `finally` 里清
 * @returns {Promise<number>} 进程退出码（三态）
 */
async function runFlow(deps, tmpFiles) {
  const root = deps.root ?? process.cwd();
  /** git 目录怎么解析：默认那份唯一实现，测试里指到临时目录。 */
  const resolveDir = deps.resolveGitDir ?? resolveGitDir;
  /** 写一份临时文件到 git 目录并**登记待回收**；没有落点时回 null（不往工作区猜）。 */
  const mkTmp = (/** @type {string} */ name, /** @type {string} */ text) => {
    const p = writeScratch(root, name, text, resolveDir);
    if (p) tmpFiles.push(p);
    return p;
  };
  const run = deps.run ?? makeRunner(root);
  /** cnb 在不在：**真起一次** `--version` 看退码。不按「PATH 里有没有那个名字」判 ——
   *  在 Windows 垫片上「找得到」与「起得来」是两件事（见 `ship-exec.mjs` 的 `cnbSpawn`）。 */
  const probeCnb =
    deps.probeCnb ?? (() => run("cnb", ["--version"]).status === 0);
  const log = deps.log ?? ((s) => process.stdout.write(s + "\n"));
  const sleep =
    deps.sleep ?? ((ms) => new Promise((res) => setTimeout(res, ms)));
  const now = deps.now ?? (() => Date.now());
  const opt = parseArgs(deps.args ?? process.argv.slice(2));
  const codes = /** @type {number[]} */ ([]);
  const want = (/** @type {string} */ p) => !opt.only || opt.only === p;
  /** 下面几段共用的远端/基线，在两道守卫之后解析（见 `resolveUpstream` 那一段的注释）。 */
  /** @type {{remote: string | null, base: string | null, source: string}} */
  let up = { remote: null, base: null, source: "none" };
  /** @type {string | null} */
  let baseRef = null;
  /** @type {string | null} */
  let baseBranch = null;
  /**
   * 把一个外部命令的输出**原样**转述出来 —— **含 stderr**。
   * 钩子与 git 都把关键的话写在 stderr，只转 stdout 等于把理由丢掉、
   * 只留一句「失败了」。本工具存在的理由就是别干这事。
   *
   * @param {{stdout:string,stderr?:string}} r 执行结果
   */
  const relay = (r) => {
    if (r.stdout && r.stdout.trim()) log(r.stdout.trimEnd());
    if (r.stderr && r.stderr.trim()) log(r.stderr.trimEnd());
  };

  if (opt.unknown.length > 0) {
    log(`[ship] [ERROR] unknown flag(s): ${opt.unknown.join(" ")}`);
    log(
      "[ship] 拼错的旗标会被读成「没要那个动作」，所以这里直接停。见文件头「用法」。",
    );
    return CODE.NOT_RUN;
  }
  if (opt.only && !PHASES.includes(opt.only)) {
    log(
      `[ship] [ERROR] --only 不认的阶段：${opt.only}（可选：${PHASES.join(" / ")}）`,
    );
    return CODE.NOT_RUN;
  }
  /* poll / verdict / merge 要用「本次跑里解析出来的 PR 号」，而那个号是在
   * pull-request 那一段拿到的 —— 单独 --only=poll 会走进「一段都没跑、
   * 于是没有任何结论」却退 0 的形态。那是假绿灯，正是本工具要防的那一类，
   * 所以显式拒绝，而不是让它安静地成功。 */
  const NEEDS_PR_NUMBER = ["poll", "verdict", "merge"];
  if (opt.only && NEEDS_PR_NUMBER.includes(opt.only)) {
    log(
      `[ship] [ERROR] --only=${opt.only} 不能单独跑：它要用 pull-request 那一段解析出的 PR 号。`,
    );
    log(
      "[ship] 要接着上一次的进度就整段重跑（PR 已存在时会复用，不重建）：pnpm ship",
    );
    return CODE.NOT_RUN;
  }

  /* ── 远端名与主干基线：在两道守卫（未知旗标 / `--only` 单独跑）之后解析一次 ──
   * push / PR 正文 / fetch / 「回读主干顶端」四段都要用它，所以不能等各段各自去推。
   *
   * ⚠️ 「上游 `@{u}`」与「主干基线」**不是同一件事**，这一格错过一次：
   * `git push -u origin feat/x` 把这条分支的上游设成**它在远端的副本**
   * （`origin/feat/x`），于是拿 `@{u}` 当基线就是 `feat/x...HEAD` —— 自己与自己比，
   * 结果恒空，碎片那一查报「0 份 ⇒ 单 PR 单变更不成立」。而撞上它的正是
   * **推送之后的那一次跑**，也就是 `pnpm ship --merge` 那一跳（实测在
   * `pnpm ship --no-wait` 上：exit 1「没有 changelog.d/ 碎片」）。
   * 所以远端名先落地，再取 `refs/remotes/<远端>/HEAD` 那条**本地就有**的符号引用
   * （零网络）当主干；两处都取不到时才退 `<远端>/master` 并标明是推的。
   *
   * 远端名同样是每台克隆自己的事实，不写死（并行检出里见过 `cnb`，本检出实测只有
   * `origin`；见 docs/audits/2026-10-12 R12-01）。推不出远端名时**不在这里**判红：
   * 各阶段拿 `up.remote === null` 自己退 NOT_RUN —— 「取不到远端」与
   * 「这一步跑出来是红的」是两件事（三态退出码那条口径）。 */
  const upRes = run("git", [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{u}",
  ]);
  const remotesRes = run("git", ["remote"]);
  const headRes = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  const localBranch = headRes.stdout.trim();
  /* 第一趟只要「远端叫什么」—— 主干那条符号引用是按远端名去问的，得先知道远端名。 */
  const probe = resolveUpstream({
    upstream: upRes.stdout,
    remotes: remotesRes.stdout.split("\n"),
    localBranch,
  });
  up = resolveUpstream({
    upstream: upRes.stdout,
    remotes: remotesRes.stdout.split("\n"),
    localBranch,
    remoteHead: probe.remote
      ? run("git", [
          "symbolic-ref",
          "--quiet",
          `refs/remotes/${probe.remote}/HEAD`,
        ]).stdout
      : null,
  });
  /* 基线引用要**真的存在**才拿来比：拿不存在的 ref 做 `A...HEAD`，git 失败、stdout 为空，
   * 而这一查的语义是「这条分支带进来了什么」—— 空串会被读成「什么都没带」，
   * 一条听起来完全正当的假结论。所以正面验一次，验不到就往下标成「没有事实源」。 */
  baseRef =
    up.base !== null &&
    run("git", ["rev-parse", "--verify", "--quiet", up.base]).status === 0
      ? up.base
      : null;
  /** 主干**分支名**（PR 的 `--base` 要的是它，不是 `<远端>/<分支>`）。推不出就不给
   *  `master` 兜底 —— 兜一个猜的分支名，报出来的是「PR 建到了不存在的主干上」。 */
  baseBranch = baseRef ? baseRef.split("/").slice(1).join("/") : null;

  // ── 阶段 0：preflight ────────────────────────────────────────
  if (want("preflight")) {
    const head = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
    const branch = head.stdout.trim();
    if (head.status !== 0 || !branch) {
      log(
        "[ship] 取不到 HEAD ⇒ 非 git 检出 / 游离 HEAD，这一格没有结论（不是「通过」）",
      );
      return CODE.NOT_RUN;
    }
    if (branch === "master" || branch === "HEAD") {
      log(
        `[ship] 当前在 \`${branch}\` 上。本仓不许直连主干（硬规则 6）⇒ 先：git checkout -b feat/<描述>`,
      );
      codes.push(CODE.RED);
      return finish(codes);
    }
    const shaRes = run("git", ["rev-parse", "HEAD"]);
    const sha = shaRes.stdout.trim();
    const dirty = run("git", ["status", "--porcelain"]);
    const { staged, unstagedModified, untracked } = parsePorcelain(
      dirty.stdout,
    );
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
    const slugRes = up.remote
      ? run("git", ["remote", "get-url", up.remote])
      : { stdout: "" };
    const slug = parseSlug(slugRes.stdout);
    const cnbOk = probeCnb();

    log(
      `[ship] 分支 ${branch} · sha ${sha.slice(0, 8)} · 仓库 ${slug || "(取不到)"}` +
        ` · 远端 ${up.remote || "(无)"} · 基线 ${baseRef || "(取不到)"}` +
        `（来源 ${up.source}${baseRef === null ? " ⇒ 碎片那一查没有事实源，见下" : ""}）`,
    );
    log(
      `[ship] 暂存 ${staged.length} 项 · 未暂存 ${unstagedModified.length} 项 · 未跟踪 ${untracked.length} 项 · changelog.d 碎片 ${frags.length} 份`,
    );
    if (
      unstagedModified.length + untracked.length > 0 &&
      opt.adds.length === 0
    ) {
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
      return finish(codes);
    }
    if (frags.length === 0) {
      log(
        `[ship] 没有 changelog.d/ 碎片（比的是 ${baseRef}...HEAD 与工作树）` +
          " ⇒ 单 PR 单变更那条不成立（§13.10.5）。先补一份。",
      );
      codes.push(CODE.RED);
      return finish(codes);
    }
    if (!slug) {
      log(
        `[ship] 取不到远端 \`${up.remote ?? "(未解析出远端名)"}\` 的 org/repo` +
          " ⇒ 后面的平台动作没有执行者（不是「不需要」）",
      );
      codes.push(CODE.NOT_RUN);
      return finish(codes);
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
        remote: up.remote,
        baseBranch,
      })) {
        log(`        $ ${c}`);
      }
      return CODE.GREEN;
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
      return finish(codes);
    }
    codes.push(CODE.GREEN);

    // ── 阶段 1：commit ─────────────────────────────────────────
    if (want("commit")) {
      const msg = opt.messageFile
        ? safeRead(root, opt.messageFile)
        : opt.message;
      if (staged.length + unstagedModified.length + untracked.length > 0) {
        if (!msg) {
          log(
            "[ship] 有改动但没给 --message ⇒ 停。提交信息是判断（症状/读数/因果），脚本不代写。",
          );
          codes.push(CODE.RED);
          return finish(codes);
        }
        /* 排在 `git add` **之前**：既然这条信息不能原样进历史，就不要先把暂存面改了
         * 再退回去 —— 那一手会让「这次提交包含什么」被一次不会发生的提交动过。 */
        if (looksNewlineMangled(msg)) {
          log(
            "[ship] `--message` 里没有真换行、却带着字面量 \\n ⇒ 这条信息已被 `pnpm run` 压成一行。",
          );
          log(
            "[ship] 按原样提交只会得到一整行 subject，而 PR 标题取的就是它（实测那样一份被平台拒）。",
          );
          log(
            "[ship] 两条出口：`pnpm ship --message-file <路径>`（多行信息的正路），" +
              '或 `pnpm exec node scripts/ship.mjs --message "…"`（`pnpm exec` 保留真换行）。',
          );
          codes.push(CODE.RED);
          return finish(codes);
        }
        for (const a of opt.adds) run("git", ["add", "--", a]);
        /* 提交信息走 argv 直传，**不落文件**：`spawnSync` 这一跳不经 shell，git 拿到的
         * 就是数组里那一串字面量（引号、多行都不再被解释），没有 `-F` 那一套「写个临时
         * 文件、提交完还得删干净」的泄漏面（AGENTS 硬规则 12 把 `COMMIT_EDITMSG` 落进
         * 工作区点名为「提交完忘了删」的信号 —— 少建一个文件，就少一处会忘的地方）。
         * ⚠️ 「多行不会被破坏」只保证**这一跳**：更外层的 `pnpm run` 已经把 argv 里的
         * 真换行改写成字面量 `\n` 了，那一格由上面 `looksNewlineMangled` 拦下。 */
        const cm = run("git", ["commit", `--message=${msg}`]);
        relay(cm);
        if (cm.status !== 0) {
          log(
            `[ship] 提交被门槛拦下（exit ${cm.status}）。钩子的原话在上面，**不要**用 --no-verify 换一条干净历史。`,
          );
          codes.push(CODE.RED);
          return finish(codes);
        }
        log("[ship] ✓ 已提交（门槛全过）");
      } else {
        log("[ship] 工作树干净 ⇒ 跳过提交这一段。");
      }
      codes.push(CODE.GREEN);
    }

    // ── 阶段 2：push（合并前固定动作由 pre-push 钩子自己跑）────
    if (want("push")) {
      if (!up.remote) {
        log(
          "[ship] 推不出远端名（既没有上游、也不是「唯一远端」）⇒ push 没有执行者，" +
            "这一格不是「通过」（三态退出码：这是 NOT_RUN）。",
        );
        codes.push(CODE.NOT_RUN);
        return finish(codes);
      }
      const ps = run("git", ["push", "-u", up.remote, branch]);
      relay(ps);
      if (ps.status !== 0) {
        log(
          `[ship] push 失败（exit ${ps.status}）⇒ 多半是 pre-push 的合并前复算没放行。`,
        );
        codes.push(CODE.RED);
        return finish(codes);
      }
      /* 证明的读取也走这一次注入的解析器 —— 少了这个参数，注入只覆盖临时文件那一半，
       * 而这一格会去读这台机器真实的 `.git`（用例本地绿、节点红就是这么来的）。 */
      const proof = readProof(root, resolveDir);
      if (proof) {
        log(
          `[ship] ✓ 合并前证明：head ${short(proof.headSha)} · 上游 ${short(proof.upstreamSha)} · ${proof.verifiedAt || "?"}`,
        );
        if (Array.isArray(proof.baselineRed) && proof.baselineRed.length > 0) {
          log(
            `[ship]   其中 ${proof.baselineRed.length} 条是主干自带的红（已放行，见 §13.6.2）`,
          );
        }
      } else {
        log(
          "[ship] 没读到合并前证明（HEAD 与上游都没动，或钩子未接上）⇒ 这一格**没有**结论。",
        );
        codes.push(CODE.NOT_RUN);
      }
      codes.push(CODE.GREEN);
    }

    // ── 阶段 3-6：平台侧（需要 cnb，实现见 `ship-platform.mjs`）──
    if (!cnbOk) {
      codes.push(CODE.NOT_RUN);
      return finish(codes);
    }
    const newSha = run("git", ["rev-parse", "HEAD"]).stdout.trim();

    if (want("pull-request")) {
      const { number } = createOrReusePull({
        run,
        log,
        mkTmp,
        root,
        slug,
        branch,
        frags,
        baseRef,
        baseBranch,
        explicitTitle: opt.title,
      });
      if (!number) {
        codes.push(CODE.NOT_RUN);
        return finish(codes);
      }
      codes.push(CODE.GREEN);

      // ── 阶段 4：poll ─────────────────────────────────────────
      if (!(want("poll") && opt.wait)) {
        log("[ship] 跳过轮询（--no-wait / --only）⇒ 不合并。");
        codes.push(CODE.GREEN);
        return finish(codes);
      }
      const poll = await pollUntilTerminal({
        run,
        log,
        slug,
        newSha,
        now,
        sleep,
      });
      if (poll.stop !== null) {
        codes.push(poll.stop);
        return finish(codes);
      }
      const { buildState, buildSn } = poll;

      // ── 阶段 5：verdict ──────────────────────────────────────
      if (want("verdict")) {
        codes.push(
          reportVerdict({ run, log, slug, number, buildState, buildSn }),
        );
      }

      // ── 阶段 6：merge（显式）─────────────────────────────────
      /* `landed` 是「落进主干的那一行」的快照，由阶段 6 在**验真之后**填；
       * 阶段 7 要从它的标题本体里取 issue 号 —— 不在那里回推，因为合并那一步
       * 会把 HEAD 挪到 master，`pickTitle` 那时已经算不出这条分支的第一笔。 */
      const landed = { title: "", sha: "", verified: false };
      if (want("merge")) {
        codes.push(
          mergeAndVerify({
            run,
            log,
            slug,
            number,
            frags,
            baseRef,
            up,
            merge: opt.merge,
            buildState,
            explicitTitle: opt.title,
            landed,
          }),
        );
      }

      // ── 阶段 7：关单（显式，且只跟在验真的合并之后）────────────
      /* 这一格**只在人点名时出现**（`--close-issue`）：关一张单子是把状态写到
       * 别人也看得见、且不会自动回退的地方，与合并本身同一档，所以同一个口径 ——
       * 默认不开。没合并成而带着它跑，落的是 2 并说明（不是静默跳过、更不是绿）。 */
      if (opt.closeIssue) {
        codes.push(closeIssues({ run, log, slug, closeIssue: true, landed }));
      }
    }
  }

  return finish(codes);

  /**
   * @param {number[]} cs 各段结论
   * @returns {number} 合并后的退出码
   */
  function finish(cs) {
    /* 一条结论都没有 ≠ 「都跑了且是绿的」。这一格错过一次：`--only=commit` /
     * `--only=push` / `--only=pull-request` 会把阶段 0 整段跳过（后面每一段都嵌在
     * `want("preflight")` 里面），于是 `cs` 是空数组，而 `combineShipCodes([])`
     * 回 `0` —— 屏幕上落出「全绿到终态」，实际**一段都没跑**。三态口径里那第三条
     * 「没跑起来 ⇒ 2」本来就是给这种形状准备的，只是空数组此前没人接。
     * 空账这一格按 `NOT_RUN` 而不是按「请求过的阶段列表」判：将来再加段、或有人
     * 把某段改成条件跳过，都掉不进同一个假绿灯。 */
    if (cs.length === 0) {
      log(
        `[ship] 本次没有任何一段落下结论${opt.only ? `（--only=${opt.only} 用不上：阶段 0 之外的每一段都排在它后面）` : ""}` +
          " ⇒ 记「没跑起来」（exit 2），**不是**「通过」。",
      );
      return CODE.NOT_RUN;
    }
    const code = combineShipCodes(cs);
    const word =
      code === CODE.GREEN
        ? "全绿到终态"
        : code === CODE.RED
          ? "有事实是红的"
          : "有一步没跑起来（**不等于**通过）";
    log(`[ship] 结论：exit ${code} —— ${word}`);
    return code;
  }
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().then((code) => process.exit(code));
}
