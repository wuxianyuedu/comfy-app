/**
 * ship-cleanup.mjs —— 合并后分支 / worktree 的批量收尾（ISSUE #5183）。
 *
 * `--branches` 只列落地判定、单条删除要 `ship:branch-clean <名>`；本会话三次 ship
 * 因「当前检出占着分支」在收尾退 1。这里先出三态计划（可删 / 不可删 / 没结论），
 * `--yes` 才逐条调用既有执行者，落地判定取不到一律退 2 不删。
 *
 * 用法：`pnpm ship:cleanup [--dry-run] [--yes]`
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

import { runGateStep } from "../launcher-core/shell.mjs";
import { branchLandingRows, fetchPullsForBranches, readLocalRefs } from "../ship/ship-branches.mjs";
import { CODE, parseSlug } from "../ship/ship-core.mjs";
import { makeRunner } from "../ship/ship-exec.mjs";

const ROOT = process.cwd();

/**
 * 落地判定 → 收尾动作。纯函数。
 *
 * @param {{name:string, verdict:string, current:boolean, pr?:number|null, isMerged?:boolean|null}[]} rows
 */
export function cleanupPlan(rows) {
  return rows.map((r) => ({
    ...r,
    action: r.current
      ? "skip-current"
      : r.verdict === "landed"
        ? "delete"
        : r.verdict === "no-pull-in-window"
          ? "no-conclusion"
          : "keep",
  }));
}

/**
 * 从 `git worktree list --porcelain` 取「路径 → 分支」。
 * @param {string} stdout
 */
export function worktreeBranches(stdout) {
  const rows = [];
  let current = null;
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length).trim(), branch: "" };
      rows.push(current);
    } else if (line.startsWith("branch ") && current) {
      current.branch = line
        .slice("branch ".length)
        .replace(/^refs\/heads\//, "")
        .trim();
    }
  }
  return rows;
}

/**
 * @param {{confirmed:boolean, log?:(s:string)=>void}} ctx
 */
export function runCleanup({ confirmed, log = (s) => process.stdout.write(`${s}\n`) }) {
  const run = makeRunner(ROOT);
  const slug = parseSlug(run("git", ["remote", "get-url", "origin"]).stdout);
  if (!slug) {
    log("[ship:cleanup] 取不到仓库 slug ⇒ 无法问 PR 的 is_merged，这一格没有结论。");
    return CODE.NOT_RUN;
  }
  const refs = readLocalRefs(run, "origin");
  if (!refs.ok) {
    log(`[ship:cleanup] ${refs.note} ⇒ 这一格没有结论。`);
    return CODE.NOT_RUN;
  }
  const fetched = fetchPullsForBranches(run, slug);
  if (!fetched.ok) {
    log(`[ship:cleanup] ${fetched.note} ⇒ 这一格没有结论（退 2 不是「没合并」）。`);
    return CODE.NOT_RUN;
  }
  const rows = branchLandingRows(refs.branches, fetched.pulls, refs.remoteRefs, refs.current, {
    windowComplete: fetched.windowComplete,
  });
  const plan = cleanupPlan(rows);
  for (const r of plan) {
    log(
      `  ${r.action.padEnd(14)} ${r.name} · PR ${r.pr ? `#${r.pr}` : "无"} · is_merged=${String(r.isMerged)}${r.current ? " · ← 当前检出" : ""}`,
    );
  }
  if (!confirmed) {
    log("[ship:cleanup] 只读计划（dry-run）：一条也没删；加 --yes 才逐条调用既有执行者。");
    return CODE.GREEN;
  }
  if (plan.some((r) => r.action === "no-conclusion")) {
    log("[ship:cleanup] 有分支落在取数窗口外 ⇒ 一律不删（退 2）。");
    return CODE.NOT_RUN;
  }
  const wts = worktreeBranches(
    runGateStep("git", ["-c", "core.quotePath=false", "worktree", "list", "--porcelain"], {
      cwd: ROOT,
      timeoutMs: 30_000,
      echo: false,
    }).stdout,
  );
  let code = CODE.GREEN;
  for (const r of plan.filter((p) => p.action === "delete")) {
    const target = wts.find((w) => w.branch === r.name && path.resolve(w.path) !== ROOT);
    if (target) {
      const rm = runGateStep(
        process.execPath,
        ["scripts/devtools/worktree-remove.mjs", target.path],
        {
          cwd: ROOT,
          timeoutMs: 120_000,
          echo: true,
        },
      );
      if (rm.status !== 0) {
        code = CODE.RED;
      }
    }
    const del = runGateStep(
      process.execPath,
      ["scripts/devtools/branch-clean.mjs", r.name, "--yes"],
      {
        cwd: ROOT,
        timeoutMs: 300_000,
        echo: true,
      },
    );
    if (del.status !== 0) {
      code = CODE.RED;
    }
  }
  return code;
}

/** @param {string[]} argv */
function main(argv) {
  const bad = argv.filter((a) => a !== "--yes" && a !== "--dry-run");
  if (bad.length > 0) {
    process.stderr.write(
      "用法：pnpm ship:cleanup [--dry-run] [--yes]\n  默认只读；落地判定取不到退 2 不删。\n",
    );
    return CODE.NOT_RUN;
  }
  return runCleanup({ confirmed: argv.includes("--yes") });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
