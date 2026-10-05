#!/usr/bin/env node
/**
 * known-failed-selftest-gate.mjs — 改了「已知基线失败登记」这套机制才跑的提交门禁
 * （规范 §11.12 / ISSUE #1282）
 *
 * 补的是这套机制的**第二个空档**，与 `visual-gate.mjs` / `shell-gate.mjs` 同形：
 * 机制本体（`check-known-failed-stale.mjs`）在 pre-commit 里有执行者、也真的每次跑，
 * 但**它只在清单非空时才真跑**（空表是终态、是常态 ⇒ 零耗时直接 `return 0`）。
 * 于是「真跑那一档」在干净仓库上**从来没有被执行过**，而它唯一的自证入口
 * `--self-test` 更是**一个执行者都没有** —— 全仓 grep 不到任何调用点。
 *
 * 为什么这不是「再加一层保险」而是补一个真洞（两条都实测过，别只信一条）：
 *
 *   ① 把 `runRegistered()` 的 `--reporter=json` 改成 `--reporter=jsonx`（模拟「vitest
 *      某次升级把 reporter 改名」这类真实失效）⇒ `--self-test` **当场红**，
 *      而 `tests/known-failed-stale.test.ts` **11 条全绿**。用例是**喂夹具**，它永远
 *      看不到真实的 vitest 调用参数；只有端到端真跑才知道命令还起不起得来。
 *   ② 把 `judgeStillFailing()` 改成恒 `return { exitCode: 0 }`（判据彻底失效）⇒
 *      用例红（它喂夹具，抓得到），而**旧版 `--self-test` 照样绿** —— 它原本只验
 *      「红的那条判成红」，判据恒放行时红侧当然也放行。放行是判据的默认动作，
 *      能证明它**还会拦**的只有一条它必须拦下来的输入（本次补上的绿侧对照组）。
 *
 * ⇒ 两侧各有各的盲区、且互为补集，所以**两个都得有执行者**。这条门禁就是给
 * `--self-test` 的执行者。
 *
 * 触发面刻意很窄（同 `shell-gate.mjs` 的口径）：只有暂存改动命中**这套机制本身**时
 * 才做事，普通提交零输出、零耗时。代价实测 ~0.9s（一次真 vitest 冷启），
 * 只落在「正在动这套机制」的提交上 —— §13.5.8「不给无关提交加时间」。
 *
 * 用法：`node scripts/known-failed-selftest-gate.mjs`（由 `.githooks/pre-commit` 的 D 组调用）
 *      `node scripts/known-failed-selftest-gate.mjs --staged a b c`（手工指定清单，调试用）
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/**
 * 这套机制的输入面（改了任一处 = 这次的提交在动「登记过期」这件事）：
 *   · 登记表本体（`KNOWN_FAILED_FILES` 的单点定义）；
 *   · 判据本体（真跑的调用参数、判决逻辑都在它里面）；
 *   · 钩子接线（这一步有没有被接上，只有它自己知道）。
 * 宽一档没坏处（多跑一次 ~0.9s），窄了才会漏。
 */
export const MECHANISM_RE =
  /^(?:scripts\/quality-gate-shared\.mjs|scripts\/check-known-failed-stale\.mjs|\.githooks\/pre-commit)$/;

/** 判据本体（`--self-test` 就是它的自证档）。 */
export const GATE_SCRIPT = "scripts/check-known-failed-stale.mjs";

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
 * 这次提交碰没碰这套机制。
 * @param {string[]} staged
 * @returns {boolean}
 */
export function touchesMechanism(staged) {
  return staged.some((f) => MECHANISM_RE.test(f));
}

/**
 * 判决本体：给定清单与「自证跑出来的结果」，决定退出码与理由。
 *
 * 抽成纯入口是为了让**判决可被执行**（同 `visual-gate.mjs` 的 `runGate`、
 * `shell-gate.mjs` 的 `runGate`；先例见 ISSUE #1356：源码文本断言不是执行记录）——
 * 这样用例能直接喂「碰了机制 + 自证红了」这种形状，而不必每次真起 vitest。
 *
 * @param {{staged: string[], selfTest: {status: number | null, stdout: string, stderr: string} | null}} input
 *        `selfTest` 为 null = 还没跑（调用方没跑就判 = 判不了，按不放行处理）。
 * @returns {{exitCode: number, problem: string | null, touched: string[]}}
 */
export function runGate({ staged, selfTest }) {
  const touched = staged.filter((f) => MECHANISM_RE.test(f));
  if (touched.length === 0) {
    return { exitCode: 0, problem: null, touched: [] };
  }
  if (selfTest === null) {
    return {
      exitCode: 1,
      touched,
      problem:
        "本次提交改了「已知基线失败登记」这套机制，但没有拿到自证读数 —— " +
        "判不了的形状按不放行处理。",
    };
  }
  if (selfTest.status !== 0) {
    const tail = (selfTest.stdout + selfTest.stderr)
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-12)
      .join("\n        ");
    return {
      exitCode: 1,
      touched,
      problem:
        `自证红了（exit ${selfTest.status}）—— 这套机制的「真跑那一档」坏了，` +
        "而它判的是**下一次别线登记**能不能被正确判过期。\n" +
        `        现场：node ${GATE_SCRIPT} --self-test\n` +
        `        ${tail}`,
    };
  }
  return { exitCode: 0, problem: null, touched };
}

/** 真跑自证（端到端：造探针 → 起 vitest → 读证据 → 判两侧）。 */
function runSelfTest() {
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, GATE_SCRIPT), "--self-test"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 },
  );
  if (r.error) {
    return {
      status: null,
      stdout: "",
      stderr: `起自证失败：${r.error.message}`,
    };
  }
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function main() {
  const argv = process.argv.slice(2);
  const si = argv.indexOf("--staged");
  const staged = si >= 0 ? argv.slice(si + 1) : stagedFiles();
  if (!touchesMechanism(staged)) return 0;

  console.log(
    "[known-failed-selftest] 暂存改动命中「已知基线失败登记」机制，跑一次自证：",
  );
  const result = runGate({ staged, selfTest: runSelfTest() });
  if (result.problem) {
    console.error(`  ✗ ${result.problem}`);
    return result.exitCode;
  }
  console.log(
    `  [ok] 自证通过（命中 ${result.touched.join("、")}）—— 「真跑那一档」与它的对照组都还在`,
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
