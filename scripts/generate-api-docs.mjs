#!/usr/bin/env node
/**
 * generate-api-docs.mjs — 重生成 `docs/api/**`（= `pnpm run docs`，跨平台）。
 *
 * 它只做三件事：定位 typedoc 的输出目录 → 调 `scripts/typedoc-run.mjs` 跑并验 →
 * 把结论翻译成退出码。**跑与验的逻辑不在这里**（`typedoc-run.mjs` 是唯一实现，
 * `scripts/check-docs-api.cjs` 用的是同一份）。
 *
 * 为什么 `pnpm run docs` 不再直接写 `typedoc`：那个形态下「跑没跑成功」由
 * typedoc 的退出码说了算，而它写失败时照样退 0、日志照样收在
 * `[info] html generated at …` 上 —— 现场是「退出码 0 + 说生成了 + 产物一个没更新」，
 * 下一次有人发现已经是「翻 `docs/api` 看到它过期」。现在换成一个会验产物、会重试、
 * 全失败就退 1 的入口（背景与判据见 `typedoc-run.mjs` 的文件头）。
 *
 * ⚠️ 别写 `pnpm docs`：那是 pnpm 的**内建命令**（`pnpm docs <PACKAGE>` 打开某包的
 * 文档），会抢在脚本前面、typedoc 根本不跑。带脚本名的动词要用 `pnpm run <脚本>`。
 *
 * 用法：
 *   node scripts/generate-api-docs.mjs                 # 写 docs/api（默认）
 *   node scripts/generate-api-docs.mjs --out <dir>     # 写到别处（排查 / 比对用）
 *   node scripts/generate-api-docs.mjs --attempts 1    # 不重试（想看原始失败时）
 * 退出码：0 产物已更新；1 跑了但产物没更新（或 typedoc 起不来）。
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { DEFAULT_ATTEMPTS, runTypedoc } from "./typedoc-run.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** 与 `typedoc.json` 的 `out` 同一个目录。 */
const DEFAULT_OUT = "docs/api";

/**
 * 解析命令行：`--out <dir>` / `--out=<dir>` / `--attempts <n>`。
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  /** @type {{out: string, attempts: number}} */
  const opts = { out: DEFAULT_OUT, attempts: DEFAULT_ATTEMPTS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = (/** @type {string} */ name) => {
      const eq = arg.indexOf("=");
      if (eq > 0) return arg.slice(eq + 1);
      return argv[++i] ?? "";
    };
    if (arg === "--out" || arg.startsWith("--out=")) opts.out = value("out");
    else if (arg === "--attempts" || arg.startsWith("--attempts=")) {
      const n = Number.parseInt(value("attempts"), 10);
      if (Number.isFinite(n) && n > 0) opts.attempts = n;
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(ROOT, opts.out);
  // 先把「写到哪儿」这句话打出来：曾经有过「退出 0 + 说生成了 + 产物没动」的现场，
  // 而排查时第一个该排除的就是「它其实写到了另一个目录」。
  console.log(`[INFO] typedoc out: ${outDir}`);

  const res = await runTypedoc({ root: ROOT, outDir, attempts: opts.attempts });
  if (!res.ok) {
    console.error(
      `[ERROR] typedoc did not update ${res.outDir} after ${res.attempt}/${res.total} attempt(s): ${res.reason}`,
    );
    console.error(
      `[ERROR] files before=${res.before.files} after=${res.after.files}`,
    );
    if (res.log) console.error(`[ERROR] typedoc log tail:\n${res.log}`);
    console.error(
      `[ERROR] hint: a stale process / editor / indexer may still hold files under the out dir ` +
        `(EPERM / EBUSY on Windows is the usual shape). Close it and retry, or pass ` +
        `--out <other-dir> to see whether the out dir itself is the problem.`,
    );
    return 1;
  }
  console.log(
    `[OK] html generated: ${res.files} files -> ${res.outDir} (attempt ${res.attempt}/${res.total})`,
  );
  return 0;
}

// 用 exitCode 而不是 process.exit：后者会把还没 flush 的 stdout 截掉（Windows 管道上实测）。
main().then((code) => {
  process.exitCode = code;
});
