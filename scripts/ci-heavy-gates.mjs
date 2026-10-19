#!/usr/bin/env node
/**
 * `ci-heavy-gates.mjs` — 平台侧「重档静态判据」那一格的**条目执行者**。
 *
 * ## 它替掉了什么，以及为什么（2026-10-19 的现场）
 *
 * 原来这十条判据各占一个平台 stage。`cnb-hpl-1k5a0s6ss` 上 `ESLint 零警告` 撞到平台
 * 的 **20m 单 stage 硬上限**被强杀（`任务超过最大执行时间而被强制关闭：20m0s`，脚本
 * 一行输出都没有），后面三十格整片 skipped；而同一台机、同一份工作区，
 * `cnb-smq-1k59vlk3l` 上同一步是 305s 跑过的。差的不是 ESLint 变慢了，是**前面每一格
 * 都在各付一次 job 开销与盘上扫描**，一台 16 核机被十几份同时开着的进程吃干净。
 *
 * 于是把它们收进**一格**：本次 job 只付一次开销，条目在进程内串行。红了照样知道是
 * 哪一条（每条自己一段日志，带墙钟与退出码），也不再是「一条红、后面全跳过」。
 *
 * ## 边界（刻意不做的事）
 *
 *   · **不改成并行**：这些条目本身就是 CPU 密集型（prettier / typedoc / vitest），
 *     并行只会把节点压成上面那种「谁都不推进」的形态 —— 那正是本次要治的病。
 *   · **不收窄**：`.cnb.yml` 的 `ifModify` 是按**整格**跳过的，一格装十条时它只能表达
 *     「十条一起跑」或「十条一起不跑」，而十条的扫描面并不相同 —— 后者正是本仓最不能
 *     有的形态（判据在场、结论静默变成放行）。格内一律跑全。
 *   · **不改判据**：每一条都是原来那份脚本、那份参数，本文件只负责「起它、转述它」。
 *
 * ## 收窄面的唯一出处仍然是登记表
 *
 * `scripts/ci-incremental-gates.mjs` 与 `scripts/ci-autofix-duties.mjs` 里，原来按
 * stage 名登记的那几条现在按**条目名**登记（`stage: "重档静态判据"`）。两份判据
 * （`tests/ci-incremental-gates.test.ts` / `tests/ci-autofix-duties.test.ts`）都改读
 * 本文件的 `HEAVY_GATES`，双向核对「登记过的条目 ⇒ 这里真有那一行」「这里带
 * `--autofix` 的条目 ⇒ 登记过」，所以「哪一档会自己改工作区」「哪一格被收窄」这两件
 * 事依然各只有一处出处。
 *
 * 用法：`node scripts/ci-heavy-gates.mjs [--only 条目名 …]`
 *   （`--only` 只给人手工排查用；`.cnb.yml` 里不带它 —— 平台侧永远跑全）
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 条目表 —— 「这一格里到底跑哪些判据」的唯一出处。
 *
 * 每条 `argv` 都是**仓库相对**的入口 + 参数（`node` 与 `node_modules/.bin/*` 两种形态
 * 都原样保留，与 `.cnb.yml` 里那几格逐字一致：本地 node 起 `.bin` 下的垫片在 Windows
 * 上起不来，那是 `ci-cp936-exit.mjs` 文件头记着的老坑，这里不重蹈）。
 *
 * @typedef {{name: string, argv: readonly string[], why: string}} HeavyGate
 * @type {ReadonlyArray<HeavyGate>}
 */
export const HEAVY_GATES = [
  {
    name: "生成态文档与源同步",
    argv: [
      "node",
      "scripts/render-doc-placeholders.cjs",
      "--check",
      "--autofix",
    ],
    why: "判「编辑态文档 ⇄ docs/generated/** 产物」同不同步；红了就地重渲染再判一次（自动修档）。",
  },
  {
    name: "API 文档生成物与源同步",
    argv: ["node", "scripts/check-docs-api.cjs", "--check", "--autofix"],
    why: "判「typedoc 产物 ⇄ docs/api/** 提交进 git 的内容」；本格最贵的一条（实测 201.8s），同时是自动修档。",
  },
  {
    name: "文档引用与权威源一致",
    argv: ["node", "scripts/check-doc-references.cjs"],
    why: "判的是全库文档里的引用与权威源，域不是某几个目录，收窄成任何子集都是漏判。",
  },
  {
    name: "覆盖率上报",
    argv: ["node", "scripts/ci-coverage-report.mjs"],
    why: "不判任何东西，只把 coverage/lcov.info 交给平台的上报通道；它自己判「有没有报告」，缺报告时跳过而不判红。",
  },
  {
    name: "core 骨架单一事实源",
    argv: [
      "node_modules/.bin/vitest",
      "run",
      "tests/single-logger-channel.test.ts",
      "tests/container-single-access.test.ts",
      "tests/core-spine-single-source.test.ts",
    ],
    why: "判三条跨全仓的单一事实源（日志实现只有一处、容器访问只有一条、core 骨架只有一份）。",
  },
  {
    name: "零消费导出",
    argv: ["node", "scripts/check-dead-exports.cjs"],
    why: "判地基层的零消费导出；面是 src/** + scripts/**，属于全仓不变量。",
  },
  {
    name: "core 出口纪律与基类纯度",
    argv: [
      "node_modules/.bin/vitest",
      "run",
      "tests/core-barrel-entry-discipline.test.ts",
      "tests/repository-base-purity.test.ts",
    ],
    why: "判 core 的出口纪律与仓储基类纯度，两条都是全仓级不变量。",
  },
  {
    name: "格式化提交分离",
    argv: ["node", "scripts/check-reformat-only.cjs"],
    why: "判「这次改动里有多少个文件只是被 prettier 重排过」；判据本体逐文件跑 prettier，面上有源文件才动手。",
  },
];

