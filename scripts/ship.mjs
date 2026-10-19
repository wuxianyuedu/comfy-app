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
 *
 * ── 用法 ───────────────────────────────────────────────────────
 *
 *   pnpm ship                                  # 到「CI 出终态 + 打印下一动作」为止
 *   pnpm ship --message "…"                    # 需要它代为提交时给出提交信息
 *   pnpm ship --add src/a.ts --add changelog.d/0-x.md --message "…"   # 由它代为暂存（逐个点名，不 -A）
 *   pnpm ship --merge                          # 允许在 CI 绿时执行 squash 合并
 *   pnpm ship --dry-run                        # 只打印将要执行的命令，一条都不执行（阻塞照报）
 *   pnpm ship --only=poll                      # 单跑一段（排查用，见 PHASES）
 *   pnpm ship --no-wait                        # 建完 PR 就停，不轮询 build
 *
 * 阶段名：preflight · commit · push · pull-request · poll · verdict · merge
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { pnpmInvocation } from "./launcher-core/shell.mjs";
import {
  asArray,
  buildPullBody,
  CODE,
  combineShipCodes,
  findPullForBranch,
  parseArgs,
  parseSlug,
  PHASES,
  pickBuildForSha,
  planCommands,
  readBuildVerdict,
  readProof,
  readPullVerdict,
  resolveUpstream,
} from "./ship-core.mjs";

/**
 * 把 `cnb <args>` 解析成「这一族真正起得来的形态」。
 *
 * ⚠️ Windows 上 `cnb` 是 pnpm 全局目录里的三个垫片：无扩展名那份 node 不认
 * （ENOENT）、`cnb.cmd` 在无 shell 下被 Node 直接拒（**EINVAL**，CVE-2021-22940
 * 那批修复的副作用）、没有 `cnb.exe`。而本仓刻意 `shell: false`
 * （`launcher-core/shell.mjs` 头注第 2 条：多一层 `cmd /C` 就多一层失败面）。
 * 所以「`spawnSync("cnb")` 失败」**不等于**「这台机器没有 cnb」——
 * 实测 `usableCommand("cnb").ok` 与 `commandInvocation("cnb")` 都会给出否，
 * 而同一时刻命令行里 `cnb` 好得很。
 *
 * 出路不是自己摸 PATH、更不是偷偷开 `shell: true`，而是走**已经为 pnpm 解决过
 * 同一件事的那份唯一实现**：`pnpmInvocation(args, {name})` —— 它把
 * `cnb.ps1` 经 PowerShell 宿主起起来（实测 `viaHost: true`，spawn 退 0）。
 * 那个 `name` 选项就是它通用的一面，别因为函数名里有 pnpm 就另写一份。
 *
 * @param {string[]} args cnb 参数
 * @returns {{command:string,args:string[]} | null} 起得来的形态；找不到命令时 null
 */
export function cnbSpawn(args) {
  const inv = pnpmInvocation(args, { name: "cnb" });
  return inv ? { command: inv.command, args: inv.args } : null;
}

/**
 * 造一个「跑外部命令」的执行者（测试里整体替换掉）。
 *
 * ⚠️ **`stderr` 必须一起带回来**：`git commit` 被 pre-commit 拦下时，钩子把全部
 * 原因写在 **stderr** 上。第一版只接了 `stdout`，于是屏幕上只剩一句
 * 「提交被门槛拦下」而**一个理由都没有** —— 对一个职责就是「如实转述执行者」的
 * 工具，这是它能犯的最重的错。
 *
 * @param {string} cwd 工作目录
 * @returns {(cmd:string,args:string[])=>{status:number,stdout:string,stderr:string,error:string|null}} 执行函数
 */
export function makeRunner(cwd) {
  return (cmd, args) => {
    const inv = cmd === "cnb" ? cnbSpawn(args) : { command: cmd, args };
    if (!inv) {
      return {
        status: -1,
        stdout: "",
        stderr: "",
        error: "ENOENT",
      };
    }
    const r = spawnSync(inv.command, inv.args, { cwd, encoding: "utf8" });
    const err = r.error
      ? /** @type {Error & {code?:string}} */ (r.error).code || String(r.error)
      : null;
    return {
      status: r.status === null || r.status === undefined ? -1 : r.status,
      stdout: r.stdout || "",
      stderr: r.stderr || "",
      error: err,
    };
  };
}

