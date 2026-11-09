#!/usr/bin/env node
/**
 * known-failed-selftest-gate.mjs — 改了「已知基线失败登记」这套机制才跑的提交门禁
 * （规范 §11.12 / ISSUE #1282）
 *
 * 补的是这套机制的**第二个空档**，与 `shell-gate.mjs` 同形：
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
 *      `node scripts/known-failed-selftest-gate.mjs --base <ref>`（**以 PR diff 为判决面**，平台侧那一档）
 *
 * ── `--base <ref>`：换判决面的来源（ISSUE #2265 的现场）──────────────────────
 *
 * 这一步的判决面是「**本次改了什么**」，而本地形态从**暂存区**取那个面 —— 平台上没有
 * 暂存区，于是 `touchesMechanism` 恒假 ⇒ 这一步在平台上**恒绿且一个字都不打**
 * （而它在本地是有牙齿的：「碰了这套机制就跑一次自证」在平台侧一个执行者都没有）。
 *
 * `--base <ref>` 换一个**判决面的来源**：「相对那条基线改了什么」—— 平台上拿得到
 * （PR 事件上平台给 `CNB_PULL_REQUEST_TARGET_SHA`，由 `scripts/changed-scope.mjs`
 * 统一选基线，与「受影响用例」那一格、`shell-gate` 同一份口径）。判决链一字未改。
 *
 * ⚠️ 两条边界：
 *   · **判决面取不到 ⇒ 退 2，不是退 0**（仓库三态：0 绿 / 1 红 / 2 没跑起来）。
 *     「没有输入可判」与「判过了、没问题」是两件事 —— 退 0 会被复合档计成「绿」。
 *   · **没碰到机制也要说一句话**。此前这一步在「没碰到」时**一个字都不打** ⇒ 在平台上
 *     它与「真的判过了」逐字同形。现在它会念出判决面与清单条数。
 *
 * ⚠️ **空清单不是「取不到」**：在 `--base` 形态下，基线取到了、diff 跑成功了、结果是空
 * ⇒ 那是**成功测得「这次什么都没改」** ⇒ 没有可判的内容 ⇒ 绿（并把「0 个文件」念出来）。
 * 只有「暂存集为空」那种形态才算「取不到面」—— 那里根本没有一次提交。
 * （把空清单一律读成「不知道」会让 master 上的本地复算永远退 2 —— 那正是
 * 「降档不许被读成全套过了」的忌讳。）
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { changedFilesForBaseRef } from "./changed-scope.mjs";
import { intentionalEmptyCommit } from "./intentional-empty-commit.mjs";

const HERE = import.meta.dirname;
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
  /* `-c core.quotePath=false`：路径要原样（ISSUE #2272，机制见 `scripts/changed-scope.mjs`
   * 的文件头「口径 ④」）。 */
  const out = spawnSync("git", ["-c", "core.quotePath=false", "diff", "--cached", "--name-only"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (out.status !== 0) {
    return [];
  }
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
 * 抽成纯入口是为了让**判决可被执行**（同 `shell-gate.mjs` 的 `runGate`、
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
  const r = spawnSync(process.execPath, [path.join(ROOT, GATE_SCRIPT), "--self-test"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 << 20,
  });
  if (r.error) {
    return {
      status: null,
      stdout: "",
      stderr: `起自证失败：${r.error.message}`,
    };
  }
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/**
 * 判决面：这一次「改了哪些文件」。
 *
 * 两个来源，**互斥**（判据只该看到一个来源 —— 两个都挂着，「到底按哪个面判」就变成读代码的事）：
 *   · `--base <ref>` ⇒ 「相对那条基线改了什么」（平台侧那一档）；
 *   · 暂存区（本地那一跳；`--staged a b c` 是手工指定清单的调试通道）。
 *
 * ⚠️ **取不到 ⇒ 这一格没判**（`ok: false`），由调用方退 2 —— 不是退 0。
 * **空清单同样算「取不到」**：空清单若放行，「这次什么都没改」与「拿不到清单」就分不开了。
 *
 * ⚠️ 不带 `--staged` 也不带 `--base` 时，这一格读的是**当场这个仓库的索引** ——
 * 那是生产入口（钩子）要的形态，**不是用例该依赖的东西**（ISSUE #2344：每日那一跑里
 * 上一格的新鲜度账回写失败，把两份入库的账本留在索引里，于是「断言 `ok === false`」
 * 那条用例把自己的前提建在了别人的事故上，红成一个与代码无关的假红）。
 * 所以清单可由 `deps.readStaged` 注入 —— 形状与 `runGate({staged, selfTest})` 同源，
 * 目的都是「让判决可被执行，而不必先造一个现场」。
 *
 * @param {string[]} argv
 * @param {{readStaged?: () => string[]}} [deps] 只有「不带旗标 ⇒ 读当场索引」那一支用得到
 * @returns {{ok: true, files: string[], via: string} | {ok: false, reason: string}}
 */
export function resolveFace(argv, { readStaged = stagedFiles } = {}) {
  const baseIdx = argv.indexOf("--base");
  if (baseIdx !== -1) {
    const baseRef = (argv[baseIdx + 1] ?? "").trim();
    if (!baseRef) {
      return {
        ok: false,
        reason: "`--base` 要一条基线（用法：`--base <ref>`）—— 拿不到基线就没有判决面",
      };
    }
    const got = changedFilesForBaseRef(baseRef, { cwd: ROOT });
    if (!got.ok) {
      return { ok: false, reason: got.reason };
    }
    /* ⚠️ **空清单在这里是「成功测得没有改动」**，不是「取不到面」—— 基线取到了、
     *   diff 跑成功了、结果是空，那就是「这次什么都没改」⇒ 没有可判的内容 ⇒ 绿。
     *   （把它读成「不知道」会让 master 上的本地复算永远退 2 —— 那正是
     *   「降档不许被读成全套过了」的忌讳。） */
    return {
      ok: true,
      files: [...got.files, ...got.renamedFrom],
      via: `基线 ${baseRef}`,
    };
  }
  const si = argv.indexOf("--staged");
  const files = si === -1 ? readStaged() : argv.slice(si + 1);
  /* 空索引有两种来路（忘了 stage / 刻意空提交），而它在索引上逐字同形 ⇒ 不猜，
   * 只认 `intentional-empty-commit.mjs` 那个唯一口径（ISSUE #2354：
   * `pnpm ship --rerun-ci` 要推一笔空提交重新派生流水线，而「什么都没碰」在这里
   * 是**答案**而不是「取不到输入面」—— 走下面既有的「没碰到机制 ⇒ 说一句话」那一档）。
   * 不一致（旗标在而索引非空）也当场念出来，不留「设了旗标没人知道被忽略」的现场。 */
  const intent = intentionalEmptyCommit({ stagedCount: files.length });
  if (intent.voidNote) {
    process.stderr.write(`[known-failed-selftest] ⚠ ${intent.voidNote}\n`);
  }
  if (files.length === 0) {
    if (intent.note) {
      process.stderr.write(`[known-failed-selftest] ${intent.note}\n`);
    }
    if (intent.applies) {
      return { ok: true, files: [], via: "刻意空提交（没碰任何文件）" };
    }
    return {
      ok: false,
      reason:
        "暂存区是空的 —— 没有判决面（本地可能忘了 stage，平台上也可能有非空的索引 —— " +
        "上一格的账回写失败就会把账本留在里面，ISSUE #2344）",
    };
  }
  return { ok: true, files, via: si === -1 ? "暂存区" : "手工指定的清单" };
}

/**
 * 入口。
 *
 * `argv` 可注入（默认取 `process.argv`）—— 让用例能直接跑「判决面取不到」「没碰到机制
 * 也要说一句话」那两条，而不必起一个子进程（ISSUE #2265）。
 *
 * @param {string[]} [argv]
 * @returns {number} 退出码（0 绿 / 1 红 / 2 没跑起来）
 */
export function main(argv = process.argv.slice(2)) {
  const face = resolveFace(argv);
  if (!face.ok) {
    console.error(
      `[known-failed-selftest] 这一条**没判**：${face.reason} —— ` +
        "没有判决面不等于「已通过」，按「没跑起来」收（退 2）。",
    );
    return 2;
  }
  const staged = face.files;
  if (!touchesMechanism(staged)) {
    /* 「没碰到机制」是一句**要念出来的结论**，不是沉默 —— 此前这一步在平台上
     * 一个字都不打，而「恒绿且无声」与「真的判过了」逐字同形。 */
    console.log(
      `[known-failed-selftest] 本次改动没碰到「已知基线失败登记」机制 ⇒ 不用自证` +
        `（判决面：${face.via}，${staged.length} 个文件）。`,
    );
    return 0;
  }

  console.log(
    `[known-failed-selftest] 改动命中「已知基线失败登记」机制，跑一次自证（判决面：${face.via}）：`,
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

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(import.meta.filename)) {
  process.exit(main());
}
