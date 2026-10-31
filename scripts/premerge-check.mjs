#!/usr/bin/env node
/**
 * premerge-check.mjs — 「**合并前的固定动作**」的唯一入口（规范 §13.6.2；ISSUE #1611 拍板）。
 *
 * ── 为什么要有它（而不是多写几条命令进文档）────────────────────────────
 *
 * 平台侧是 **squash 合并**、那一步**不跑本地钩子**，而 ISSUE #623 之后**已无 CI
 * 兜底**（§13.5.3）。于是「我的分支绿」到「`master` 绿」之间那一跳，此前是靠
 * **人的纪律**补的，而纪律有三种漏法：漏跑一步、顺序反了、只跑了自己记得的那条
 * —— 三种都**不报错**，只是让绿灯变得不可信（§9.2 第 3 条禁止的静默失败）。
 *
 * 这个洞在计划里被拆成三笔，三笔落在**同一个动作**上：
 *
 *   · `--base` 档（#1591）—— 复算「钩子里那批全仓判据」在**干净的上游快照**上红不红；
 *   · `pnpm check:claims`（#1605）—— 核「提交信息里那句 §x.y 照旧保留」是不是真的；
 *   · `check-merged-side-loss.mjs`（#1617）—— 核「合并有没有把一侧整份覆盖掉」。
 *
 * 三条**都天然跑不进 `pre-commit`**（本地的钩子面前没有那次 squash 合并），
 * 所以执行者曾是「合并前敲一次」这一个动作 —— 现在由 `.githooks/pre-push` 在 HEAD
 * 或上游引用变动时自动触发（`premerge-proof.mjs`，规范 §13.6.2.1），手工入口照旧保留。
 * 把三件事写成文档里的三条命令，
 * 等于把「记住跑全」交给纪律 —— 而纪律正是这一族失效的根因。所以本脚本把它们
 * **合成一条命令**，并且**不发明第二套编排**：
 *
 *   | 做的事             | 谁在做（既有实现）                                              |
 *   | ------------------ | --------------------------------------------------------------- |
 *   | 复算这一批全仓判据 | `base-check.mjs` 的 `baseCheckMany` + `resolveMergeBatch`（**直接 import**） |
 *   | 核提交信息里的声明 | `check-commit-claims.mjs`（子进程，退出码三态原样透传）           |
 *   | 核合并有没有丢一侧 | `check-merged-side-loss.mjs`（同上）                              |
 *
 * ── 退出码（与 `base-check.mjs` / `check-claims` / 新判据**逐字同口径**）──
 *
 *   `0` = 各段全绿（或 `--json` 下事实已复算）；
 *   `1` = **有段红了**（本脚本要报告的事实：哪一段、红的哪几条）；
 *   `2` = **有段没跑起来**（非 git 检出 / 取不到上游 / 浅克隆）—— 「没跑起来」
 *         与「跑了且红」在退出码上**必须分开**，否则前者会被读成后者（§13.6.2）。
 *
 * ── 它**不做**什么（照 §11.23.4 / §12.18 的口径）──────────────────────
 *
 *   · **不替代 `pnpm check:all`**：后者是更宽的那一档（全量单测 + 覆盖率 + 依赖审计），
 *     本脚本判的是「这一跳会不会把红带进 `master`」。两者不互相替代。
 *   · **不自动拦合并**：它是**人的动作**（平台侧无钩子可挂）。`@` 评审 NPC 唤起一轮、
 *     或人点一次 —— 不敲就不跑（§13.5.4 按需召唤那一层）。
 *   · **不判断「挡不挡路」**：那是判断（硬闸类 vs 棘轮类），本脚本只保证**事实**这一半。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────
 *
 *   pnpm check:premerge                 # 各段全跑（复算 = 钩子注册表的全套）
 *   pnpm check:premerge --full          # 同上，**显式**写出「全套」这一档（行为与默认逐字相同）
 *   pnpm check:premerge --light         # 复算只跑本地形态档那几条（跳过条数会被打印出来）
 *   pnpm check:premerge --json          # 机器可读（逐段给结论）
 *   pnpm check:premerge --skip-claims   # 只跑复算 + 合并面（PR 里还没写合并信息时）
 *   pnpm check:premerge --only=base     # 只跑一段（排查用）
 *
 * 认不出的旗标**一律退 2 并点名**，不静默吞：吞掉的旗标在屏幕上不留痕迹，而「我加了
 * 全套那一档」这句话就是这么变成假绿的（先例：`quality-gate.mjs` 的「未知门禁」同形）。
 * `--full` 是**显式等价于默认**的那一枚（AGENTS.md / ship Skill 多处写着它，而入口曾经
 * 静默吞掉它，于是那句话既没生效也没报错）；`--full` 与 `--light` 同时给 ⇒ 退 2
 * （两个方向的口号同时出现 = 没人知道该跑哪一档）。
 */
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

