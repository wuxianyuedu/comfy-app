#!/usr/bin/env node
/**
 * visual-gate.mjs — 改了像素层才跑的提交门禁（规范 §11.8 那条 ⚠️ 的机器形态）
 *
 * 补的是「改像素层的提交必须显式跑一次 vitest」这句一直只有文档口径的洞。
 *
 * 现场（#6538809）：那一批删掉了 `-linux.png` 两张基线、同时把
 * `SUPPORTED_PLATFORMS` 收成 win32，并**新建** `tests/visual-baseline-pairing.test.ts`。
 * 提交者从 `pnpm test:e2e` 的通过数读到的结论是「像素层没事」—— 而像素层的判据当时
 * 一条都没跑到（它只在 `pnpm test` 里，没进固定清单）。更糟的是 `--grep @critical`
 * 是规范 §11.7 写着的那一条，而它**一条视觉用例都不含**（视觉 spec 没有 `@critical`
 * 标签）：把门禁跑绿与像素层没坏，是两件毫不相干的事。
 *
 * 为什么不在这里再起一次 vite：C 组已经起了（`run-affected-tests.mjs`），
 * 钩子那一档刻意只起一次冷启（§13.5 的口径）。所以本步判的不是「你有没有手跑 vitest」
 * ——那是一句无法观测的话——而是**本次提交要跑的那份清单里，像素层的判据在不在**：
 * 像素层有改动，而 `tests/visual-baseline-pairing.test.ts` 不在 C 组清单里 = 本次提交
 * 不带着任何像素层判决进历史，直接阻断。清单读的是**同一份唯一出处**
 * （`affected-tests.mjs` 的 `resolveAffectedTests` 与 `FIXED_STRUCTURAL_TESTS`，
 * §12.18：不另算一份收窄规则），所以「有人把这条判据从固定清单里摘掉」当场被拦住，
 * 而不是等到下一次像素层出事才发现判据没有执行者。
 *
 * 触发面刻意很窄：只有暂存改动命中像素层（`e2e/visual/**`）才做事，普通提交零输出、
 * 零退出（同 `shell-gate.mjs` —— 这一步不该给任何人加一毫秒）。
 *
 * 用法：`node scripts/visual-gate.mjs`（由 `.githooks/pre-commit` 的 D 组调用）
 *      `node scripts/visual-gate.mjs --staged a b c`（手工指定清单，调试用）
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  isSourcePath,
  isTestPath,
  resolveAffectedTests,
} from "./affected-tests.mjs";
import { KNOWN_FAILED_CASES } from "./quality-gate-shared.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** 像素层判据：核「每个截图名 × 每个登记平台都有 PNG / 全部入库 / 无孤儿」的那条。 */
export const PIXEL_JUDGE = "tests/visual-baseline-pairing.test.ts";

/**
 * 像素层的改动面。口径是「改了会动到像素判决的东西」：
 *   · `e2e/visual/**` —— spec 声明的截图名、`*-snapshots/**` 的基线 PNG（两者都在）；
 *   · 平台登记在判据自己身上（`SUPPORTED_PLATFORMS` + `BASENAME_RE`），所以改判据本身
 *     也算（改它 = 改「哪些基线算数」），由下面那条单独匹配。
 * 宽了一档没坏处（多跑一次本步、几十毫秒），窄了才是 #6538809 那个状态。
 */
export const PIXEL_LAYER_RE = /^e2e\/visual\//;

/** `playwright.config.ts` / 视觉 spec 的公共装配也算像素层输入（webServer / 截图阈值）。 */
export const PIXEL_CONFIG_RE = /^playwright\.config\.ts$/;

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
 * 这次提交碰没碰像素层。
 * @param {string[]} staged
 * @returns {boolean}
 */
export function touchesPixelLayer(staged) {
  return staged.some(
    (f) => PIXEL_LAYER_RE.test(f) || PIXEL_CONFIG_RE.test(f),
  );
}

