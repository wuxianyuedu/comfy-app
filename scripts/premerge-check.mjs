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
 *   pnpm check:premerge --light         # 复算只跑本地形态档那几条（跳过条数会被打印出来）
 *   pnpm check:premerge --json          # 机器可读（逐段给结论）
 *   pnpm check:premerge --skip-claims   # 只跑复算 + 合并面（PR 里还没写合并信息时）
 *   pnpm check:premerge --only=base     # 只跑一段（排查用）
 */
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  baseCheckMany,
  isGitCheckout,
  resolveMergeBaseRef,
  resolveMergeBatch,
} from "./base-check.mjs";
import { localTierLabels } from "./base-check/hook-steps.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
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
 * —— 见 `resolveLossBaseline()`。早先的写法是 `args: []`，于是这一段**恒退 2**
 * （`check-merged-side-loss.mjs` 缺 `--baseline` 直接 exit 2），整个入口因此
 * **恒报「不构成证据」** —— 恰好是这套编排要消灭的那类静默失效
 * （看着在跑、事实一次没复算）。口径与出口见 §13.6.2.1。
 *
 * ⚠️ **它被导出只为一件事**：`tests/premerge-check.test.ts` 那条「各段全被跳过 ⇒ 退 2」
 * 的跳过清单**从这里推**，不硬写名单 —— 硬写的话，加第四段时那条用例会继续绿着、
 * 而它其实漏了一段没跳。从段表推 ⇒ 加一段就必须同时处理它，否则当场红。
 *
 * @type {Record<string, {label: string, kind: "base"} | {label: string, kind: "script", script: string, args: string[]} | {label: string, kind: "anchored", script: string}>}
 */
export const SEGMENTS = {
  base: {
    label: "合并前复算（钩子里那批全仓判据）",
    kind: "base",
  },
  claims: {
    label: "提交信息里的机械可核声明 ⇄ 树事实（§11.23.5）",
    kind: "script",
    script: "check-commit-claims.mjs",
    args: [],
  },
  mergeLoss: {
    label: "合并有没有把一侧整份覆盖掉（#1617）",
    kind: "anchored",
    script: "check-merged-side-loss.mjs",
  },
};

/**
 * 给「合并有没有丢一侧」那一格**算**出它的锚点（`--baseline`）。
 *
 * 锚点是什么：**这条线从哪一刻起与要并进去的那条分开的** —— 也就是
 * `merge-base(<要并进去的那条>, HEAD)`。`check-merged-side-loss.mjs` 判的是
 * 「结果版是不是退回了基线之前的某一版」，所以「基线」= **分叉点**，不是
 * `origin/master` 的尖端：拿后者会把分支侧自己的正当改动整片读成差异。
 *
 * 为什么在这里算、而不是让判据自己算：判据的**天真形态**（自己推被丢的那一侧是谁）
 * 在 `ad81a912` 上实测 128 份改动 → **0 命中**（那条线在 squash 之后常常已不可达）。
 * 但「分叉点」与那个不是同一个问题 —— 它**是**可算的，且正是判据需要的语义。
 * 这与 `.githooks/prepare-commit-msg` 那条提交前档同源（那边用 `MERGE_HEAD` + merge-base）。
 *
 * @returns {{ok: true, baseline: string} | {ok: false, reason: string}}
 */