import {
  baseCheckMany,
  isGitCheckout,
  resolveMergeBaseRef,
  resolveMergeBatch,
} from "./base-check.mjs";
import { localTierLabels } from "./base-check/hook-steps.mjs";
import { renderVerdict } from "./ci-log.mjs";

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..");

/**
 * 四段的定义 —— 顺序即执行序（复算最贵、先跑；后两段是廉价的纯 git 复查）。
 *
 * ⚠️ **2026-10-20 起只剩三段**：`unitTests`（受影响用例）那一档撤了。它从
 * pre-commit 搬到 push 之后只活了不到一天就被撤掉 —— 本地这一跳在最需要它给出
 * 结论的机器上给的恰是最不可信的读数：它会起 vitest 子进程，而共享机（另一条
 * 检出并发推 + 多个 dev server 抢核）上失效形态不是用例红，是
 * `Failed to start forks worker / Timeout waiting for worker`；隔离复跑 88 个
 * 用例文件 / 1116 条全绿。新执行者是平台侧 PR 流水线的 `受影响用例` 一格
 * （`scripts/ci-affected-tests.mjs` → `run-affected-tests.mjs` +
 * `COMFY_AFFECTED_CHANGED`，同一条判决链，并发按 `ci-load.mjs` 收敛）。
 * 撤段而不是「留一段恒跳过」：恒跳过的段会让 `--json` 的读数里永远有一格
 * 「没跑起来」，而那一格不构成证据（§13.6.2 的口径：没判 ≠ 绿）。
 *
 * `mergeLoss` 那一格是 `anchored` 而不是裸 `script`：它**需要一个锚点**
 * （`--baseline <已知好的参照点>`），而那个锚点在「合并前」这一刻是**算得出来的**
 * —— 见 `resolveForkBaseline()`。早先的写法是 `args: []`，于是这一段**恒退 2**
 * （`check-merged-side-loss.mjs` 缺 `--baseline` 直接 exit 2），整个入口因此
 * **恒报「不构成证据」** —— 恰好是这套编排要消灭的那类静默失效
 * （看着在跑、事实一次没复算）。口径与出口见 §13.6.2.1。
 *
 * `claims` 那一格**同批改成 `anchored`**（ISSUE #2070，方向与上面那条相反、病是同一个）：
 * 它此前也是 `args: []`，而 `check-commit-claims.mjs` 不带参数时**只审 HEAD** ——
 * 于是「批次里较早那笔的假声明」在推送那一刻根本没人看：作者本地推的时候审的是
 * 最新一笔，合并之后 HEAD 前进，就再没有第二个执行者回头重放它。判据本体一字不改，
 * 改的是**取哪些提交**：`shape: "range"` ⇒ 交 `<分叉点>..HEAD`，也就是「本次带进来的
 * 那一批」。实测代价（本仓 30 笔真提交逐条审）14 秒 —— 没有声明的提交只值一次
 * `git log`，贵的是**真带声明**的那几笔（本机单条约 49 秒），而一批里通常只有 0~1 笔。
 *
 * ⚠️ **它被导出只为一件事**：`tests/premerge-check.test.ts` 那条「各段全被跳过 ⇒ 退 2」
 * 的跳过清单**从这里推**，不硬写名单 —— 硬写的话，加第四段时那条用例会继续绿着、
 * 而它其实漏了一段没跳。从段表推 ⇒ 加一段就必须同时处理它，否则当场红。
 *
 * @type {Record<string, {label: string, kind: "base"} | {label: string, kind: "script", script: string, args: string[]} | {label: string, kind: "anchored", script: string, shape: "baseline" | "range"}>}
 */
export const SEGMENTS = {
  base: {
    label: "合并前复算（钩子里那批全仓判据）",
    kind: "base",
  },
  claims: {
    label: "提交信息里的机械可核声明 ⇄ 树事实（§11.23.5）",
    kind: "anchored",
    script: "check-commit-claims.mjs",
    /* 审「这批」而不是审「最新那一笔」—— 见上面那段 #2070。 */
    shape: "range",
  },
  mergeLoss: {
    label: "合并有没有把一侧整份覆盖掉（#1617）",
    kind: "anchored",
    script: "check-merged-side-loss.mjs",
    shape: "baseline",
  },
};

