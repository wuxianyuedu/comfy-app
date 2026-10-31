#!/usr/bin/env node
/**
 * gates-which.mjs —— 对着一批改动回答三件事：**该跑哪几条门禁、该跑哪份用例、该读哪一节规范**（ISSUE #2765）。
 *
 * 为什么需要它：本地默认档只跑形态档 D0（重档与「受影响用例」的执行者在平台，
 * 规范 §13.5.25），于是「不知道该跑哪条」直接等于「推上去让平台告诉我红了哪格」——
 * 一次平台往返是分钟到十几分钟。而这三个问题的答案此前分别散在：钩子文本、
 * `quality-gate.mjs` 的 `GATES`、`fixed-gate-input-faces.mjs`、以及 `AGENTS.md`
 * 那张只能人眼读的表里。
 *
 * ── 三条口径（全部沿用既有执行者，硬规则 27 第一条）─────────────────────
 *
 *   · **门禁**：本地两档 / 重档的划分取自 `readHookSteps()` + `localTierLabels()`
 *     （钩子文本是唯一出处）；「这次碰没碰某条判据的收窄面」取自
 *     `ci-incremental-gates.mjs` 的登记 + `faceTouched()`（平台 `ifModify` 与复合档
 *     逐条收窄用的是同一份 glob）；一键门禁的档名取自 `quality-gate.mjs` 导出的 `GATES`。
 *   · **用例**：直接起 `scripts/affected-tests.mjs --changed-stdin --json` 那条判决链，
 *     本文件不重算 import 图、不另写筛法。
 *   · **规范**：读 `scripts/doc-reading-map.mjs`（`AGENTS.md` 那张表的机器可读副本，
 *     两边由 `tests/gates-which.test.ts` 双向核对）。
 *
 * ── 边界（输出里逐条印出来，不许静默）──────────────────────────────────
 *
 *   · **在册 ≠ 出勤**：这里给的是「建议跑」，不是「已跑」——不许被读成「全套过了」。
 *   · 用例那一半判的是**静态 import 图**，运行时拼出来的路径抓不到（§13.5.8）⇒
 *     给的是**增量面**，不是全量凭证（全量是 `pnpm test` / `pnpm check:all`）。
 *   · **改动面为空 / 取不到基线 ⇒ 没有结论（退 2）**，不是「什么都不用跑」。
 *
 * 本入口**只读**：不跑任何门禁、不写文件、不挂进 pre-commit（这是导航面，不是判据面）。
 *
 * 用法：
 *   pnpm gates:which                      按当前分支相对基线的改动面答三问
 *   pnpm gates:which --changed <路径>…    用显式名单（改名旧侧要自己一并给出）
 *   pnpm gates:which --help               打出这段用法
 *
 * 退出码：0 = 三问都有读数；2 = 没有结论（改动面为空 / 取不到基线 / 用例链读不到 /
 * 不认识的参数）—— 2 不是绿，也不是「没有问题」。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

import { readHookSteps, localTierLabels } from "./base-check/hook-steps.mjs";
import {
  INCREMENTAL_GATES,
  faceTouched,
  narrowingEntryForScript,
} from "./ci-incremental-gates.mjs";
import { resolveChangedFiles } from "./changed-scope.mjs";
import { matchDocReading } from "./doc-reading-map.mjs";
import { FIXED_STRUCTURAL_TESTS } from "./fixed-structural-tests.mjs";
import { GATES } from "./quality-gate.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const TAG = "[gates:which]";

/**
 * 解析参数。只认 `--changed <路径…>`。
 *
 * @param {string[]} argv
 * @returns {{changed: string[] | null, help: boolean, unknown: string[]}}
 */
export function parseArgs(argv) {
  /** @type {{changed: string[] | null, help: boolean, unknown: string[]}} */
  const out = { changed: null, help: false, unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--help" || a === "-h") {
      out.help = true;
      continue;
    }
    if (a === "--changed") {
      const list = [];
      while (i + 1 < argv.length && !String(argv[i + 1]).startsWith("--")) {
        list.push(String(argv[++i]));
      }
      out.changed = list;
      continue;
    }
    out.unknown.push(a);
  }
  return out;
}

