/**
 * deps-triage.mjs —— `pnpm outdated` 三档分诊（ISSUE #5185）。
 *
 * 依赖整理时要把读数按「同 major.minor 的补丁 / 同 major 的 minor / 跨 major」分三档，
 * 此前是文档口径 + 手工表格（better-auth 曾落后 14 个补丁才发现）。这里只读分诊，
 * 不写 lockfile、不替人决定升不升，也不新写判据。
 *
 * 用法：`pnpm deps:triage [--json]`
 */
import { pathToFileURL } from "node:url";

import { pnpmInvocation, runGateStep } from "../launcher-core/shell.mjs";

const ROOT = process.cwd();

/**
 * 两段版本号数值化（忽略 `-pre` / `+build`）。纯函数。
 *
 * @param {unknown} value
 * @returns {number[]}
 */
export function versionParts(value) {
  const core = String(value ?? "").split(/[+-]/)[0] ?? "";
  return core
    .split(".")
    .map((n) => Number.parseInt(n, 10))
    .filter((n) => Number.isFinite(n));
}

/**
 * `pnpm outdated --json` 的读数 → 三档。纯函数。
 *
 * @param {Record<string,{current?:unknown, latest?:unknown}>} json
 * @returns {{patch:{name:string,current:string,latest:string}[], minor:{name:string,current:string,latest:string}[], major:{name:string,current:string,latest:string}[], unknown:{name:string,current:string,latest:string}[]}}
 */
export function triageOutdated(json) {
  /** @type {{patch:{name:string,current:string,latest:string}[], minor:{name:string,current:string,latest:string}[], major:{name:string,current:string,latest:string}[], unknown:{name:string,current:string,latest:string}[]}} */
  const groups = { patch: [], minor: [], major: [], unknown: [] };
  for (const [name, info] of Object.entries(json ?? {})) {
    const cur = versionParts(info?.current);
    const latest = versionParts(info?.latest);
    const row = {
      name,
      current: String(info?.current ?? ""),
      latest: String(info?.latest ?? ""),
    };
    if (cur.length >= 3 && latest.length >= 3) {
      const cm = cur[0] ?? 0;
      const cn = cur[1] ?? 0;
      const lm = latest[0] ?? 0;
      const ln = latest[1] ?? 0;
      const bucket = cm === lm ? (cn === ln ? "patch" : "minor") : "major";
      groups[bucket].push(row);
    } else {
      groups.unknown.push(row);
    }
  }
  return groups;
}

/** @param {string[]} argv */
function main(argv) {
  const bad = argv.filter((a) => a !== "--json");
  if (bad.length > 0) {
    process.stderr.write("用法：pnpm deps:triage [--json]\n  只读，不写 lockfile。\n");
    return 2;
  }
  const inv = pnpmInvocation(["outdated", "--json"], { env: process.env });
  if (!inv) {
    process.stderr.write("[deps:triage] pnpm 不在 PATH ⇒ 没有执行者。\n");
    return 2;
  }
  const res = runGateStep(inv.command, inv.args, {
    cwd: ROOT,
    timeoutMs: 10 * 60_000,
    echo: false,
  });
  let json;
  try {
    json = JSON.parse(String(res.stdout ?? "").trim() || "{}");
  } catch {
    process.stderr.write(
      "[deps:triage] pnpm outdated 的输出不是 JSON ⇒ 这一格没有结论（退 2）。\n",
    );
    return 2;
  }
  const groups = triageOutdated(json);
  if (argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(groups, null, 2)}\n`);
  } else {
    /** @type {Record<string,string>} */
    const labels = {
      patch: "可顺手升（同 major.minor 补丁）",
      minor: "需评估（同 major 的 minor）",
      major: "需单独立项（跨 major）",
      unknown: "读数认不出（人工看）",
    };
    for (const [key, rows] of Object.entries(groups)) {
      process.stdout.write(`[deps:triage] ${labels[key]}：${rows.length} 个\n`);
      for (const r of rows) {
        process.stdout.write(`  ${r.name} ${r.current} → ${r.latest}\n`);
      }
    }
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