/** 条目名集合（登记表与自测共用，避免各处重算）。 */
export const HEAVY_GATE_NAMES = new Set(HEAVY_GATES.map((g) => g.name));

/**
 * 起一条判据并转述它的结论。
 *
 * `stdio: "inherit"` 而不是抓输出：这一格在平台侧整体包在 `ci-cp936-exit.mjs` 里，
 * 输出要**边到边流**出去（那个文件头记着「攒到 close 才发 = 被 kill 时整轮日志为零」）。
 * 抓一层再一次性打出去会把那条修好的性质当场退化。
 *
 * @param {HeavyGate} gate
 * @returns {number} 该条判据的退出码
 */
function runGate(gate) {
  const [command, ...args] = gate.argv;
  if (command === undefined) return 1;
  const started = Date.now();
  console.log(`\n[heavy-gates] ▶ ${gate.name}（${gate.argv.join(" ")}）`);
  const res = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    /* Windows 上 `.bin/*` 是垫片（`.cmd` / `.ps1`），`shell: false` 起不来 —— 与本仓
     * 其它「起子进程」的入口同一条处置（`ci-cp936-exit.mjs` 的 `resolveShellInvocation`）。 */
    shell: process.platform === "win32",
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const code = res.status ?? 1;
  console.log(
    code === 0
      ? `[heavy-gates] ✓ ${gate.name}（${seconds}s）`
      : `[heavy-gates] ✗ ${gate.name}（${seconds}s，退出码 ${code}）`,
  );
  return code;
}

/**
 * 取一条判据的**入口路径**。
 *
 * `argv` 的第一个元素是宿主（`node`，或可直接执行的 `node_modules/.bin/*`），
 * 第二个才是入口 —— 但 `node <入口>` 与 `<入口> run …` 两种形态里，入口都在第
 * 二项 **除了** `argv[0]` 本身是 `.bin/*` 那种直接执行的形态。判法按「谁是真入口」：
 * `argv[0] === "node"` ⇒ 入口是 `argv[1]`；否则入口是 `argv[0]`。
 *
 * @param {HeavyGate} gate
 * @returns {string}
 */
function entryOf(gate) {
  return gate.argv[0] === "node" ? (gate.argv[1] ?? "") : (gate.argv[0] ?? "");
}

/** 缺件时不静默：入口不在盘上就是配置写错了，按失败报，并说清是哪一条。 */
function missingEntries() {
  return HEAVY_GATES.filter((g) => {
    const entry = entryOf(g);
    return entry !== "" && !existsSync(path.join(ROOT, entry));
  }).map((g) => `${g.name} → ${entryOf(g)}`);
}

function main() {
  /** @type {string[]} */
  const only = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--only") {
      const next = argv[i + 1];
      if (next !== undefined) only.push(next);
      i += 1;
    }
  }
  const selected =
    only.length === 0
      ? [...HEAVY_GATES]
      : HEAVY_GATES.filter((g) => only.includes(g.name));

  if (selected.length === 0) {
    console.error(
      `[heavy-gates] ✗ 没有匹配的条目：${only.join(" / ")}（可选：${[...HEAVY_GATE_NAMES].join(" / ")}）`,
    );
    return 1;
  }

  const missing = missingEntries();
  if (missing.length > 0) {
    console.error(
      `[heavy-gates] ✗ 这些条目的入口不在盘上 —— 配置与盘上漂了，先修其中一边：\n  ${missing.join("\n  ")}`,
    );
    return 1;
  }

  console.log(
    `[heavy-gates] 本次 ${selected.length} 条，串行跑（并行会把节点压成「谁都不推进」的形态）`,
  );
  const failed = [];
  for (const gate of selected) {
    const code = runGate(gate);
    if (code !== 0) failed.push(`${gate.name}（退出码 ${code}）`);
  }

  if (failed.length > 0) {
    /* 逐条失败都点名：这一格**不许**在第一条红时停下 —— 停下的形态正是「后面哪条红过
     * 一次都看不出来」，而它被合起来的意义正是让一轮就能看到全部读数。 */
    console.error(
      `\n[heavy-gates] ✗ ${failed.length}/${selected.length} 条红：\n  ${failed.join("\n  ")}`,
    );
    return 1;
  }
  console.log(`\n[heavy-gates] ✓ ${selected.length} 条全绿`);
  return 0;
}

/* 只在被直接执行时跑 main。被 import 时（`tests/ci-autofix-duties.test.ts` 要读
 * `HEAVY_GATES`）只暴露纯数据与函数 —— 否则 `process.exit()` 会当场把测试进程杀掉，
 * 而那件事的形态是「用例一条都没跑、套件却红了」，读起来与真红完全两样。 */
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  process.exit(main());
}
