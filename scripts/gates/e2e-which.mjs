#!/usr/bin/env node
/**
 * e2e-which.mjs —— 「这次改动要跑哪几条 E2E」的只读映射（ISSUE #4876）
 *
 * 为什么有这一层：PR 档不跑 E2E（成本与稳定性约束，AGENTS 硬规则 7 有据），于是
 * 「改 e2e 判据」与「动执行链路」的 PR 合并前没有任何 e2e 读数，风险全后置到
 * 次日每日档。这一入口不把 E2E 塞回 PR 档，而是给出**与改动面匹配的最小读数**：
 * 改了哪条 spec 的判据就跑哪条，动了公共地基就跑 @critical，动了执行链路就跑
 * 出图主链路。它是**建议跑**，不替代每日全量档。
 *
 * 映射不猜：只认三类登记（见下），宁可说「没登记、自己判断」也不伪造一条精确命令。
 * 与 `gates:which` 同一族口径 —— 转述事实、不命名结论、不落盘、不跑测试。
 *
 * 用法：
 *   node scripts/gates/e2e-which.mjs --changed <路径>…   用显式名单（改名旧侧一并给出）
 *   node scripts/gates/e2e-which.mjs                     按当前分支相对基线的改动面
 *   node scripts/gates/e2e-which.mjs --json              机器可读（供 CI/其他入口复用）
 *
 * 退出码：0 = 有读数；2 = 没有结论（改动面取不到 / 名单为空 / 参数不认识）。
 */
import path from "node:path";
import process from "node:process";

import { resolveChangedFiles } from "../lib/changed-scope.mjs";
import { faceMatches } from "./fixed-gate-input-faces.mjs";

/** 每条 e2e spec 判的是哪块行为（路径写全，不靠同名猜测）。 */
export const SPEC_FACES = Object.freeze({
  "e2e/view-tabs.spec.ts": ["侧栏临时页签的装配与交互"],
  "e2e/main-journey.spec.ts": ["建项目 → 出图主链路、SQLite 事务隔离、执行器收口"],
  "e2e/critical-flows.spec.ts": ["关键流程（登录去化后的建项目/出图）"],
  "e2e/runtime-budget.spec.ts": ["页面运行时性能预算"],
  "e2e/theme-toggle.spec.ts": ["明暗主题切换"],
  "e2e/theme-token-consumers.spec.ts": ["主题 token 的消费方"],
  "e2e/appearance-steps.spec.ts": ["外观设置步骤"],
  "e2e/settings-view.spec.ts": ["设置页"],
});

/** 改了这些公共地基，任何 spec 都可能受影响 —— 提示跑 @critical 而不是猜某一条。 */
export const E2E_COMMON_FACES = Object.freeze([
  "playwright.config.ts",
  "e2e/global-setup.ts",
  "e2e/support/**",
  "scripts/e2e/**",
]);

/** 动这些「执行链路」文件，出图主链路要重跑（#4789 那类生产构建下的事务守卫回归）。 */
export const EXECUTION_FACES = Object.freeze([
  "src/lib/comfyui/**",
  "src/lib/sqlite*",
  "src/server/db/**",
  "src/lib/task*",
  "scripts/build*",
  "next.config.js",
]);

/** @param {string[]} changed @param {readonly string[]} patterns @returns {boolean} */
const hitsAny = (changed, patterns) => changed.some((f) => patterns.some((p) => faceMatches(f, p)));

/**
 * 纯映射：改动面 → 该跑哪几条 e2e。所有入参都是已归一的仓库相对路径。
 *
 * @param {string[]} changed
 * @returns {{specs: string[], reasons: Record<string,string>, broad: string[], execution: boolean, command: string | null, note: string}}
 */
