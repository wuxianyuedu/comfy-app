/**
 * checkout-status.mjs —— 本检出状态的**一张屏**（ISSUE #5168）。
 *
 * 开工 / 收尾反复手敲 `git status --short`、`git stash list`、`git rev-parse`、
 * `git worktree list`，而「上次 ship 走到哪」只落在本机快照里没人念。这里把散落的只读
 * 事实收起来，默认零网络；`--fetch` 只刷新引用，不改树、不声称「已最新」除非明说。
 * 已有的解析一律复用：`parsePorcelain`（ship-local）、`readShipResult` / `formatShipResult`
 * （ship-result）、`runningAppInstances`（port-reap，硬规则 9 的归属判据）。
 *
 * 用法：`pnpm status:checkout [--fetch]`
 * 退出码：0 = 读到了；1 = 有读数失败；2 = 用法错 / 不在 git 检出里。
 */
import { pathToFileURL } from "node:url";

import { runningAppInstances } from "../launcher-core/port-reap.mjs";
import { runGateStep } from "../launcher-core/shell.mjs";
import { parsePorcelain } from "../ship/ship-local.mjs";
import { formatShipResult, readShipResult } from "../ship/ship-result.mjs";

const ROOT = process.cwd();

/** @param {string[]} args */
function git(args) {
  return runGateStep("git", args, { cwd: ROOT, timeoutMs: 30_000, echo: false });
}

/**
 * 只把 porcelain 的**三列**念出来（复用 ship 的解析，不另写一套）。
 *
 * @param {string} stdout
 */
export function statusSummary(stdout) {
  const { staged, unstagedModified, untracked } = parsePorcelain(stdout);
  return {
    staged,
    changed: unstagedModified,
    untracked,
    total: staged.length + unstagedModified.length + untracked.length,
  };
}

/**
 * `git worktree list --porcelain` 里登记在案的路径；第一条是主 worktree。
 * @param {string} stdout
 */
export function worktreePaths(stdout) {
  return String(stdout ?? "")
    .split(/\r?\n/)
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length).trim());
}

/**
 * @param {{fetch?:boolean, log?:(s:string)=>void}} ctx
 */
export async function checkoutStatus({
  fetch = false,
  log = (s) => process.stdout.write(`${s}\n`),
} = {}) {
  const inside = git(["rev-parse", "--is-inside-work-tree"]);
  if (inside.status !== 0 || inside.stdout.trim() !== "true") {
    log("[status:checkout] 不在 git 检出里 ⇒ 这一格没有结论。");
    return 2;
  }
  const head = git(["rev-parse", "--short", "HEAD"]).stdout.trim();
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
  log(`[status:checkout] HEAD ${head || "?"} · 分支 ${branch || "(游离)"}`);
  const upstream = git(["rev-parse", "--abbrev-symbol", "--quiet", "@{upstream}"]);
  if (upstream.status === 0 && upstream.stdout.trim()) {
    const up = upstream.stdout.trim().replace(/^\*/, "").trim();
    const counts = git(["rev-list", "--left-right", "--count", `${branch}...${up}`]);
    const [behind, ahead] = (counts.stdout || "").trim().split(/\s+/).map(Number);
    log(
      `  上游 ${up} · ahead ${Number(ahead ?? 0)} / behind ${Number(behind ?? 0)}${fetch ? "（已刷新引用）" : "（未刷新引用，不声称最新）"}`,
    );
  } else {
    log("  上游：无");
  }
  const status = statusSummary(
    git(["status", "--porcelain=v1", "-z"]).stdout.replaceAll("\0", "\n"),
  );
  log(
    `  工作树：暂存 ${status.staged.length} · 已改 ${status.changed.length} · 未跟踪 ${status.untracked.length}（合计 ${status.total}）`,
  );
  for (const p of [...status.staged, ...status.changed, ...status.untracked].slice(0, 20)) {
    log(`    ${p}`);
  }
  const stash = git(["stash", "list"]);
  const stashLines = (stash.stdout || "").trim().split(/\r?\n/).filter(Boolean);
  log(`  stash：${stashLines.length} 条`);
  for (const l of stashLines.slice(0, 10)) {
    log(`    ${l}`);
  }
  const wts = worktreePaths(git(["worktree", "list", "--porcelain"]).stdout);
  log(`  worktree：${wts.length} 棵`);
  for (const w of wts) {
    log(`    ${w}`);
  }
  const result = readShipResult(ROOT);
  log(`  上次 ship：${result.found ? formatShipResult(result).join(" / ") : "没有落盘结论"}`);
  const instances = await runningAppInstances(ROOT);
  log(
    `  本检出实例：${instances.running ? `${instances.pids.length} 个（${instances.via ?? "?"}）` : "无"}`,
  );
  return 0;
}

/** @param {string[]} argv */
async function main(argv) {
  const bad = argv.filter((a) => a !== "--fetch");
  if (bad.length > 0) {
    process.stderr.write(
      "用法：pnpm status:checkout [--fetch]\n  --fetch 只刷新引用、不改树；缺省零网络。\n",
    );
    return 2;
  }
  return checkoutStatus({ fetch: argv.includes("--fetch") });
}

/* 只在直接执行时跑：测试 import 纯函数不能真的敲 git。 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