/**
 * 从一条钩子步骤的命令里认出它跑的是哪份脚本（`scripts/*.mjs|cjs`）。
 *
 * 认不出就是「它跑的是别的执行者」（`tsc` / `eslint` / 组合入口）——按「没有可收窄的
 * 面」处理，不猜。
 *
 * @param {string[]} argv
 * @returns {string | null}
 */
export function scriptOf(argv) {
  for (const raw of argv) {
    const token = String(raw ?? "").replaceAll("\\", "/");
    const m = /(?:^|\/)scripts\/([^/]+\.(?:mjs|cjs))$/.exec(token);
    if (m?.[1]) {
      return `scripts/${m[1]}`;
    }
  }
  return null;
}

/**
 * 把重档步骤按「这次改动碰没碰到它的收窄面」分堆。
 *
 * 本地档来自 `localTierLabels()`；重档 = 其余。收窄面只按 `ci-incremental-gates.mjs`
 * 的登记判（`narrowingEntryForScript` + `faceTouched`）——与平台的 `ifModify` 和
 * 复合档的逐条收窄**同一份 glob**，不另立第二套。
 *
 * @param {string[]} changed
 * @param {{readSteps?: typeof readHookSteps, tierLabels?: typeof localTierLabels}} [deps]
 * @returns {{
 *   localTier: number,
 *   totalSteps: number,
 *   heavy: number,
 *   hit: Array<{label: string, script: string | null}>,
 *   skippable: Array<{label: string, script: string | null}>,
 *   noFace: Array<{label: string, script: string | null}>,
 * }}
 */
export function classifyHeavySteps(changed, deps = {}) {
  const steps = (deps.readSteps ?? readHookSteps)();
  const local = (deps.tierLabels ?? localTierLabels)();
  const heavy = steps.filter((s) => !local.has(s.label));
  /** @type {Array<{label: string, script: string | null}>} */
  const hit = [];
  /** @type {Array<{label: string, script: string | null}>} */
  const skippable = [];
  /** @type {Array<{label: string, script: string | null}>} */
  const noFace = [];
  for (const step of heavy) {
    const script = scriptOf(step.argv);
    const entry = script === null ? null : narrowingEntryForScript(script);
    if (entry === null) {
      noFace.push({ label: step.label, script });
      continue;
    }
    (faceTouched(entry, changed) ? hit : skippable).push({
      label: step.label,
      script,
    });
  }
  return {
    localTier: local.size,
    totalSteps: steps.length,
    heavy: heavy.length,
    hit,
    skippable,
    noFace,
  };
}

/**
 * 起 `affected-tests.mjs` 那条判决链，读回它自己的 JSON。
 *
 * 长清单走 `--changed-stdin`（argv 有长度上限，`affected-tests.mjs` 的文件头写着这一档）；
 * 拿不到读数时**把它的 stderr 原样带回来**，不折成空清单。
 *
 * @param {string[]} changed
 * @param {{spawn?: typeof spawnSync}} [deps]
 * @returns {{ok: true, result: {mode: string, tests: string[], reasons: Record<string, string>}}
 *   | {ok: false, reason: string, stdout: string, stderr: string}}
 */