/**
 * 跑一次 `cnb … -v` 并把 stdout 当 JSON 解析。
 *
 * 解析失败**返回 null 而不是抛**：调用方据此判「没跑起来」（`CODE.NOT_RUN`），
 * 而不是让它冒成一条栈 —— 栈会被读成「命令跑过且失败」，那正是这一族要避免的误读。
 *
 * @param {(cmd:string,args:string[])=>{status:number,stdout:string,stderr:string,error:string|null}} run 执行者
 * @param {string[]} args cnb 参数
 * @returns {{json:any,code:number,raw:string} | null} 解析结果；取不到时 null
 */
function cnbJson(run, args) {
  const r = run("cnb", args);
  if (r.error === "ENOENT") return null;
  const text = r.stdout.trim();
  const at = text.indexOf("{");
  if (at < 0) return null;
  try {
    return { json: JSON.parse(text.slice(at)), code: r.status, raw: text };
  } catch {
    return null;
  }
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
 *   run?: (cmd:string,args:string[])=>{status:number,stdout:string,stderr:string,error:string|null},
 *   probeCnb?: ()=>boolean,
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
  /** 写一份临时文件并**登记待回收** —— 只有这一条出口，漏登记就删不掉。 */
  const mkTmp = (/** @type {string} */ name, /** @type {string} */ text) => {
    const p = writeTmp(root, name, text);
    tmpFiles.push(p);
    return p;
  };
  const run = deps.run ?? makeRunner(root);
  /** cnb 在不在：**真起一次** `--version` 看退码。不按「PATH 里有没有那个名字」判 ——
   *  在 Windows 垫片上「找得到」与「起得来」是两件事（见 `cnbSpawn` 那段）。 */
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

  /* ── 远端名与上游基线：在两道守卫（未知旗标 / `--only` 单独跑）之后解析一次 ──
   * push / PR 正文 / fetch / 「回读主干顶端」四段都要用它，所以不能等各段各自去推。
   * 这一版原先五处**写死 `origin`**，而本仓按规范只有一个叫 `cnb` 的远端
   * （硬规则 6 / §13.6）⇒ 那五条命令全部失败，而每处失败都长得像「答案为空」：
   * 碎片那一查拿到空串 ⇒ preflight 报「没有 changelog.d 碎片」⇒ `pnpm ship` 在本仓
   * 从第一次跑起就没工作过，报的还是一个听起来正当的理由。
   * 推不出远端名时**不在这里**判红：各阶段拿 `up.remote === null` 自己退 NOT_RUN ——
   * 「取不到远端」与「这一步跑出来是红的」是两件事（三态退出码那条口径）。 */
  const upRes = run("git", [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{u}",
  ]);
  const remotesRes = run("git", ["remote"]);
  up = resolveUpstream({
    upstream: upRes.stdout,
    remotes: remotesRes.stdout.split("\n"),
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
    const dirtyLines = dirty.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const staged = dirtyLines.filter((l) => /^[AMR]/.test(l));
    const unstaged = dirtyLines.filter((l) => !/^[AMR]/.test(l));
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
      `[ship] 暂存 ${staged.length} 项 · 未暂存 ${unstaged.length} 项 · changelog.d 碎片 ${frags.length} 份`,
    );
    if (unstaged.length > 0 && opt.adds.length === 0) {
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
      if (dirtyLines.length > 0 || staged.length > 0) {
        if (!msg) {
          log(
            "[ship] 有改动但没给 --message ⇒ 停。提交信息是判断（症状/读数/因果），脚本不代写。",
          );
          codes.push(CODE.RED);
          return finish(codes);
        }
        for (const a of opt.adds) run("git", ["add", "--", a]);
        const cf = mkTmp("ship-commit-msg", msg);
        const cm = run("git", ["commit", "-F", cf]);
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
      const proof = readProof(root);
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

    // ── 阶段 3-6：平台侧（需要 cnb）────────────────────────────
    if (!cnbOk) {
      codes.push(CODE.NOT_RUN);
      return finish(codes);
    }
    const newSha = run("git", ["rev-parse", "HEAD"]).stdout.trim();

    if (want("pull-request")) {
      const list = cnbJson(run, [
        "pulls",
        "list-pulls",
        "--repo",
        slug,
        "--state",
        "open",
        "-v",
      ]);
      let number = list ? findPullForBranch(list.json, branch) : null;
      if (number) {
        log(`[ship] 已有开放 PR #${number} ⇒ 复用，不重建（幂等）`);
      } else {
        const title = run("git", ["log", "-1", "--pretty=%s"]).stdout.trim();
        const body = buildPullBody({
          root,
          fragments: frags,
          /* 基线取不到时这一格就是空 —— 宁缺：拿 `HEAD...HEAD` 会得到一份「什么都没有」
           * 的 diffstat，而 PR 正文里那句「这次改了哪些文件」正是读者判断成本的入口。 */
          diffstat: baseRef
            ? run("git", ["diff", "--stat", `${baseRef}...HEAD`]).stdout.trim()
            : "",
        });
        /* 守卫排在落临时文件**之前**：`mkTmp` 的回收挂在 `main` 的 `finally` 上，
         * 先建再退虽然不会留垃圾，但会让「这次没建 PR」那一次也在盘上写过一份
         * 提交信息原文 —— 而 #2037 修的就是这类东西不该留在盘上。 */
        if (!baseBranch) {
          log(
            "[ship] 推不出主干分支名（基线引用不可用）⇒ 不建 PR：拿一个猜的 `--base` 建出去，" +
              "得到的是「PR 指向一条不存在的主干」，而平台会照建不误。这一格退 NOT_RUN。",
          );
          codes.push(CODE.NOT_RUN);
          return finish(codes);
        }
        const bf = mkTmp("ship-pr-body", body);
        const made = cnbJson(run, [
          "pulls",
          "post-pull",
          "--repo",
          slug,
          "--base",
          baseBranch,
          "--head",
          branch,
          "--head-repo",
          slug,
          "--title",
          title,
          "--body-file",
          bf,
          "-v",
        ]);
        if (!made) {
          log(
            "[ship] 建 PR 没拿到可解析的响应 ⇒ 这一格没有结论（不是「失败」也不是「成功」）",
          );
          codes.push(CODE.NOT_RUN);
          return finish(codes);
        }
        number = readPullVerdict(made.json).number;
        log(`[ship] ✓ 已建 PR #${number}`);
      }
      if (!number) {
        codes.push(CODE.NOT_RUN);
        return finish(codes);
      }
      codes.push(CODE.GREEN);

      // ── 阶段 4：poll ─────────────────────────────────────────
      let buildState = /** @type {"green"|"red"|"running"|"unknown"} */ (
        "unknown"
      );
      let buildSn = null;
      if (want("poll") && opt.wait) {
        const deadline = now() + 45 * 60 * 1000;
        for (;;) {
          const logs = cnbJson(run, [
            "build",
            "get-build-logs",
            "--repo",
            slug,
            "-v",
          ]);
          const builds = logs ? asArray(logs.json) : null;
          if (!builds) {
            log(
              "[ship] 取不到 build 列表 ⇒ 没跑起来，不当成「还在跑」也不当成「绿」",
            );
            codes.push(CODE.NOT_RUN);
            return finish(codes);
          }
          const picked = pickBuildForSha(builds, newSha);
          if (!picked) {
            log(
              `[ship] 按 sha ${short(newSha)} 还没解析到 build（平台可能尚未开跑）…`,
            );
          } else {
            buildSn = picked.sn;
            const st = cnbJson(run, [
              "build",
              "get-build-status",
              "--repo",
              slug,
              "--sn",
              picked.sn,
              "-v",
            ]);
            /** @type {{state:"green"|"red"|"running"|"unknown",raw:string|null}} */
            const v = st
              ? readBuildVerdict(st.json)
              : { state: "unknown", raw: null };
            buildState = v.state;
            log(
              `[ship] build ${picked.sn} → data.status = ${v.raw ?? "(取不到)"}`,
            );
            if (v.state !== "running" && v.state !== "unknown") break;
          }
          if (now() > deadline) {
            log("[ship] 轮询到预算上限仍未出终态 ⇒ 记「没跑起来」，不猜结论");
            buildState = "unknown";
            break;
          }
          await sleep(20000);
        }
      } else {
        log("[ship] 跳过轮询（--no-wait / --only）⇒ 不合并。");
        codes.push(CODE.GREEN);
        return finish(codes);
      }

      // ── 阶段 5：verdict ──────────────────────────────────────
      if (want("verdict")) {
        const pr = cnbJson(run, [
          "pulls",
          "get-pull",
          "--repo",
          slug,
          "--number",
          String(number),
          "-v",
        ]);
        const pv = pr ? readPullVerdict(pr.json) : null;
        if (pv) {
          log(
            `[ship] PR #${number}：mergeable_state=${pv.mergeableState} blocked_on=${pv.blockedOn || "(无)"} is_merged=${pv.isMerged}`,
          );
        }
        if (buildState === "green") {
          log(
            `[ship] ✓ CI 绿（build ${buildSn}）。下一动作：pnpm ship --merge`,
          );
          codes.push(CODE.GREEN);
        } else if (buildState === "red") {
          log(
            `[ship] ✗ CI 红（build ${buildSn}）。日志：https://cnb.cool/${slug}/-/build/logs/${buildSn}`,
          );
          log(
            "[ship] 归因交给既有执行者：`node scripts/base-check.mjs <拦住你的那条>` —— 本脚本不自己判「是我的还是主干的」。",
          );
          codes.push(CODE.RED);
        } else {
          log("[ship] 没拿到 build 终态 ⇒ 这一格没有结论，不进入合并。");
          codes.push(CODE.NOT_RUN);
        }
      }

      // ── 阶段 6：merge（显式）─────────────────────────────────
      if (want("merge")) {
        if (!opt.merge) {
          log("[ship] 未给 --merge ⇒ 停在判决处。合并是显式动作。");
          codes.push(CODE.GREEN);
        } else if (buildState !== "green") {
          log("[ship] 拒绝合并：CI 不是绿的（当前是 " + buildState + "）。");
          codes.push(CODE.RED);
        } else {
          const title = run("git", ["log", "-1", "--pretty=%s"]).stdout.trim();
          const mg = cnbJson(run, [
            "pulls",
            "merge-pull",
            "--repo",
            slug,
            "--number",
            String(number),
            "--merge-style",
            "squash",
            "--commit-title",
            `${title} (#${number})`,
            "-v",
          ]);
          /** @type {{merged?:boolean,sha?:string} | null} */
          const mergeData = mg && mg.json ? (mg.json.data ?? null) : null;
          if (!mergeData || mergeData.merged !== true) {
            log(
              "[ship] 合并调用没给出 merged:true ⇒ 不假定它成功了，去平台上核对。",
            );
            codes.push(CODE.RED);
          } else {
            // 回读两件事：平台说合上了，**且**碎片真的在主干顶端（只看平台回执 = 半个结论）。
            /* 回读的那条引用也来自解析出的基线（`cnb/master` 在本仓），不写死 `origin`：
             * 写死时 `fetch` 与 `cat-file` 双双失败，而 `frags.every(...)` 拿到的是
             * 「每份都不在主干」⇒ 报成红；反过来若某处吞了失败，就会报成「都在」。
             * 两个方向都错，且都读起来像有结论。 */
            const baseParts = (baseRef ?? "").split("/");
            const baseBranch = baseParts.slice(1).join("/");
            run("git", [
              "fetch",
              baseParts[0] ?? up.remote ?? "origin",
              baseBranch || "master",
            ]);
            const stillOpen = cnbJson(run, [
              "pulls",
              "get-pull",
              "--repo",
              slug,
              "--number",
              String(number),
              "-v",
            ]);
            const back = stillOpen ? readPullVerdict(stillOpen.json) : null;
            const readRef = baseRef ?? `${up.remote ?? "origin"}/master`;
            const fragOnMaster = frags.every(
              (f) =>
                run("git", ["cat-file", "-e", `${readRef}:${f}`]).status === 0,
            );
            log(
              `[ship] 合并回执 sha=${short(mergeData.sha)} 回读 is_merged=${back ? back.isMerged : "?"} 碎片在主干顶端=${fragOnMaster}`,
            );
            codes.push(
              back && back.isMerged && fragOnMaster ? CODE.GREEN : CODE.RED,
            );
            if (fragOnMaster && back && back.isMerged) {
              run("git", ["checkout", "master"]);
              run("git", ["pull", "--ff-only"]);
              log(
                "[ship] 本地 master 已同步。远端分支**没删**（那不在本脚本的动作面里）。",
              );
            }
          }
        }
      }
    }
  }

  return finish(codes);

  /**
   * @param {number[]} cs 各段结论
   * @returns {number} 合并后的退出码
   */
  function finish(cs) {
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

/**
 * @param {string} root 仓库根
 * @param {string} name 临时文件名前缀
 * @param {string} text 内容
 * @returns {string} 写出的绝对路径
 */
function writeTmp(root, name, text) {
  const dir = path.join(root, ".workbuddy");
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${name}-${process.pid}.tmp`);
  fs.writeFileSync(p, text, "utf8");
  return p;
}

/**
 * @param {string} root 仓库根
 * @param {string} rel 相对路径
 * @returns {string} 内容；读不到回空串
 */
function safeRead(root, rel) {
  try {
    return fs.readFileSync(path.resolve(root, rel), "utf8");
  } catch {
    return "";
  }
}

/**
 * @param {string | undefined} s 长串
 * @returns {string} 前 8 位或占位
 */
function short(s) {
  return s ? String(s).slice(0, 8) : "?";
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().then((code) => process.exit(code));
}
