#!/usr/bin/env node
/**
 * check-gate-name-executors.mjs — 「PR 上跑什么」那份清单里的每个名字，**执行者是谁**
 *
 * ── 它治的是哪一类红（ISSUE #2227 的现场）────────────────────────────────
 *
 * `.cnb.yml` 的 `COMFYAPP_CI_GATES` 是「PR 上跑什么」的清单，而「这一格在平台侧归谁执行」
 * 这件事**在配置里只由注释表达**：停用形态（`COMFYAPP_CI_DISABLED_GATES` 登记的那批）与
 * 「换执行者」形态（清单里那几个名字）**都以注释形态留在 `.gates` 里** ⇒ 机器分不出这两者。
 *
 * 于是有一条没人守的缝：把 `tests/core-spine-single-source.test.ts` 从固定清单里删掉 ⇒
 * `core 骨架单一事实源` 的**唯一执行者消失**，而清单照旧说它在 PR 上跑 ⇒ **账面全绿**。
 * 反过来也成立：某个名字从清单里摘掉、它的执行者还在，也没人看见。
 *
 * ── 这一格判什么 ─────────────────────────────────────────────────────────
 *
 *   ① **正向**：清单里的每个名字 ⇒（自己的 stage ｜ 「执行者在别处」的登记）二选一，
 *      且登记的入口路径**真的**在执行面里（复合档条目 / 固定清单用例 / 钩子步骤 /
 *      **GA PR 门禁 step** 四面）。
 *   ② **反向**：登记的每个名字都在清单里、每个入口路径都真在执行面里、且不与「活 stage」重复登记。
 *   ③ **残留**：配置里以注释形态留着、却三处登记都没有的名字 —— 既不是停用也不是在跑。
 *
 * 「执行者在别处」那份登记在 `.cnb.yml` 的 `COMFYAPP_CI_GATES_ELSEWHERE`（键名与
 * `COMFYAPP_CI_DISABLED_GATES` 同一形态），登记的是**入口路径**而不是执行者自己的定义 ——
 * 判据去执行面核那个指针，不抄第二份（§12.12 / §12.18）。
 *
 * ⚠️ **GA PR 门禁那一面是第四面，不是可选的**（ISSUE #3599）：PR 主列的代码判据全在
 * GA 侧（`.cnb.yml` 的 PR 档自 #3378 起只剩「站内回读结论 + 红了立案」两件纯 API 动作），
 * 而另三面一处都不在 GA ⇒ 指向 GA step 的入口路径会被误判成「没有执行者」。
 * 那一面读的是 `.github/workflows/pr-gate.yml` 的 `run:` 行。
 *
 * 退出码：`0` 通过；`1` 有不一致（逐条点名）。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { readHookSteps } from "./base-check/hook-steps.mjs";
import { HEAVY_GATES } from "./ci-heavy-gates.mjs";
import { gateNameExecutorProblems, gaWorkflowStepArgvs } from "./ci-gate-names.mjs";
import { parseStageScripts, readCnbConfig } from "./ci-autofix-duties.mjs";
import { FIXED_STRUCTURAL_TESTS } from "./fixed-structural-tests.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

/** GA 的 PR 质量门禁 workflow（PR 主列的代码判据都在它里面）。 */
const GA_PR_WORKFLOW = ".github/workflows/pr-gate.yml";

/**
 * 第四面：GA PR 门禁的 step 行。
 *
 * 读不到那份文件 ⇒ 那一面为空（**不是「有执行者」**）—— 判据要的是「这个入口路径真的会
 * 被跑」的正面读数，取不到执行面就当没有。
 *
 * @param {string} root 检出根
 * @returns {Array<{argv: string[]}>}
 */
function readGaSteps(root) {
  try {
    const text = fs.readFileSync(path.join(root, GA_PR_WORKFLOW), "utf8");
    return gaWorkflowStepArgvs(text).map((argv) => ({ argv }));
  } catch {
    return [];
  }
}

/**
 * 入口。
 *
 * @param {{root?: string}} [io]
 * @returns {number} 退出码
 */
export function main(io = {}) {
  const root = io.root ?? ROOT;
  const cnbText = readCnbConfig(root);
  /* 活 stage = `.gates` 里没被注释掉的那些（`parseStageScripts` 只认活的）。 */
  const liveStages = [...parseStageScripts(cnbText).keys()];
  const hookSteps = readHookSteps(path.join(root, ".githooks", "pre-commit"));
  const problems = gateNameExecutorProblems({
    cnbText,
    liveStages,
    heavyGates: HEAVY_GATES,
    fixedTests: FIXED_STRUCTURAL_TESTS,
    hookSteps,
    gaSteps: readGaSteps(root),
  });
  if (problems.length > 0) {
    for (const p of problems) {
      process.stderr.write(`[gate-name-executors] ✗ ${p}\n`);
    }
    process.stderr.write(
      `[gate-name-executors] 本档**不通过**：${problems.length} 处对不上。` +
        "「PR 上跑什么」的清单与「谁真的会跑它」必须对得上 —— " +
        "否则「换了执行者」与「执行者没了」在配置里长得一模一样，账面全绿。\n",
    );
    return 1;
  }
  process.stdout.write(
    "[gate-name-executors] ✓ 清单里的每个名字都有执行者，且登记与执行面逐条对得上。\n",
  );
  return 0;
}

/* 只在被直接执行时跑 main（被 import 时只暴露纯函数给用例）。 */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(main());
}