export function affectedTests(changed, deps = {}) {
  const spawn = deps.spawn ?? spawnSync;
  const res = spawn(process.execPath, ["scripts/affected-tests.mjs", "--changed-stdin", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    input: changed.join("\n"),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout = String(res.stdout ?? "");
  const stderr = String(res.stderr ?? "");
  if (res.status !== 0 || stdout.trim() === "") {
    return {
      ok: false,
      reason: `affected-tests 退出码 ${res.status ?? "null"}`,
      stdout,
      stderr,
    };
  }
  try {
    return { ok: true, result: JSON.parse(stdout) };
  } catch {
    return { ok: false, reason: "affected-tests 的 stdout 不是 JSON", stdout, stderr };
  }
}

/**
 * 一行里列出名字（空清单说「无」）。
 *
 * @param {Array<{label: string}>} list
 * @returns {string}
 */
function names(list) {
  return list.length === 0 ? "无" : list.map((x) => x.label).join(" / ");
}

/**
 * 门禁那一节。
 *
 * @param {string[]} changed
 * @returns {{lines: string[], ok: boolean}}
 */
function gatesSection(changed) {
  const lines = [`${TAG} 门禁（全部转述既有执行者的登记；「在册」≠「已跑」）`];
  const cls = classifyHeavySteps(changed);
  if (cls.totalSteps === 0) {
    lines.push(
      "  · ⚠ 读不到 .githooks/pre-commit 的步骤行 —— 门禁那一半没有结论（不是「没有门禁」）",
    );
  } else {
    lines.push(
      `  · 钩子分档（.githooks/pre-commit）：本地形态档 ${cls.localTier} 条（每次提交自动跑，不用挑）` +
        `；重档 ${cls.heavy} 条（本地默认不跑）`,
    );
    lines.push(
      `      - 本次碰到收窄面、会跑：${cls.hit.length} 条` +
        (cls.hit.length > 0
          ? `\n          ${cls.hit.map((x) => `${x.label}（${x.script}）`).join("\n          ")}`
          : "（改动面一条都没碰到登记过的收窄面）"),
    );
    if (cls.skippable.length > 0) {
      lines.push(`      - 按收窄面可跳过：${names(cls.skippable)}`);
    }
    lines.push(`      - 没有收窄面、任何改动都可能让它们红：${names(cls.noFace)}`);
  }

  const gateKeys = Object.entries(GATES);
  const defaultKeys = gateKeys.filter(([, g]) => g.run !== false).map(([k]) => k);
  const onDemand = gateKeys.filter(([, g]) => g.run === false).map(([k]) => k);
  lines.push(
    `  · 一键门禁档（scripts/quality-gate.mjs 的 GATES，共 ${gateKeys.length} 档）：` +
      `${defaultKeys.join(" / ")}（按需档：${onDemand.join(" / ")}）`,
  );

  const platform = INCREMENTAL_GATES.map((entry) => ({
    name: entry.name,
    run: faceTouched(entry, changed),
  }));
  const willRun = platform.filter((p) => p.run).map((p) => p.name);
  const willSkip = platform.filter((p) => !p.run).map((p) => p.name);
  lines.push(
    `  · 平台 ifModify 收窄（ci-incremental-gates 的 ${platform.length} 条登记）：` +
      `会跑 ${willRun.length} 条；可跳过 ${willSkip.length} 条` +
      (willSkip.length > 0
        ? `\n      会跑：${willRun.join(" / ") || "无"}\n      可跳过：${willSkip.join(" / ")}`
        : ""),
  );
  return { lines, ok: cls.totalSteps > 0 };
}

/**
 * 用例那一节。
 *
 * @param {string[]} changed
 * @returns {{lines: string[], ok: boolean}}
 */
function testsSection(changed) {
  const got = affectedTests(changed);
  if (!got.ok) {
    const lines = [
      `${TAG} 用例（来自 scripts/affected-tests.mjs 的判决链）：⚠ 没取到读数（${got.reason}）—— 这不是「不用跑」`,
    ];
    for (const line of `${got.stdout}${got.stderr}`.trim().split("\n").filter(Boolean)) {
      lines.push(`  │ ${line}`);
    }
    return { lines, ok: false };
  }
  const { mode, tests, reasons } = got.result;
  const extra = tests.filter((t) => !FIXED_STRUCTURAL_TESTS.includes(t)).length;
  const lines = [
    `${TAG} 用例（来自 scripts/affected-tests.mjs 的判决链）`,
    `  · 模式 ${mode}${mode === "all" ? "（放弃收窄：只跑固定清单，不是全量）" : "（增量面）"}` +
      ` · 共 ${tests.length} 份（固定清单 ${tests.length - extra} + 受影响 ${extra}）`,
  ];
  if (typeof reasons.__note === "string") {
    lines.push(`  · 说明：${reasons.__note}`);
  }
  if (typeof reasons.__faceSkipped === "string") {
    lines.push(`  · 固定清单按输入面跳过：${reasons.__faceSkipped.split(" ").join(" / ")}`);
  }
  if (typeof reasons.__skipped === "string") {
    lines.push(`  · 已知基线红剔除：${reasons.__skipped.split(" ").join(" / ")}`);
  }
  lines.push(`  · 名单：${tests.join(" ")}`);
  return { lines, ok: true };
}

/**
 * 规范那一节。
 *
 * @param {string[]} changed
 * @returns {string[]}
 */
function docsSection(changed) {
  const { matched, actionOnly } = matchDocReading(changed);
  const lines = [
    `${TAG} 规范（AGENTS.md「强制先读规范文档的改动范围」的机器可读副本：scripts/doc-reading-map.mjs）`,
  ];
  if (matched.length === 0) {
    lines.push(
      "  · 按路径一行都没命中 —— 表里没有为这批文件登记必读章节（不等于没有约定，下面那两条仍要对照）",
    );
  }
  for (const entry of matched) {
    lines.push(
      `  · ${entry.scope} → ${entry.doc} ${entry.spec}` + (entry.when ? `（${entry.when}）` : ""),
    );
  }
  if (actionOnly.length > 0) {
    lines.push(
      "  · 按**动作**判断、路径匹配不出来的（自己对照）：" +
        actionOnly.map((e) => `${e.scope}（${e.when}）→ ${e.doc} ${e.spec}`).join("；"),
    );
  }
  return lines;
}

/**
 * @param {string[]} [argv]
 * @returns {number} 退出码
 */
export function main(argv = process.argv.slice(2)) {
  const { changed, help, unknown } = parseArgs(argv);
  if (help) {
    process.stdout.write(
      "用法：\n" +
        "  pnpm gates:which                      按当前分支相对基线的改动面答三问\n" +
        "  pnpm gates:which --changed <路径>…    用显式名单（改名旧侧要自己一并给出）\n" +
        "退出码：0 = 三问都有读数；2 = 没有结论（改动面为空 / 取不到基线 / 用例链读不到 / 不认识的参数）\n",
    );
    return 0;
  }
  if (unknown.length > 0) {
    process.stderr.write(
      `${TAG} 不认识的参数：${unknown.join(" / ")} —— 本入口只认 --changed <路径…>；` +
        "拼错的旗标不会生效，退 2 表示这次什么都没查（不是「没有问题」）\n",
    );
    return 2;
  }

  /** @type {{ok: true, files: string[], renamedFrom: string[], via: string} | {ok: false, reason: string}} */
  let face;
  if (changed !== null) {
    if (changed.length === 0) {
      process.stderr.write(
        `${TAG} \`--changed\` 后面没有路径 —— 这不是「改动面为空」，是没有给名单（退 2）\n`,
      );
      return 2;
    }
    face = {
      ok: true,
      files: changed,
      renamedFrom: [],
      via: "--changed（显式名单；改名旧侧由调用方一并给出）",
    };
  } else {
    face = resolveChangedFiles();
  }
  if (!face.ok) {
    process.stderr.write(
      `${TAG} 没有结论：取不到改动面（${face.reason}）——「取不到」不等于「什么都不用跑」（退 2）\n`,
    );
    return 2;
  }
  const files = [...new Set([...face.files, ...face.renamedFrom])]
    .map((f) => String(f).replaceAll("\\", "/"))
    .filter(Boolean);
  if (files.length === 0) {
    process.stderr.write(
      `${TAG} 没有结论：改动面为空（${face.via}）—— 空清单不能被读成「什么都不用跑」，` +
        "先确认基线取对了（或用 `--changed` 给显式名单）（退 2）\n",
    );
    return 2;
  }
  process.stdout.write(`${TAG} 改动面：${files.length} 个路径（${face.via}）\n`);

  const gates = gatesSection(files);
  const tests = testsSection(files);
  const docs = docsSection(files);
  for (const line of [...gates.lines, ...tests.lines, ...docs]) {
    process.stdout.write(`${line}\n`);
  }
  process.stdout.write(
    `${TAG} 边界：这里给的是**建议跑**，不是「已跑」——本地默认档只有 D0，` +
      "重档与「受影响用例」的执行者在平台（§13.5.25），别把这份清单读成「全套过了」。\n" +
      `${TAG} 边界：用例那一半判的是**静态 import 图**，运行时拼出来的路径抓不到（§13.5.8）` +
      "⇒ 给的是增量面，不是全量凭证（全量 = `pnpm test` / `pnpm check:all`）。\n",
  );
  return gates.ok && tests.ok ? 0 : 2;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exit(main());
}
