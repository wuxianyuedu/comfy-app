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
 *   | 本检出有没有实例在跑 | `launcher-core/port-reap.mjs` 的 `runningAppInstances()`（硬规则 9）|
 *   | 真要把那批进程收掉   | `scripts/reap-process.mjs` → `kill-process-tree`（硬规则 3，整棵树）  |
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
 *   · `ship-reap.mjs`     —— **进程那一格**：本检出的归属读数与 `--reap` 的收尾回收。
 *     两半都不自己判 —— 归属只问 `launcher-core/port-reap.mjs` 的 `runningAppInstances()`
 *     （硬规则 9 唯一实现），回收只发 `scripts/reap-process.mjs`（硬规则 3 唯一入口）。
 *   · `ship-ticket.mjs`   —— **单子那一格**：碎片挂在哪个号上、谁提的、按什么优先级。
 *     与「外部执行者的形状」不同的变化方向，所以不在 `ship-core`（叠一起已越过 900 行硬闸）。
 *   · `ship-local.mjs`    —— **本地两段**：commit 与 push（含工作树三列状态的读法）。
 *     不碰 cnb、不需要平台回读，动的是本地 ref 与远端同名分支 —— 与 `ship-platform` 那四段
 *     正相反。（搬出去的直接原因是 #2189：加上「只补关」那格之后本文件 928 行，
 *     被 `check-infra-file-size.cjs` 的 900 硬闸拦下 —— 那一闸说的是「出口只有一个：拆」，
 *     拆法按职责、不按行数，见该模块文件头。）
 *   · `ship-close.mjs`    —— **关单那一格**：要不要关、关哪几张、凭什么关（本轮验真合并 /
 *     平台侧落地证明），以及关完的独立回读。它跟着「单子的落地证明口径」动，不跟 build 状态机走；
 *     叠进 `ship-core` 会把它推过 900 行（#2199 现场量的 917 行）。
 *   · 本文件              —— **装配 + preflight**：阶段顺序、读数的落点，
 *     以及「谁跑了、各段结论是什么」的那一处记账（`codes` + `finish`）；
 *     收尾回收挂在 `main` 的唯一出口上（一轮可以从七八个出口结束，见那里）。
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
 *   · **不替 issue 写内容**。`--close-issue` 只做一件机械事：把点名的单子置
 *     `closed / completed`，然后**独立回读** `state` / `state_reason` /
 *     `closed_at` 三件原值打出来。号有两种来源（本轮落地那一行的标题本体 / 人在命令行
 *     上点名），但「凭什么关」只有一条线：没有落地证明就不关（`ship-close.mjs` 那段）。
 *     那条「已落地 + 读数 + 因果」的记录评论是判断，
 *     与提交信息同一档，不由编排层生成 —— 生成出来的那句话必然是一句
 *     「它说它做了」，而这一族存在的意义恰恰是不采信这种话。
 *   · **不默认杀进程。** 本检出的实例在不在跑，阶段 0 每轮都念一行（归属取自硬规则 9 那条
 *     判据，是**读数**、不参与退码）；要收得点名 `--reap`，而且**只收 `via:"port"` 那批**——
 *     `via:"session"` 是「编排器还活着」，那不是残留，停它要走编排器自己的收尾路径。
 *     既不泛匹配 `node.exe` 也不按端口反查（硬规则 3：各写一遍正是历史上误杀与留孤儿的根因）。
 *   · **不替你立案，也不替你凑一个号**。阶段 0 会把「这次带来的碎片各挂在哪个号上」
 *     念出来，其中段落是 `## Fixed` 而号是 `0` 的那几份额外点一句「先立案再改」
 *     （规范 §13.10.9）—— 那是**读数**，一次也不参与退码。做成硬闸的必然后果是随手
 *     挂一张别人开着的单子，而 §13.10.8 记的就是那次事故（挂错号比不挂更贵，
 *     且号只是个字符串、没有判据会红）。
 *   · **不造分支名，也不批量清分支**。`--branch` 只补「动 ref」那半件机械事，名字由人给
 *     （`feat/…`、`fix/<issue号>-…` 是本仓习惯，不是脚本能推的事实 —— 猜错会让这条变更
 *     顶着另一个身份进评审与后续引用）；`--clean-branch` 只删**这一次跑的那条**分支，
 *     「把所有已合并分支一次收掉」需要另一套判据（squash 形态下 `git branch -d` 的祖先
 *     判据恒假），那不在本脚本的动作面里。也不碰 `git reset --hard`：本地 `master` 上
 *     若有误提交，AGENTS 硬规则 6 那三步是给人执行的。
 *
 * ── 用法 ───────────────────────────────────────────────────────
 *
 *   pnpm ship                                  # 到「CI 出终态 + 打印下一动作」为止
 *   pnpm ship --message "…"                    # 需要它代为提交时给出提交信息（单行）
 *   pnpm ship --message-file .git/msg.txt      # 多行提交信息走文件 —— `pnpm run` 会把
 *                                              #  argv 里的真换行改写成字面量 \n，多行别从命令行进
 *   pnpm ship --add src/a.ts --add changelog.d/0-x.md --message "…"   # 由它代为暂存（逐个点名，不 -A）
 *   pnpm ship --title "…"                      # 覆盖标题（默认取分支第一笔非常规提交）
 *   pnpm ship --branch feat/x                  # 当前没有可用分支时先把分支建出来再往下走
 *                                              #  （名字只能人给：脚本不从 issue 号/标题里造）
 *   pnpm ship --merge                          # 允许在 CI 绿时执行 squash 合并
 *   pnpm ship --merge --close-issue            # 合上之后关掉落地那一行点名的 issue
 *                                              #  （显式才做；只跟在**验真的合并**之后，
 *                                              #   误带在没有合并的那一跳上 ⇒ 退 2 并说明）
 *   pnpm ship --close-issue 2179               # 只补关：人点名的号**不要求本轮合并**，
 *                                              #  前提换成「平台查得到它随某条已合并 PR 落地」
 *                                              #  （查不到 ⇒ 退 2；「查不到」不等于「没落地」）
 *   pnpm ship --merge --close-issue 2179       # 本轮号（标题里那批）+ 人点名的号，并集去重
 *   pnpm ship --merge --clean-branch           # 合上之后删掉**这次那一条**分支（远端 + 本地）
 *   pnpm ship --reap                           # 这一轮结束时收掉本检出**端口上那批**残留进程
 *                                              #  （阶段 0 每轮都念一行归属读数；`via:"session"`
 *                                              #   那一档不归这里收，见 `ship-reap.mjs`）
 *                                              #  （同样是显式动作；两边各自独立回读，
 *                                              #   回读没跑起来落 2 而不是「已删」；不批量清）
 *   pnpm ship --dry-run                        # 只打印将要执行的命令，一条都不执行（阻塞照报）
 *   pnpm ship --only=preflight               # 单跑阶段 0 看读数字段（其余段都排在它后面，
 *                                            #  单跑会落不出任何结论 ⇒ 退 2，见 `finish`）
 *   pnpm ship --no-wait                        # 建完 PR 就停，不轮询 build
 *
 * 阶段名：preflight · commit · push · pull-request · poll · verdict · merge · close-issue · clean-branch
 * （`close-issue` 带号时能单跑 —— 那是「补关」那一路，要平台侧的落地证明；不带号或
 * `clean-branch` 不能单跑：它们要的是合并那一段的验真结果。）
 */