/**
 * 锚点取不到时那一段该记成什么 —— **退 2 并说明**，不许记成绿。
 *
 * 这一档此前写的是 `code: 0`：取不到分叉点 ⇒ 那一段「绿」。它与本仓反复在修的那一形
 * 逐字同（`tests/premerge-check.test.ts` 那条「算不出锚点时退 2 并说明，绝不静默退 0」
 * 说的是**函数**的契约，而**编排**这一层把 ok:false 折成了 0 —— 契约对了、接线错了）。
 * 现在两段共用这一个折算点，所以把它单列成一个函数：`main` 里那一段要真跑 git，
 * 用例进不去（本文件的 `combineCodes` / `lastSummary` 同样是提成纯函数才可判的）。
 *
 * 「取不到分叉点」在真实推送路径上不会悄悄改变判决：同一次跑里 `base` 段遇到同一个
 * 情况本来就记 2（见上面那个分支），`combineCodes` 又是「2 压过 1」——
 * 这里改的是**读数的诚实度**，不是新增一道拦。
 *
 * @param {string} label 段名（打给人看的那一条）
 * @param {string} reason 取不到的原因（`resolveForkBaseline()` 交回的那句）
 * @returns {{code: number, output: string}}
 */
export function anchorMissed(label, reason) {
  return {
    code: 2,
    output:
      `[premerge] ${label}：这一段**没跑起来** —— ${reason}。` +
      "「取不到分叉点」不是「这批没问题」（§13.6.2：没判 ≠ 绿）。\n",
  };
}

/**
 * 跑一条只读 git 命令，拿标准输出；跑不动返回 `null`（不抛）。
 *
 * 本文件原先在 `merge-base` 那一处内联 `execFileSync` + `try/catch`，现在「这个引用
 * 指不指得动一个提交」也要同一件事 —— 两处各写一遍就会有一处漏掉 `null` 那一支
 * （§12.12 的小尺寸版）。**不导出**：它只是这两个读取动作的公共形状，
 * 外面要用 git 的话各自有自己的口径。
 *
 * @param {string[]} args
 * @param {string} cwd
 * @returns {string | null}
 */
function runGit(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * 给 `anchored` 那两格**算**出它们共同的锚点。
 *
 * 锚点是什么：**这条线从哪一刻起与要并进去的那条分开的** —— 也就是
 * `merge-base(<要并进去的那条>, HEAD)`。`check-merged-side-loss.mjs` 判的是
 * 「结果版是不是退回了基线之前的某一版」，所以「基线」= **分叉点**，不是
 * `origin/master` 的尖端：拿后者会把分支侧自己的正当改动整片读成差异。
 * `claims` 那一段要的也正是这一格：`<分叉点>..HEAD` = 本次带进来的那一批提交。
 *
 * 「要并进去的那条」有两个来源，按可信度排：
 *   ① `CNB_PULL_REQUEST_TARGET_SHA`（平台在 PR 事件上给的那个 sha）——
 *      自托管那条流水线上**只 fetch 协商后的单 ref**（`refs/heads` 零条，见
 *      `工作区复用读数` 那格的读数），所以那里未必有 `origin/master` 这个引用名。
 *      `ci-affected-tests.mjs` 取改动面用的就是它，两格认同一个来源，不各找各的
 *      （§12.18）；**拿到 sha 之后仍然要算 `merge-base`** —— 它是目标线的尖端，
 *      不是分叉点，直接当基线用会踩上面那句警告。
 *   ② 取不到 env 时按本地那套找引用（各 remote 的 `master` → 本地 `master`）。
 *
 * 为什么在这里算、而不是让判据自己算：判据的**天真形态**（自己推被丢的那一侧是谁）
 * 在 `ad81a912` 上实测 128 份改动 → **0 命中**（那条线在 squash 之后常常已不可达）。
 * 但「分叉点」与那个不是同一个问题 —— 它**是**可算的，且正是判据需要的语义。
 * 这与 `.githooks/prepare-commit-msg` 那条提交前档同源（那边用 `MERGE_HEAD` + merge-base）。
 *
 * @param {string} [cwd]
 * @param {Record<string, string | undefined>} [env] 平台事件的那几个变量
 * @returns {{ok: true, baseline: string} | {ok: false, reason: string}}
 */
export function resolveForkBaseline(cwd = ROOT, env = process.env) {
  /** @param {string} ref @returns {boolean} 这个引用在本检出里指得动一个提交 */
  const isCommit = (ref) =>
    runGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd) !== null;
  /* ① 平台给的目标 sha：只在它**真的落在这份对象库里**时才用 —— 浅克隆 / 单 ref
   *    之外的那个 sha 会让 merge-base 直接失败，那种「用了但跑不动」比退回 ② 更难读。 */
  const fromEnv = String(env.CNB_PULL_REQUEST_TARGET_SHA ?? "").trim();
  const ref = isCommit(fromEnv) ? fromEnv : resolveMergeBaseRef(cwd);
  if (!ref) {
    return {
      ok: false,
      reason:
        "取不到要并进去的那条（`CNB_PULL_REQUEST_TARGET_SHA` / 各 remote 的 master / 本地 master）—— 先 `git fetch` 再跑",
    };
  }
  /* 只读一条 git 命令；跑不动 ⇒ 历史不全（浅克隆）⇒ 如实报「没跑起来」，不问「红没红」。 */
  const base = runGit(["merge-base", ref, "HEAD"], cwd);
  if (!base) {
    return {
      ok: false,
      reason: `算不出 ${ref} 与 HEAD 的分叉点（浅克隆 / 历史不全）`,
    };
  }
  return { ok: true, baseline: base };
}