export function mapE2eSelection(changed) {
  const files = changed.map((f) => String(f).replaceAll("\\", "/")).filter(Boolean);
  /** @type {string[]} */
  const specs = [];
  /** @type {Record<string,string>} */
  const reasons = {};
  for (const [spec, what] of Object.entries(SPEC_FACES)) {
    if (files.some((f) => f === spec)) {
      specs.push(spec);
      reasons[spec] = `改了这条 spec 的判据（${what.join(" / ")}）`;
    }
    /* 改 spec 自己 import 的 support/源码时，也视为命中该 spec 的判据面。 */
    const stem = spec.replace(/^e2e\//, "").replace(/\.spec\.ts$/, "");
    if (
      files.some((f) => f.startsWith(`e2e/support/`) && f.includes(stem)) &&
      !specs.includes(spec)
    ) {
      specs.push(spec);
      reasons[spec] = `改了该 spec 依赖的 support（${what.join(" / ")}）`;
    }
  }
  /** @type {string[]} */
  const broad = [];
  if (hitsAny(files, E2E_COMMON_FACES)) {
    broad.push(
      "E2E 公共地基（配置 / globalSetup / support / 跑法）改动 ⇒ 建议跑全量或至少 `pnpm test:e2e --grep @critical`",
    );
  }
  const execution = hitsAny(files, EXECUTION_FACES);
  if (execution && !specs.includes("e2e/main-journey.spec.ts")) {
    specs.push("e2e/main-journey.spec.ts");
    reasons["e2e/main-journey.spec.ts"] =
      "动了执行链路（ComfyUI / SQLite / 构建形态）⇒ 出图主链路读数";
  }
  const command =
    specs.length > 0
      ? `pnpm test:e2e ${specs.map((s) => `e2e/${path.basename(s)}`).join(" ")}`
      : null;
  const note =
    specs.length === 0 && broad.length === 0
      ? "本次改动面没有登记到具体 spec —— E2E 读数由改动者自行判断；拿不准就 `pnpm test:e2e --grep @critical`"
      : "这里是**建议跑**，不是「已跑」—— PR 档不跑 E2E，读数要合并在 PR 描述里（每日全量档仍照常）";
  return { specs, reasons, broad, execution, command, note };
}

/**
 * 打印人读的一段。
 * @param {string[]} changed
 * @param {ReturnType<typeof mapE2eSelection>} [precomputed]
 * @returns {string[]}
 */
export function e2eSection(changed, precomputed) {
  const sel = precomputed ?? mapE2eSelection(changed);
  const lines = ["[e2e:which] E2E 读数（建议跑，不是「已跑」；PR 档不跑 E2E）"];
  if (sel.specs.length > 0) {
    lines.push(`  · 相关 spec：${sel.specs.join(" ")}`);
    for (const [spec, why] of Object.entries(sel.reasons)) {
      lines.push(`      - ${spec}：${why}`);
    }
    lines.push(`  · 可复跑命令：\`${sel.command}\``);
  } else {
    lines.push("  · 相关 spec：无登记（改动面没有命中任何 spec 的判据面）");
  }
  for (const b of sel.broad) lines.push(`  · ${b}`);
  if (sel.execution) {
    lines.push(
      "  · 执行链路改动：若改的是生产构建形态，用 `PNPM_START=1 pnpm test:e2e e2e/main-journey.spec.ts` 复跑那条档",
    );
  }
  lines.push(`  · ${sel.note}`);
  return lines;
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {{changed: string[] | null, json: boolean, help: boolean, unknown: string[]}} */
  const out = { changed: null, json: false, help: false, unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--json") out.json = true;
    else if (a === "--changed") {
      const list = [];
      while (i + 1 < argv.length && !String(argv[i + 1]).startsWith("--"))
        list.push(String(argv[++i]));
      out.changed = list;
    } else out.unknown.push(a);
  }
  return out;
}

/** @param {string[]} [argv] @returns {number} */
export function main(argv = process.argv.slice(2)) {
  const { changed, json, help, unknown } = parseArgs(argv);
  if (help) {
    process.stdout.write(
      "用法：\n" +
        "  pnpm e2e:which                         按当前分支相对基线的改动面给出相关 e2e spec\n" +
        "  pnpm e2e:which --changed <路径>…       用显式名单\n" +
        "  pnpm e2e:which --json                  机器可读\n" +
        "退出码：0 = 有读数；2 = 没有结论（取不到改动面 / 空名单 / 参数不认识）\n",
    );
    return 0;
  }
  if (unknown.length > 0) {
    process.stderr.write(`[e2e:which] 不认识的参数：${unknown.join(" / ")}（退 2，没有结论）\n`);
    return 2;
  }
  let face;
  if (changed === null) face = resolveChangedFiles();
  else if (changed.length === 0) {
    process.stderr.write(
      "[e2e:which] `--changed` 后没有路径 —— 这不是改动面为空，是没给名单（退 2）\n",
    );
    return 2;
  } else face = { ok: true, files: changed, renamedFrom: [], via: "--changed" };
  if (!face.ok) {
    process.stderr.write(`[e2e:which] 没有结论：取不到改动面（${face.reason}）（退 2）\n`);
    return 2;
  }
  const files = [...new Set([...face.files, ...(face.renamedFrom ?? [])])]
    .map((f) => String(f).replaceAll("\\", "/"))
    .filter(Boolean);
  if (files.length === 0) {
    process.stderr.write("[e2e:which] 没有结论：改动面为空（退 2）—— 空清单不能被读成「不用跑」\n");
    return 2;
  }
  const sel = mapE2eSelection(files);
  if (json) {
    process.stdout.write(`${JSON.stringify({ files, ...sel }, null, 2)}\n`);
  } else {
    process.stdout.write(`[e2e:which] 改动面：${files.length} 个路径\n`);
    for (const line of e2eSection(files, sel)) process.stdout.write(`${line}\n`);
  }
  return 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exit(main());
}
