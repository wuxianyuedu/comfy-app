#!/usr/bin/env node
/**
 * generate-api-docs.mjs — 生成一份 API 文档到 `docs/api/`（= `pnpm run docs`，跨平台）。
 *
 * 它只做三件事：定位 typedoc 的输出目录 → 调 `scripts/typedoc-run.mjs` 跑并验 →
 * 把结论翻译成退出码。**跑与验的逻辑不在这里**（`typedoc-run.mjs` 是唯一实现，
 * `scripts/check-docs-api.cjs` 用的是同一份 —— 那边是「生成 + 自检」，这边是「只生成」）。
 *
 * 为什么 `pnpm run docs` 不再直接写 `typedoc`：那个形态下「跑没跑成功」由
 * typedoc 的退出码说了算，而它写失败时照样退 0、日志照样收在
 * `[info] html generated at …` 上 —— 现场是「退出码 0 + 说生成了 + 产物一个没更新」，
 * 下一次有人发现已经是「翻 `docs/api` 看到它过期」。现在换成一个会验产物、会重试、
 * 全失败就退 1 的入口（背景与判据见 `typedoc-run.mjs` 的文件头）。
 *
 * ⚠️ **产物不再进 git**（ISSUE #2231）：`docs/api/` 进了 `.gitignore` ⇒ 本命令生成的
 * 那份只是**本机的一份副本**，没有「必须一并提交」的义务，也没有人会因为它过期而红
 * ——「提交进 git 的那份产物与源同不同步」这个问题连同它的判据一起没了
 * （见 `scripts/check-docs-api.cjs` 的文件头）。平台侧那一格
 * （`.cnb.yml` 的「API 文档生成与自检」）跑的是同一份生成 + 一道自检。
 *
 * ⚠️ 别写 `pnpm docs`：那是 pnpm 的**内建命令**（`pnpm docs <PACKAGE>` 打开某包的
 * 文档），会抢在脚本前面、typedoc 根本不跑。带脚本名的动词要用 `pnpm run <脚本>`。
 *
 * ⚠️ **别把本文件 `await import` 进任何 `.cjs` / `.ts` / `.js`**（跨平台动作用
 * `.mjs` 是 §9.5 的口径，但「被 import」这件事有个副作用）：仓库的 `tsconfig.json`
 * 把全仓的 `.cjs` / `.ts` / `.js` 都编进了 program，而 typedoc 用的正是那份
 * program ⇒ 一个被 import 的 `.mjs` 会**跟着进 typedoc 的类型检查面**，它身上的类型
 * 错误会让 typedoc 直接退 3（实测：`scripts/` 下一批 `.mjs` 有几十处存量类型错误）。
 * 现在 `scripts/check-docs-api.cjs` 只 import `scripts/typedoc-run.mjs` 与
 * `scripts/docs-api-input-closure.mjs` —— 这两个（连同它们的传递依赖）都是类型干净的。
 *
 * 用法：
 *   node scripts/generate-api-docs.mjs                 # 写 docs/api（默认）
 *   node scripts/generate-api-docs.mjs --out <dir>     # 写到别处（排查 / 比对用）
 *   node scripts/generate-api-docs.mjs --attempts 1    # 不重试（想看原始失败时）
 * 退出码：0 产物已更新；1 跑了但产物没更新（或 typedoc 起不来）。
 */
import path from "node:path";
import process from "node:process";

import { DEFAULT_ATTEMPTS, runTypedoc } from "./typedoc-run.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
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
    /* `noUncheckedIndexedAccess` 之下按下标取到的是 `string | undefined`；
     * `i < argv.length` 已保证这一格有值，守卫只把这件事写给类型检查器看 ——
     * 与 `scripts/dev.mjs` 的 `parseArgs` 同一个写法（下面那个闭包读的是同一个
     * `const`，收窄会跟着进去，所以只需要在这一处收一次）。 */
    if (arg === undefined) continue;
    const value = () => {
      const eq = arg.indexOf("=");
      if (eq > 0) return arg.slice(eq + 1);
      return argv[++i] ?? "";
    };
    if (arg === "--out" || arg.startsWith("--out=")) opts.out = value();
    else if (arg === "--attempts" || arg.startsWith("--attempts=")) {
      const n = Number.parseInt(value(), 10);
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