/**
 * @param {string[]} argv
 * @returns {{json: boolean, only: string | null, skip: Set<string>, light: boolean, full: boolean, unknown: string[]}}
 */
function parseArgs(argv) {
  /** @type {{json: boolean, only: string | null, skip: Set<string>, light: boolean, full: boolean, unknown: string[]}} */
  const out = {
    json: false,
    only: null,
    skip: new Set(),
    light: false,
    full: false,
    unknown: [],
  };
  for (const a of argv) {
    if (a === "--json") {
      out.json = true;
    } else if (a === "--light") {
      out.light = true;
    }
    /* `--full` 是**显式**写出默认档的那一枚：行为与不给它逐字相同，但「我加了全套」这句话
     * 从此有判据可依（AGENTS.md 与 ship Skill 多处写着它 —— 入口不认它却不报错，
     * 是 #2764 的立案根因）。冲突与档位判定在 `main()` 里做。 */
    else if (a === "--full") {
      out.full = true;
    } else if (a.startsWith("--only=")) {
      out.only = a.slice("--only=".length);
    } else if (a.startsWith("--skip-")) {
      out.skip.add(a.slice("--skip-".length));
    }
    /* 没有 else 的那些年：一条拼错的旗标既不报错也不生效，于是「我跑的是全套」这句话
     * 没有任何依据 —— 而这一档恰恰是被当作「本地全套凭证」用的。退 2 是这里唯一的
     * 诚实读数：没跑起来 ≠ 跑了且绿。 */
    else {
      out.unknown.push(a);
    }
  }
  return out;
}

/**
 * 跑一段「脚本型」的复查 —— 子进程 + 退出码**原样**透传。
 *
 * 为什么透传而不是归一：三条判据的退出码含义是**同一套**（0 / 1 红 / 2 没跑起来），
 * 在中间层再翻译一遍就等于造第二个口径（§12.18）。中间层只负责「把各段的码合成
 * 一个总码」+「把输出都打出来」。
 *
 * **`cwd` 默认是本文件安装位置**（`ROOT`）—— 既有那几段（`mergeLoss` 等）的判据都
 * 锚在安装位置那份检出上，行为不动。`claims` 那一格例外：`check-commit-claims.mjs` 的
 * `ROOT = process.cwd()`，它的「这批」是本入口**自己的 cwd**（本入口能被 `cd` 进
 * 另一份检出跑）—— 两处各用一处口径的话，锚点与区间端点会来自两个不同的仓库
 * （ISSUE #2788 的第二个现场：本机绿、平台上报「取不到要审的提交」）。
 *
 * @param {string} script
 * @param {string[]} args
 * @param {Record<string, string | undefined>} [extraEnv]
 * @param {string} [cwd] 子进程的工作目录（默认 `ROOT`）
 * @returns {{code: number, output: string}}
 */