/**
 * 判决本体：给定清单与「本次要跑哪些用例」，决定退出码与理由。
 *
 * 抽成纯入口是为了让**判决可被执行**（同 `shell-gate.mjs` 的 `runGate`，
 * 先例见 ISSUE #1356：源码文本断言不是执行记录）。清单由调用方注入，
 * 所以用例能直接喂「像素层改动 + 清单里没有像素判据」这种形状。
 *
 * @param {{staged: string[], tests: string[]}} input
 * @returns {{exitCode: number, problem: string | null}}
 */
export function runGate({ staged, tests }) {
  if (!touchesPixelLayer(staged)) return { exitCode: 0, problem: null };
  if (tests.includes(PIXEL_JUDGE)) return { exitCode: 0, problem: null };
  const touched = staged.filter(
    (f) => PIXEL_LAYER_RE.test(f) || PIXEL_CONFIG_RE.test(f),
  );
  return {
    exitCode: 1,
    problem:
      `本次提交改了像素层（${touched.slice(0, 3).join("、")}` +
      `${touched.length > 3 ? " 等" : ""}），但本次要跑的用例里没有 ${PIXEL_JUDGE}。\n` +
      "        像素层的判决只能来自 vitest —— e2e 的通过数证明不了它：`--grep @critical`\n" +
      "        一条视觉用例都不含（视觉 spec 没有 @critical 标签，规范 §11.7 那条是它）。\n" +
      "        修法：把这条判据放回 scripts/affected-tests.mjs 的 FIXED_STRUCTURAL_TESTS\n" +
      "        （它是「每次提交都跑」那份清单的成员），或按 §13.5.8 重跑一次 C 组。",
  };
}

/** 读测试清单与 import 图节点（与 affected-tests 同一份口径，不另立收窄规则）。 */
function collectInputs() {
  const tracked = spawnSync("git", ["ls-files"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (tracked.status !== 0) return null;
  const all = tracked.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    testFiles: all.filter(isTestPath),
    sourceFiles: all.filter(isSourcePath),
  };
}

/**
 * 本次提交要跑的用例清单（跑法与 C 组逐字同一份，含宽口径的放弃收窄）。
 *
 * @param {string[]} staged 暂存改动清单
 * @param {{testFiles: string[], sourceFiles: string[]}} inputs 用例候选与 import 图节点
 * @param {(rel: string) => string | null} readText 读仓库内文件文本（注入口，便于用例喂夹具）
 * @returns {string[]}
 */
export function plannedTests(staged, inputs, readText) {
  return resolveAffectedTests({
    changedPaths: staged,
    testFiles: inputs.testFiles,
    sourceFiles: inputs.sourceFiles,
    readText,
    knownFailedCases: KNOWN_FAILED_CASES,
  }).tests;
}

/**
 * @param {string} rel
 * @returns {string | null}
 */
function defaultReadText(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    return null;
  }
}

function main() {
  const argv = process.argv.slice(2);
  const si = argv.indexOf("--staged");
  const staged = si >= 0 ? argv.slice(si + 1) : stagedFiles();
  if (!touchesPixelLayer(staged)) return 0;

  const inputs = collectInputs();
  if (inputs === null) {
    console.error(
      "[visual-gate] ✗ 读不到测试清单（git ls-files 失败）—— 判不出的形状按不放行处理",
    );
    return 1;
  }

  console.log("[visual-gate] 暂存改动命中像素层，开始判「这次提交带不带像素判决」：");
  const result = runGate({
    staged,
    tests: plannedTests(staged, inputs, defaultReadText),
  });
  if (result.problem) {
    console.error(`[visual-gate] ✗ ${result.problem}`);
    return result.exitCode;
  }
  console.log(
    `  [ok] 本次清单含 ${PIXEL_JUDGE}（C 组会跑它；e2e 的通过数不作为像素层结论）`,
  );
  return 0;
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) ===
    fs.realpathSync(fileURLToPath(import.meta.url))
) {
  process.exit(main());
}
