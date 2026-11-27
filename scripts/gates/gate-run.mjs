/**
 * gate-run.mjs —— 按名字**就地**跑一条门禁（ISSUE #5173）。
 *
 * `pnpm gates:which` 给出「建议跑哪几条」，但人还得把标签翻译成
 * `node scripts/gates/check-xxx.cjs`；`base-check.mjs` 的按名入口是在干净 worktree 上复算
 * 基线，不是「在这里再跑一遍」。这里只从两个既有登记面解析，**不另立清单**：
 *   · `.githooks/pre-commit` 的 `run "<标签>" <命令>` 单行步骤；
 *   · `scripts/gates/quality-gate.mjs` 导出的 `GATES`（label → pnpm 脚本名）。
 *
 * 用法：`pnpm gate run <钩子标签|脚本名|文件 basename> [--staged|--changed]`
 * 退码：0 命中且绿 / 1 命中且红 / 2 没命中、多名命中或用法错。
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { runGateStep } from "../launcher-core/shell.mjs";
import { GATES } from "./quality-gate.mjs";

const ROOT = process.cwd();

/**
 * 解析钩子里的单行 `run "<标签>" <命令>`。纯函数。
 *
 * @param {string} hookText
 * @returns {{label:string, command:string}[]}
 */
export function parseHookSteps(hookText) {
  const rows = [];
  for (const line of String(hookText ?? "").split(/\r?\n/)) {
    /* 钩子里的步骤行有缩进（真实形态是 `  run "…" …`），所以允许前导空白；
     * 注释行以 `#` 打头，不会被这条正则命中。 */
    const m = /^\s*run\s+"(?<label>[^"]+)"\s+(?<command>.+?)\s*$/.exec(line);
    if (m) {
      rows.push({ label: m.groups?.label ?? "", command: m.groups?.command ?? "" });
    }
  }
  return rows;
}

/**
 * 按名字找唯一执行者。命中多个就报多个，不替人挑一条。
 *
 * @param {{hook:string, gates:Record<string,{label?:string, args?:string[]}>, query:string}} input
 */
export function findGate({ hook, gates, query }) {
  const q = String(query ?? "")
    .trim()
    .toLowerCase();
  const hits = [];
  for (const step of parseHookSteps(hook)) {
    if (step.label.toLowerCase().includes(q) || step.command.includes(q)) {
      hits.push({ source: "pre-commit", label: step.label, command: step.command });
    }
  }
  for (const [key, g] of Object.entries(gates ?? {})) {
    if (
      key.toLowerCase().includes(q) ||
      String(g?.label ?? "")
        .toLowerCase()
        .includes(q)
    ) {
      hits.push({
        source: "quality-gate",
        label: String(g?.label ?? key),
        command: `pnpm run ${key}`,
      });
    }
  }
  return hits;
}

/** @param {string[]} argv */
function main(argv) {
  if (argv[0] !== "run") {
    process.stderr.write(
      "用法：pnpm gate run <钩子标签|脚本名|文件 basename> [--staged|--changed]\n",
    );
    return 2;
  }
  const rest = argv.slice(1);
  const extra = rest.filter((a) => a === "--staged" || a === "--changed");
  const query = rest.find((a) => a !== "--staged" && a !== "--changed");
  if (!query) {
    process.stderr.write("[gate run] 缺点名哪一条门禁。\n");
    return 2;
  }
  const hook = fs.readFileSync(path.join(ROOT, ".githooks/pre-commit"), "utf8");
  const hits = findGate({ hook, gates: GATES, query });
  if (hits.length !== 1) {
    process.stderr.write(
      `[gate run] 「${query}」命中 ${hits.length} 条 ⇒ 不替你挑：\n${hits
        .map((h) => `  · [${h.source}] ${h.label} — ${h.command}\n`)
        .join("")}`,
    );
    return 2;
  }
  const hit = hits[0];
  if (!hit) {
    return 2;
  }
  const tokens = hit.command.split(/\s+/).filter(Boolean);
  const res = runGateStep(tokens[0] ?? "", [...tokens.slice(1), ...extra], {
    cwd: ROOT,
    timeoutMs: 15 * 60_000,
    echo: true,
  });
  process.stdout.write(String(res.stdout ?? ""));
  process.stderr.write(String(res.stderr ?? ""));
  process.stdout.write(`[gate run] ${hit.label} · 退码 ${String(res.status)}\n`);
  return res.status ?? 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