function runScript(script, args, extraEnv = {}, cwd = ROOT) {
  const r = spawnSync(process.execPath, [path.join(HERE, script), ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CI: "1", ...extraEnv },
  });
  /* Node 自己在 `MODULE_NOT_FOUND` 时也退 1 —— 与「判据红了」同形。所以「没跑起来」
   * 由**两路输出全空**（脚本连一行都没打出来）兜一层，再归一成 2。
   * 这条与 `base-check.mjs` 的 `commandTargetState` 是同一族口径（§13.6.2）。 */
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (typeof r.status !== "number" || (r.status !== 0 && output.trim() === "")) {
    return {
      code: 2,
      output: output || `[premerge] ${script} 没有跑起来（无输出）\n`,
    };
  }
  return { code: r.status, output };
}

/**
 * `base` 段那一批里**实际会被跑到的脚本名**（从 argv 里认 `*.mjs` / `*.cjs` / `*.js`）。
 *
 * 存在的理由只有一件：`resolveMergeBatch` 的**第二个来源**
 * （`base-check/chained-steps.mjs`）已经把 `check-commit-claims.mjs --range <base>..HEAD`
 * 收进那一批了 —— 也就是说「审这一批的声明」在 base 段里**早就有执行者**，
 * 而本文件自己那格 `claims` 此前只审 HEAD 一笔（ISSUE #2070）。把它改成审同一批之后，
 * 同一次跑里就可能出现**两遍同样的核对**（带声明的提交实测单条约 49 秒），
 * 所以这里要一个「base 段跑没跑过它」的读数。
 *
 * ⚠️ 必须按**实际要跑的那批**（`--light` 筛过之后）算，不能按 `resolveMergeBatch`
 * 算出来的整批算：`localTierLabels()` 里没有那条 chained 的标签，`--light` 会把
 * 它筛掉 —— 拿整批去重就等于把「其实没跑」的那条也免掉，那是假绿的新住处。
 *
 * @param {Array<{argv?: string[]}>} commands
 * @returns {Set<string>} 形如 `scripts/check-commit-claims.mjs`
 */
export function scriptsInCommands(commands) {
  const out = new Set();
  for (const c of commands ?? []) {
    for (const a of c?.argv ?? []) {
      const text = String(a);
      if (/\.(mjs|cjs|js)$/.test(text)) {
        out.add(text);
      }
    }
  }
  return out;
}

/**
 * 合成各段的总码：**2 优先于 1**（没法归因的读数不许被当成结论）。
 *
 * @param {number[]} codes
 * @returns {number}
 */
export function combineCodes(codes) {
  if (codes.includes(2)) {
    return 2;
  }
  if (codes.includes(1)) {
    return 1;
  }
  return 0;
}

/**
 * @param {string[]} argv
 * @returns {number} 退出码
 */