import fs from "node:fs";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveGitDir } from "./git-dir.mjs";
import {
  CODE,
  combineShipCodes,
  decideCreateBranch,
  parseArgs,
  parseSlug,
  PHASES,
  planCommands,
  resolveUpstream,
} from "./ship-core.mjs";
import { makeRunner, writeScratch } from "./ship-exec.mjs";
import {
  issueAuthoring,
  readDevHandle,
  ticketReading,
} from "./ship-ticket.mjs";
import {
  logInstanceReading,
  reapCheckoutInstances,
  readAppInstances,
} from "./ship-reap.mjs";
import {
  cleanBranch,
  createOrReusePull,
  mergeAndVerify,
  pollUntilTerminal,
  reportVerdict,
} from "./ship-platform.mjs";
import { closeIssues } from "./ship-close.mjs";
import { parsePorcelain, runCommitStage, runPushStage } from "./ship-local.mjs";

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
  let code;
  try {
    code = await runFlow(deps, tmpFiles);
  } finally {
    for (const p of tmpFiles) {
      try {
        fs.unlinkSync(p);
      } catch {
        // 已经被删 / 从来没写成：清理尽力而为，不该改变这一次编排的结论。
      }
    }
  }
  /* 收尾回收挂在**唯一出口**上，而不是某个阶段末尾：一轮可以从七八个出口结束
   * （门槛拦下、基线取不到、cnb 不在、轮询到顶…），挂在阶段里就总有「哪条路径忘了收」
   * 这种形态 —— 而那恰好是这一格要防的事。`--dry-run` 只进计划，不伸手。 */
  const opt = parseArgs(deps.args ?? process.argv.slice(2));
  if (opt.reap && !opt.dryRun) {
    const root = deps.root ?? process.cwd();
    const log = deps.log ?? ((s) => process.stdout.write(s + "\n"));
    const run = deps.run ?? makeRunner(root);
    const before = code;
    code = combineShipCodes([
      code,
      await reapCheckoutInstances({
        root,
        log,
        run,
        read: deps.readInstances ?? readAppInstances,
      }),
    ]);
    /* 合并进来之后先前那句「结论：exit N」就可能过期 —— 那正是这一族最反对的形状
     * （一句声明被同一轮的下一行推翻），所以只在结论**变了**的时候改口一次。 */
    if (code !== before) {
      log(
        `[ship] 含收尾回收的最终结论：exit ${code}` +
          `（上面那行 exit ${before} 是回收之前的结论）`,
      );
    }
  }
  return code;
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
 *   readInstances?: (root: string) => Promise<{running?: boolean, pids?: number[], via?: string | null}>,
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
  /* `--close-issue` 后面跟的东西必须像 issue 号（ISSUE #2199）。把它当未知旗标收下是
   * 最坏的一种读法：那一跑会退成「拼错的旗标」，而人真正想要的那个动作（补关一张
   * 早已落地的单子）连被讨论都没被讨论。 */
  if (opt.closeIssueBad.length > 0) {
    log(
      `[ship] [ERROR] --close-issue 收的是 issue 号（2 位以上数字，可写 #2179），` +
        `这里不像：${opt.closeIssueBad.join(" ")}`,
    );
    log(
      "[ship] 一个都不认 ⇒ 不动任何单子；这一格没有结论（不是「已经关好了」）。",
    );
    return CODE.NOT_RUN;
  }
  /* poll / verdict / merge / close-issue / clean-branch 要用「本次跑里解析出来的 PR 号」
   * 或「合并那一段才有的验真结果」，而它们是在 pull-request / merge 那两段拿到的 ——
   * 单独 --only=poll 会走进「一段都没跑、于是没有任何结论」却退 0 的形态。那是假绿灯，
   * 正是本工具要防的那一类，所以显式拒绝，而不是让它安静地成功。 */
  const NEEDS_PR_NUMBER = [
    "poll",
    "verdict",
    "merge",
    "close-issue",
    "clean-branch",
  ];
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

  /** 仓库 slug 与 cnb 在场性 —— 装配层的事实（阶段 0 的屏幕输出与「只补关」那一路都要用）。 */
  const slugRes = up.remote
    ? run("git", ["remote", "get-url", up.remote])
    : { stdout: "" };
  const slug = parseSlug(slugRes.stdout);
  const cnbOk = probeCnb();

  /* ── 「只补关」那一路（ISSUE #2199）───────────────────────────
   * 人在命令行上点名的号**而本轮没要合并** ⇒ 这一跑的目的就是把早已落地、却没关掉的单子关上
   * （现场是 #2179：内容在 `1a05cd40` 上，单子还挂着）。判据用人自己给的 `--merge`，
   * 不去猜「工作树干不干净」那种间接信号：要连本次改动一起交出去，就照旧
   * `--merge … --close-issue <号>`，那时这些号跟在本轮验真的合并之后一起关。
   * 「凭什么可以关」仍由 `decideCloseIssue` 判 —— 这一路要有一份平台侧的落地证明，
   * 没有证明就退 2，而不是把单子标成完成。 */
  if (opt.closeIssue && opt.closeIssueNumbers.length > 0 && !opt.merge) {
    if (!cnbOk || !slug) {
      log(
        `[ship] 补关这一格没有执行者（${cnbOk ? "仓库 slug 取不到" : "cnb 不在"}）` +
          " ⇒ 不动任何单子，也不猜它关没关。",
      );
      return CODE.NOT_RUN;
    }
    log(
      `[ship] 本轮只补关：人点名 ${opt.closeIssueNumbers.map((n) => `#${n}`).join(" ")}` +
        " 而没要 --merge ⇒ 不跑 preflight / commit / push。",
    );
    return finish([
      closeIssues({
        run,
        log,
        slug,
        closeIssue: true,
        landed: null,
        explicit: opt.closeIssueNumbers,
      }),
    ]);
  }

  // ── 阶段 0：preflight ────────────────────────────────────────
  if (want("preflight")) {
    const head = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
    let branch = head.stdout.trim();
    if (head.status !== 0 || !branch) {
      log(
        "[ship] 取不到 HEAD ⇒ 非 git 检出 / 游离 HEAD，这一格没有结论（不是「通过」）",
      );
      return CODE.NOT_RUN;
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
            return finish(codes);
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
        return finish(codes);
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
    const handle = readDevHandle({ root, env: process.env });
    for (const l of issueAuthoring({
      handle,
      platform: process.platform,
      root,
      showExits: !handle || (ticket?.anonymousFixed.length ?? 0) > 0,
    }).lines) {
      log(l);
    }
    /* 本检出的应用服务此刻在不在跑 —— 一格**读数**，不参与退码。放在这里是理由：这是
     * 整条链上唯一一处「还没动手、而机器的状态可以顺手交代」的时刻。真收在 `--reap`
     * （见 `main`），两半共用同一条归属判据；读不出来就念「读不出来」，不圆成「无」。 */
    try {
      logInstanceReading(
        log,
        await (deps.readInstances ?? readAppInstances)(root),
      );
    } catch (e) {
      log(
        `[ship] 本检出应用实例：读不出来（${e instanceof Error ? e.message : String(e)}）` +
          " ⇒ 这一格不构成结论，也不参与退码",
      );
    }
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
        cleanBranch: opt.cleanBranch,
        createBranch: cb.act ? cb.branch : null,
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

    // ── 阶段 1：commit（实现见 `ship-local.mjs`，判据仍在 `ship-core.mjs`）──
    if (want("commit")) {
      const r = runCommitStage({
        opt,
        root,
        staged,
        unstagedModified,
        untracked,
        log,
        run,
        relay,
      });
      codes.push(...r.codes);
      if (r.stop) return finish(codes);
    }

    // ── 阶段 2：push（合并前固定动作由 pre-push 钩子自己跑）────
    if (want("push")) {
      const r = runPushStage({
        up,
        branch,
        root,
        resolveDir,
        log,
        run,
        relay,
      });
      codes.push(...r.codes);
      if (r.stop) return finish(codes);
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
            /* 只把「人这一跳给了哪个旗标」递过去：合并那一段收尾那句边界声明要按
             * 这一轮实际做了什么来说，不留一句被下一行推翻的话。 */
            cleanBranch: opt.cleanBranch,
          }),
        );
      }

      // ── 阶段 7：关单（显式，且只跟在验真的合并之后）────────────
      /* 这一格**只在人点名时出现**（`--close-issue`）：关一张单子是把状态写到
       * 别人也看得见、且不会自动回退的地方，与合并本身同一档，所以同一个口径 ——
       * 默认不开。没合并成而带着它跑，落的是 2 并说明（不是静默跳过、更不是绿）。 */
      if (opt.closeIssue) {
        codes.push(
          closeIssues({
            run,
            log,
            slug,
            closeIssue: true,
            landed,
            explicit: opt.closeIssueNumbers,
          }),
        );
      }

      // ── 阶段 8：清理分支（显式，且只跟在验真的合并之后）──────────
      /* 与合并、关单同一档：默认不开。这一格动的是 ref —— 远端那条删掉后 PR 的评审线索
       * 一起没，本地那条是这些提交唯一的对象（squash 落进主干的是另一笔）。
       * 所以守卫就是「合并验真过没有」，而不是「用户是不是随口说了清理」。 */
      if (opt.cleanBranch) {
        codes.push(
          cleanBranch({
            run,
            log,
            remote: up.remote,
            branch,
            landedVerified: landed.verified,
            cleanBranch: true,
          }),
        );
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
