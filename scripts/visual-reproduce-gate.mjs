#!/usr/bin/env node
/**
 * visual-reproduce-gate.mjs — 「换了像素基线 ⇒ 领一张自证欠账」的提交门禁（规范 §11.8）
 *
 * 补的是本轮实测翻出来的一条**假绿**：入库的 `-linux.png` 有几张与当时环境差 1 像素
 * （文字整体下移一行），而它**没有任何判据能发现** ——
 *   · `playwright test --update-snapshots` 总是绿（把基线改写成当次实况）；
 *   · 配对判据只核「截图名 × 平台成套且入库」，不核「这套 PNG 现在还跑得绿」；
 *   · `pixel-run.mjs` 的 `--update` 档按设计不拦缺基线（那是它的本分）。
 * 于是「录一版、把仓库基线换成它」这条路上一个判据都没有，换掉的是**别人的档**。
 *
 * 本步的形状（与 `shell-gate.mjs` / `visual-gate.mjs` 同族：触发面窄、判决可执行）：
 *   ① 暂存改动命中任何一张基线 PNG（且**不是**纯新增 —— 新增走配对判据那条线）；
 *   ② 本次提交必须同时带来一条欠账记录（`scripts/.visual-reproduce-ledger.json`），
 *      记录里的基线清单逐字等于本次动过的 PNG、platform 在登记口径里、reason 写清原因；
 *   ③ 三者任一不满足即阻断，话术里给出「怎么记」与「怎么自证」两条命令。
 *
 * **为什么不在钩子里直接跑一遍像素**：`pixel-run.mjs` 要起 webServer + 浏览器，与
 * 钩子里的 A/B/C/D 抢资源（§13.5 的并行预算是实测敏感项）。钩子只做它能做的那件事
 * ——**不许静默换基线**：留下可被审的欠账，自证由勾子在 PR / Issue 里召唤。
 *
 * 用法：`node scripts/visual-reproduce-gate.mjs`（由 `.githooks/pre-commit` 的 D 组调用）
 *
 * 普通提交（没碰基线 PNG）零输出、零耗时 —— 与 `visual-gate.mjs` 同一条纪律。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  REPRODUCE_LEDGER,
  changedBaselines,
  checkReproduceDebt,
  reproduceDebtRecord,
  visualSpecs,
} from "./visual-baselines.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** 读暂存区文件清单（相对仓库根、正斜杠）。 */
export function stagedFiles() {
  const out = spawnSync("git", ["diff", "--cached", "--name-only"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (out.status !== 0) return [];
  return out.stdout.split(/\r?\n/).filter(Boolean);
}

/**
 * 合并态下补上「被合进来那一侧带进来的基线」。
 *
 * `git diff --cached --name-only` 在合并提交里报的是**相对第一父（HEAD）**的整份差 ——
 * 于是由对方分支（第二父）带进本次合并的基线 PNG 一个字都不出现：本地跑到的结论是
 * 「一张基线都没动，却留着欠账」，与事实相反（欠账正是那些基线的凭据）。表现是一个
 * 合法的合并提交被**永久拦死**，且话术指向「上一批忘了抹账」这个不存在的病因。
 *
 * 判据与 `shell-gate.mjs` 的 `dropAdoptedShellInputs` 同族（§12.18：不写第二份判
 * 「合并态下谁算改动」的逻辑）：合并态下**与第二父也不同**的基线同样算法定改动。
 * 非合并态 / 非基线路径原样返回，判决面一行都不放宽。
 *
 * @param {string[]} staged `git diff --cached --name-only` 的结果。
 * @param {string} [repoRoot] 仓库根（默认本仓库；单测传临时仓库）。
 * @returns {string[]} 补全后的清单；非合并态原样返回。
 */
export function withMergeHeadBaselines(staged, repoRoot = ROOT) {
  /* 用 `rev-parse` 而不是 `.git/MERGE_HEAD` 路径：worktree / submodule 里 `.git` 是个
   * 文件，拼路径会静默落空（`shell-gate.mjs` 那处同形，但那条判据只在主工作区跑）。
   * 读不到 = 非合并态，原样返回。 */
  const head = spawnSync(
    "git",
    ["-C", repoRoot, "rev-parse", "--verify", "MERGE_HEAD"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const mergeHead = head.status === 0 ? head.stdout.trim() : "";
  if (!mergeHead) return staged;
  const out = new Set(staged);
  /* 只看基线 PNG 所在的那些目录（与 `changedBaselines` 同一份识别面），不逐文件问 git。 */
  const dirs = new Set(visualSpecs(repoRoot).map(({ shotDir }) => shotDir));
  const listed = spawnSync(
    "git",
    ["-C", repoRoot, "diff", "--name-only", mergeHead],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (listed.status !== 0) return staged;
  for (const rel of listed.stdout.split(/\r?\n/).filter(Boolean)) {
    const dir = rel.slice(0, rel.lastIndexOf("/"));
    if (dirs.has(dir)) out.add(rel);
  }
  return [...out];
}

/** 读欠账记录（不存在 / 读不出 → null，由判决把它当成「没领账」）。 */
export function readDebt(root = ROOT) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(root, REPRODUCE_LEDGER), "utf8"),
    );
  } catch {
    return null;
  }
}

/**
 * 判决本体：给定「本次动过的基线」与「欠账记录」，决定退出码与理由。
 *
 * 抽成纯入口是为了让**判决可被执行**（同 `visual-gate.mjs` 的 `runGate` 先例）：
 * 不接输入的话，「永远说没问题」这一层静默退化不会有任何东西红。
 *
 * @param {{changed: string[], debt: unknown}} input
 * @returns {{exitCode: number, problem: string | null}}
 */
export function runGate({ changed, debt }) {
  /* 判决**整个**委托给清点内核的 `checkReproduceDebt`，自己不另立一条短路：
   * 短路 `changed.length === 0` 会把「没动基线却留着欠账」那一格静默放过 ——
   * 而那一格正是「上一批自证完忘了抹账」的形态（欠账单会退化成没人删的名单）。 */
  const problems = checkReproduceDebt({ changed, debt });
  if (problems.length === 0) return { exitCode: 0, problem: null };
  return { exitCode: 1, problem: problems.join("\n      · ") };
}

/** 领账：把本次动过的基线写进欠账单（`--record` 是**给人用的**，不进钩子）。 */
function record() {
  const changed = changedBaselines(withMergeHeadBaselines(stagedFiles()), ROOT);
  if (changed.length === 0) {
    console.error(
      "[visual-reproduce-gate] ✗ 暂存区里没有**已修改**的基线 PNG —— 先 `git add <png>`，" +
        "或用 `--record <platform> <原因>` 手工记一条。",
    );
    return 1;
  }
  const [platform = "", ...reasonParts] = process.argv.slice(3);
  const reason = reasonParts.join(" ").trim();
  const record_ = reproduceDebtRecord({ baselines: changed, reason, platform });
  const problems = checkReproduceDebt({ changed, debt: record_ });
  if (problems.length > 0) {
    console.error("[visual-reproduce-gate] ✗ 领不了这张账：");
    for (const p of problems) console.error("  - " + p);
    console.error(
      "\n  用法：node scripts/visual-reproduce-gate.mjs --record <平台> <界面为什么变>\n" +
        "        平台取登记口径里的那一档（scripts/visual-baselines.mjs 的 PLATFORM_RECORDING）",
    );
    return 1;
  }
  fs.writeFileSync(
    path.join(ROOT, REPRODUCE_LEDGER),
    JSON.stringify(record_, null, 2) + "\n",
    "utf8",
  );
  console.log(
    `[visual-reproduce-gate] ✓ 已记下欠账（${record_.baselines.length} 张 / ${record_.platform}）：${REPRODUCE_LEDGER}\n` +
      "        提交前请在同档机器上 `pnpm check:visual:update`（重录）→ `pnpm check:visual`（自证连跑两次都绿），\n" +
      "        然后 **把这条欠账删掉**（它是负债，补齐即抹账）。",
  );
  return 0;
}

function main() {
  if (process.argv[2] === "--record") return record();
  const changed = changedBaselines(withMergeHeadBaselines(stagedFiles()), ROOT);
  const result = runGate({ changed, debt: readDebt() });
  if (result.problem) {
    console.error(
      `[visual-reproduce-gate] ✗ 本次提交换了像素基线（${changed.slice(0, 3).join("、")}` +
        `${changed.length > 3 ? " 等" : ""}），但欠账对不上：\n      · ${result.problem}\n` +
        "        记账：`node scripts/visual-reproduce-gate.mjs --record <平台> <界面为什么变>`\n" +
        "        自证：`pnpm check:visual:update` → `pnpm check:visual`（连跑两次都绿），\n" +
        "        完成后删掉欠账文件（负债补齐即抹账）。规范：docs/standards/11-测试与可观测性.md §11.8",
    );
    return result.exitCode;
  }
  if (changed.length > 0) {
    console.log(
      `  [ok] 本次换了 ${changed.length} 张基线，欠账记录与它对得上（自证在同档机器上完成后再删这条账）`,
    );
  }
  return 0;
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) ===
    fs.realpathSync(fileURLToPath(import.meta.url))
) {
  process.exit(main());
}