function main(argv) {
  const { json, only, skip, light: lightRecompute, full, unknown } = parseArgs(argv);

  /* 认不出的旗标 ⇒ 退 2 并**点名**（#2764）。与 `quality-gate.mjs` 的「未知门禁」
   * 同形：拼错的那一枚在屏幕上不留任何痕迹，而这一档是被当作「本地全套凭证」用的 ——
   * 「我加了全套那一档」这句话就是这么变成假绿的。2 的读法是「这一步没有结论」，
   * 不是「跑过了且绿」。 */
  if (unknown.length > 0) {
    process.stderr.write(
      `[premerge] 不认识的参数：${unknown.join(" / ")} —— 本入口认 ` +
        "--json / --full / --light / --only=<段名> / --skip-<段名>；" +
        "拼错的旗标不会生效，退 2 表示这一跳没有结论（不是「跑过了且绿」）\n",
    );
    return 2;
  }

  /* `--full` 与 `--light` 同时给 ⇒ 没有人在读的那一档不是「更全」：两个方向的口号
   * 同时出现时，屏幕上无论跑哪一档，另一个口号都会留在执行者的记忆里当凭证。 */
  if (full && lightRecompute) {
    process.stderr.write(
      "[premerge] `--full` 与 `--light` 同时给 —— 一个要全套、一个要跳重档，" +
        "入口不替你挑（退 2）；只给其中一枚\n",
    );
    return 2;
  }

  if (!isGitCheckout(ROOT)) {
    process.stderr.write(
      "[premerge] 当前目录不是 git 检出 —— 「合并前复算」没有基线可比（退 2）\n",
    );
    return 2;
  }

  const wanted = Object.entries(SEGMENTS).filter(([key]) => {
    if (only) {
      return key === only;
    }
    return !skip.has(key);
  });
  if (wanted.length === 0) {
    process.stderr.write("[premerge] 各段全被跳过 —— 没有任何东西被复算（退 2）\n");
    return 2;
  }

  /** @type {Array<{key: string, label: string, code: number, output: string}>} */
  const results = [];
  /* `base` 段**实际跑过**的脚本（见 `scriptsInCommands` 那段：按筛过的批算）。
   * 循环外声明，因为段序是 `base` 在前 —— 后面的段要能读它。 */
  const ranInBase = new Set();

  for (const [key, seg] of wanted) {
    /* `seg` 的联合类型由 `SEGMENTS` 的 JSDoc 给出；两处用法各自收窄（见下）。 */
    if (seg.kind === "base") {
      /* **直接 import 既有实现**，不在这里重写「建快照 / 归属 / 话术」那一套 ——
       * 抄第二份就会漂（§12.18 / §12.12）。它自己打报告、自己算四态，
       * 我们只拿它的退出码。 */
      const ref = resolveMergeBaseRef(ROOT);
      if (!ref) {
        results.push({
          key,
          label: seg.label,
          code: 2,
          output:
            "[premerge] 取不到要并进去的那条（各 remote 的 master / 本地 master）—— 先 `git fetch` 再跑\n",
        });
        continue;
      }
      const batch = resolveMergeBatch([], path.join(ROOT, ".githooks", "pre-commit"));
      if (!batch.ok) {
        results.push({
          key,
          label: seg.label,
          code: 2,
          output: `[premerge] ${batch.error}\n`,
        });
        continue;
      }
      /* 档位（ISSUE #2022 / §13.5.25）：合并前这一跳**默认跑全套** —— 业主的第二条口径是
       * 「把 pre-commit 的内容挪到 pre-push」，也就是：提交那一档越快越好（只留形态档），
       * 但重档不能没有本地执行者，它的家从 commit 搬到 push。
       * `--light` 是反向的出口（在飞的改动想先推上去、把判定完全交给平台时用它），
       * 用了就必须在读数里说清跳过了几条 —— 否则「premerge 绿」会被读成「全套复算过」，
       * 而那正是本仓反复钉的假绿形状。
       * 清单仍只有钩子那一份：`localTierLabels()` 从钩子文本的 `run_group D0` 块边界取，
       * 不在这儿另立名单（两份名单的漂移是静默的）。 */
      const localTier = localTierLabels();
      const commands = lightRecompute
        ? batch.commands.filter((c) => localTier.has(c.label))
        : batch.commands;
      const skippedCount = batch.commands.length - commands.length;
      /* 记下这一段**实际**会跑的脚本名（`--light` 筛过之后那一半）。 */
      for (const s of scriptsInCommands(commands)) {
        ranInBase.add(s);
      }
      if (lightRecompute && skippedCount > 0) {
        process.stdout.write(
          `[premerge] --light：本段只复算本地档那几条，跳过 ${skippedCount} 条重档` +
            "（这一跳不构成全套凭证；行为面由平台那一跑兜底）\n",
        );
      }
      /* `baseCheckMany` 自己把判决写进输出、**恒退 0**（「判据红了」是它要报告的事实）。
       * 合并前这一跳要的却是「红没红」这个**闸门**语义 —— 所以这里按它返回的
       * `summary` 折算：`current-green` = 0，`inconclusive` = 2，其余 = 1。
       *
       * `load-flake`（第五态，ISSUE #1641）落在「其余」里，**这是有意的**：它是
       * 「这一次红了、但归属要隔离复跑才知道」，不是绿 —— 合并前这一跳要的正是
       * 「干净」这个结论，把它折成 0 等于让一次超时假红**放行**一次合并。它的
       * 归属与下一步由 `base-check` 自己的报告说清（本入口只拿退出码）。 */

      const captured = captureStdout(() =>
        baseCheckMany({
          commands,
          ref,
          keep: false,
          json: false,
        }),
      );
      const summary = lastSummary(captured.output);
      const code =
        summary === "current-green" ? 0 : summary === "inconclusive" ? 2 : summary ? 1 : 2;
      results.push({ key, label: seg.label, code, output: captured.output });
      continue;
    }
    if (seg.kind === "anchored" && key !== "claims") {
      /* `mergeLoss` 那一格：锚点**在这里算**，算不出就如实报「没跑起来」。它早先
       * 取不到锚点时被折成 0 ⇒ 记成绿 —— 「没读到」被读成「读过了且没问题」，
       * 折算只留这一个出口（`anchorMissed`）。
       * （`claims` 不在这条路上，理由见下面它自己那一格：它的锚点是**一个区间端点**，
       * 而端点与被审的提交必须在**同一份对象库**里。） */
      const { script, shape } = /** @type {{script: string, shape: "baseline" | "range"}} */ (seg);
      /* **同一次跑里不判两遍**：`base` 段的第二个来源已经带着 `--range <base>..HEAD`
       * 跑过这份脚本了（`base-check/chained-steps.mjs`）。跳过时必须把「在哪儿判的」
       * 打在读数里 —— 安静地少跑一段，与少跑一段本身同形（§13.5.12 那条纪律）。
       * `--light` 把那一条筛掉了，所以去重看的是实际跑过的那批，不是算出来的整批。 */
      if (ranInBase.has(`scripts/${script}`)) {
        results.push({
          key,
          label: seg.label,
          code: 0,
          output:
            "[premerge] 这一段**已在 base 段里判过**（同一份 `--range <base>..HEAD`，" +
            "来自 `base-check/chained-steps.mjs` 的第二来源）—— 不在这里再跑一遍。\n",
        });
        continue;
      }
      const anchor = resolveForkBaseline();
      if (!anchor.ok) {
        const missed = anchorMissed(seg.label, anchor.reason);
        results.push({ key, label: seg.label, ...missed });
        continue;
      }
      const args =
        shape === "range"
          ? /* `<分叉点>..HEAD` = 本次带进来的那一批（不含分叉点本身：它是目标线上
             *    早就存在、早就被审过的一笔）。 */
            [`${anchor.baseline}..HEAD`]
          : ["HEAD", "--baseline", anchor.baseline];
      const r = runScript(script, args);
      results.push({ key, label: seg.label, code: r.code, output: r.output });
      continue;
    }
    if (key === "claims") {
      /* 锚点必须在**这份检出的 cwd** 上算，不是本文件安装位置那一份（`ROOT`）。
       * 本入口自己能 `cd` 进别的检出跑（用例就是这么用的），而
       * `check-commit-claims.mjs` 的 `ROOT = process.cwd()` —— 两侧口径必须同一个，
       * 否则「算出来的分叉点」与「被审的那批」来自两个不同的仓库：实测形态是锚点
       * 取自安装位置那份检出、子进程却审 cwd 那份，于是区间端点在那儿不存在 /
       * 完全对不上，红出来的是「取不到要审的提交」或一条假绿。 */
      const anchor = resolveForkBaseline(process.cwd());
      if (!anchor.ok) {
        const missed = anchorMissed("提交信息里的机械可核声明 ⇄ 树事实（§11.23.5）", anchor.reason);
        results.push({ key, label: "提交信息里的机械可核声明 ⇄ 树事实（§11.23.5）", ...missed });
        continue;
      }
      /* `check-commit-claims.mjs` 的 `ROOT` 是**它自己的 cwd**（`process.cwd()`，
       * 不是本文件这个锚定在自己安装位置上的 `ROOT`）—— 于是「审哪一批」与「在哪儿审」
       * 是同一个问题的一半，另一半是：它读不到 `CNB_PULL_REQUEST_TARGET_SHA`。
       *
       * ⚠️ 后者在**平台**上会变成一条假红（ISSUE #2788 现场）：那一格跑
       * `check:premerge --only=claims`，而平台节点不 fetch `origin/master`，本文件
       * 就用环境里的目标 sha 取到锚点；子进程却拿 `HEAD` 兜底 ⇒ `git log HEAD` 只有
       * 一笔、也永远绿 —— 判的是「最新那笔」(#2070 之前的老形态)，而不是这一批。
       * 所以锚点**由本文件算、按显式区间交给它**：区间端点与 `HEAD` 在同一份对象库，
       * 不依赖它自己能不能读到环境。 */
      const r = runScript(
        "check-commit-claims.mjs",
        [`${anchor.baseline}..HEAD`],
        { CNB_PULL_REQUEST_TARGET_SHA: anchor.baseline },
        process.cwd(),
      );
      results.push({
        key,
        label: "提交信息里的机械可核声明 ⇄ 树事实（§11.23.5）",
        code: r.code,
        output: r.output,
      });
      continue;
    }
    /* `base` / `anchored` / `claims` 都已在上面 `continue`，剩下的是**不需要锚点**的裸脚本段：
     * 目前一段都没有（`claims` 从 #2070 起也要锚点），留着是因为 `SEGMENTS` 的类型
     * 仍然允许 `kind: "script"` —— 将来加一段廉价复查时不必回来改分派。 */
    const scripted = /** @type {{script: string, args: string[]}} */ (seg);
    const r = runScript(scripted.script, scripted.args);
    results.push({ key, label: seg.label, code: r.code, output: r.output });
  }

  const total = combineCodes(results.map((r) => r.code));

  if (json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          code: total,
          segments: results.map(({ key, label, code }) => ({
            key,
            label,
            code,
          })),
        },
        null,
        2,
      )}\n`,
    );
    return total;
  }

  /* 判决行的形状只有一处出处：`scripts/ci-log.mjs` 的三态出口（ISSUE #2506）。
   * 这一跳的**段判**与它自己的三态退出码逐字同口径（`0` 绿 / `1` 红 / `2` 没跑起来）——
   * 从前段头打 `── 段名：绿|红|没跑起来`，与跑批的 `[重档] …红/没跑起来`、
   * 钩子的 `  [ok] ── …` 又是三种说法。 */
  for (const r of results) {
    const state = r.code === 0 ? "ok" : r.code === 1 ? "red" : "skip";
    const detail =
      state === "ok"
        ? "这一段的判据全过"
        : state === "red"
          ? "有判据红了（退出码 1）"
          : "没跑起来（退出码 2）—— 不构成证据，不是红";
    for (const line of renderVerdict({
      state,
      gate: r.label,
      subject: "premerge 段",
      detail,
    })) {
      process.stdout.write(`${line}\n`);
    }
    process.stdout.write(r.output);
  }
  /** @type {"ok" | "red" | "skip"} */
  const state = total === 0 ? "ok" : total === 1 ? "red" : "skip";
  const detail =
    state === "ok" ? "三段全绿" : state === "red" ? "有段红了" : "有段没跑起来（不构成证据）";
  for (const line of renderVerdict({ state, gate: "合并前复算", detail })) {
    process.stdout.write(`\n${line}\n`);
  }
  if (total !== 0) {
    process.stdout.write(
      "[premerge] 这一跳是「我的分支绿 → master 绿」之间唯一的判据（平台侧 squash 不跑本地钩子）。\n" +
        "[premerge] 红的那段逐条看：`yours` 改自己的代码；`baseline-red` 就地收掉或登记；\n" +
        "[premerge] 「没跑起来」先让它真能跑（多数是取不到上游引用 / 浅克隆），别当红读。\n",
    );
  }
  return total;
}

/**
 * 把一次同步调用期间写到 stdout 的内容抓回来。
 *
 * 为什么需要：`baseCheckMany` 是**既有的报告实现**（它自己 `process.stdout.write`
 * 打印那张逐行表），而本脚本要的是「既保留它的报告、又拿到它的结论词」。
 * 抄一份它的报告打印 = 第二份口径（§12.18）；所以只借它的 stdout。
 *
 * @param {() => unknown} fn
 * @returns {{output: string, value: unknown}}
 */
function captureStdout(fn) {
  const original = process.stdout.write.bind(process.stdout);
  let buffer = "";
  /** @type {unknown} */
  let value;
  process.stdout.write = /** @type {typeof process.stdout.write} */ (
    (chunk) => {
      buffer += String(chunk);
      return true;
    }
  );
  try {
    value = fn();
  } finally {
    process.stdout.write = original;
  }
  return { output: buffer, value };
}

/**
 * 从 `base-check` 的报告里读回那个结论词。
 *
 * 它只在最后一行写 `[base-check] 结论：<verdict>`（`reportMany` 的既有输出契约），
 * 所以按**那一行的前缀**取，不做全文匹配 —— 全文匹配会把正文里提到的词（例如
 * 「不许把 127 读成 baseline-red」这类说明）一起命中，读出一个假的结论。
 *
 * @param {string} output
 * @returns {"current-green" | "inconclusive" | "baseline-red" | "yours" | null}
 */
export function lastSummary(output) {
  const line = output
    .split("\n")
    .reverse()
    .find((l) => l.trimStart().startsWith("[base-check] 结论："));
  if (!line) {
    return null;
  }
  const word = line.slice(line.indexOf("结论：") + "结论：".length).trim();
  for (const v of ["current-green", "inconclusive", "baseline-red", "yours"]) {
    if (word.startsWith(v)) {
      return /** @type {never} */ (v);
    }
  }
  return null;
}

/* 只在被直接执行时跑 main（被 import 时只暴露纯函数给用例）。 */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(main(process.argv.slice(2)));
}
