/**
 * test-affected.mjs —— 把 CI 的「受影响用例」执行者向本地开口（ISSUE #5170）。
 *
 * `run-affected-tests.mjs` 已经解过命令行长度、分块、超时指纹隔离复跑这些坑，
 * 但它没有 pnpm 入口，本地想复现那一格只能自己拼命令、把改动面铺进 argv 再撞 8191 上限。
 * 这里只做三件薄事：算改动面（走 stdin，不进 argv）、**直接执行**既有执行者、
 * 把「改动面 → 命中清单 → 退码」的读数摆在同一张屏。判决链一个字不改。
 *
 * 用法：`pnpm test:affected [--report|--json] [--base origin/master]`
 * 退码沿用既有执行者：0 绿 / 1 真红 / 2 没跑起来（含改动面为空，**不兜成全量**）。
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

import { runGateStep } from "../launcher-core/shell.mjs";

const ROOT = process.cwd();
const ENTRY = path.join(ROOT, "scripts/affected-tests/run-affected-tests.mjs");

/**
 * 改动面 = 相对基线的三点 diff + 当前工作树的 porcelain 路径。纯函数（喂形状）。
 *
 * @param {{diff:string, status:string}} input
 * @returns {string[]}
 */
export function changedPaths({ diff, status }) {
  const fromDiff = String(diff ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const fromStatus = String(status ?? "")
    .split("\0")
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
  return [...new Set([...fromDiff, ...fromStatus])].sort();
}

/** @param {string[]} argv */
function main(argv) {
  const json = argv.includes("--json");
  const dryRun = argv.includes("--dry-run");
  const bad = argv.filter(
    (a) => a !== "--json" && a !== "--report" && a !== "--base" && a !== "--dry-run",
  );
  const baseAt = argv.indexOf("--base");
  const base = baseAt === -1 ? "origin/master" : String(argv[baseAt + 1] ?? "origin/master");
  if (bad.length > 0 || (baseAt !== -1 && !base)) {
    process.stderr.write(
      "用法：pnpm test:affected [--report|--json] [--base origin/master]\n" +
        "  改动面走 stdin 喂给既有执行者，不铺进 argv；空改动面退 2，不跑成全量。\n",
    );
    return 2;
  }
  /** @param {string} cmd @param {string[]} args */
  const run = (cmd, args) => runGateStep(cmd, args, { cwd: ROOT, timeoutMs: 30_000, echo: false });
  const files = changedPaths({
    diff: run("git", ["diff", "--name-only", `${base}...HEAD`]).stdout,
    status: run("git", ["status", "--porcelain=v1", "-z"]).stdout,
  });
  if (files.length === 0) {
    process.stderr.write(
      "[test:affected] 改动面为空 ⇒ 退 2；空清单喂进去会跑成全量，那是更坏的失效。\n",
    );
    return 2;
  }
  const note = `[test:affected] 改动面 ${files.length} 个文件 → run-affected-tests --changed-stdin（既有判据，不另算清单）`;
  if (json) {
    process.stdout.write(`${JSON.stringify({ base, files, entry: ENTRY })}\n`);
  } else {
    process.stdout.write(`${note}\n`);
    for (const f of files.slice(0, 20)) {
      process.stdout.write(`  ${f}\n`);
    }
  }
  const child = runGateStep(
    process.execPath,
    [ENTRY, "--changed-stdin", ...(dryRun ? ["--dry-run"] : [])],
    {
      cwd: ROOT,
      timeoutMs: 30 * 60_000,
      echo: false,
      input: `${files.join("\n")}\n`,
    },
  );
  process.stdout.write(String(child.stdout ?? ""));
  process.stderr.write(String(child.stderr ?? ""));
  const code = child.status ?? 2;
  process.stdout.write(
    `[test:affected] 退码 ${code}${code === 0 ? "（绿）" : code === 1 ? "（真红）" : "（没跑起来，不是绿）"}\n`,
  );
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