export function resolveLossBaseline(cwd = ROOT) {
  const ref = resolveMergeBaseRef(cwd);
  if (!ref) {
    return {
      ok: false,
      reason:
        "取不到要并进去的那条（各 remote 的 master / 本地 master）—— 先 `git fetch` 再跑",
    };
  }
  try {
    /* 只读一条 git 命令；失败 ⇒ 历史不全（浅克隆）⇒ 如实报「没跑起来」，不问「红没红」。 */
    const base = execFileSync("git", ["merge-base", ref, "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!base) {
      return {
        ok: false,
        reason: `算不出 ${ref} 与 HEAD 的分叉点（浅克隆 / 历史不全）`,
      };
    }
    return { ok: true, baseline: base };
  } catch {
    return {
      ok: false,
      reason: `算不出 ${ref} 与 HEAD 的分叉点（浅克隆 / 历史不全）`,
    };
  }
}

/**
 * @param {string[]} argv
 * @returns {{json: boolean, only: string | null, skip: Set<string>, light: boolean}}
 */
function parseArgs(argv) {
  /** @type {{json: boolean, only: string | null, skip: Set<string>, light: boolean}} */
  const out = { json: false, only: null, skip: new Set(), light: false };
  for (const a of argv) {
    if (a === "--json") out.json = true;
    else if (a === "--light") out.light = true;
    else if (a.startsWith("--only=")) out.only = a.slice("--only=".length);
    else if (a.startsWith("--skip-")) out.skip.add(a.slice("--skip-".length));
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
 * @param {string} script
 * @param {string[]} args
 * @returns {{code: number, output: string}}
 */
function runScript(script, args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [path.join(HERE, script), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CI: "1", ...extraEnv },
  });
  /* Node 自己在 `MODULE_NOT_FOUND` 时也退 1 —— 与「判据红了」同形。所以「没跑起来」
   * 由**两路输出全空**（脚本连一行都没打出来）兜一层，再归一成 2。
   * 这条与 `base-check.mjs` 的 `commandTargetState` 是同一族口径（§13.6.2）。 */
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (
    typeof r.status !== "number" ||
    (r.status !== 0 && output.trim() === "")
  ) {
    return {
      code: 2,
      output: output || `[premerge] ${script} 没有跑起来（无输出）\n`,
    };
  }
  return { code: r.status, output };
}

/**
 * 合成各段的总码：**2 优先于 1**（没法归因的读数不许被当成结论）。
 *
 * @param {number[]} codes
 * @returns {number}
 */
export function combineCodes(codes) {
  if (codes.includes(2)) return 2;
  if (codes.includes(1)) return 1;
  return 0;
}

/**
 * @param {string[]} argv
 * @returns {number} 退出码
 */
function main(argv) {
  const { json, only, skip, light: lightRecompute } = parseArgs(argv);

  if (!isGitCheckout(ROOT)) {
    process.stderr.write(
      "[premerge] 当前目录不是 git 检出 —— 「合并前复算」没有基线可比（退 2）\n",
    );
    return 2;
  }

  const wanted = Object.entries(SEGMENTS).filter(([key]) => {
    if (only) return key === only;
    return !skip.has(key);
  });
  if (wanted.length === 0) {
    process.stderr.write(
      "[premerge] 各段全被跳过 —— 没有任何东西被复算（退 2）\n",
    );
    return 2;
  }

  /** @type {Array<{key: string, label: string, code: number, output: string}>} */
  const results = [];

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
      const batch = resolveMergeBatch(
        [],
        path.join(ROOT, ".githooks", "pre-commit"),
      );
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
        summary === "current-green"
          ? 0
          : summary === "inconclusive"
            ? 2
            : summary
              ? 1
              : 2;
      results.push({ key, label: seg.label, code, output: captured.output });
      continue;
    }
    if (seg.kind === "anchored") {
      /* 带锚点的那一格（`mergeLoss`）：锚点**在这里算**，算不出就如实报「没跑起来」。
       * 早先它是裸 `script` + `args: []`，于是恒退 2、整个入口恒「不构成证据」
       * —— 见 `SEGMENTS` 那条注释。 */
      const { script } = /** @type {{script: string}} */ (seg);
      const anchor = resolveLossBaseline();
      if (!anchor.ok) {
        results.push({ key, label: seg.label, code: 0, output: "" });
        continue;
      }
      const r = runScript(script, [`HEAD`, "--baseline", anchor.baseline]);
      results.push({ key, label: seg.label, code: r.code, output: r.output });
      continue;
    }
    /* `base` / `anchored` 都已在上面 `continue`，这里收窄到裸 script 那两段。 */
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

  for (const r of results) {
    const mark = r.code === 0 ? "绿" : r.code === 1 ? "红" : "没跑起来";
    process.stdout.write(`\n[premerge] ── ${r.label}：${mark}\n`);
    process.stdout.write(r.output);
  }
  process.stdout.write(
    `\n[premerge] 结论：${total === 0 ? "全绿" : total === 1 ? "有段红了" : "有段没跑起来（不构成证据）"}\n`,
  );
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
  if (!line) return null;
  const word = line.slice(line.indexOf("结论：") + "结论：".length).trim();
  for (const v of ["current-green", "inconclusive", "baseline-red", "yours"]) {
    if (word.startsWith(v)) return /** @type {never} */ (v);
  }
  return null;
}

/* 只在被直接执行时跑 main（被 import 时只暴露纯函数给用例）。 */
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  process.exit(main(process.argv.slice(2)));
}
