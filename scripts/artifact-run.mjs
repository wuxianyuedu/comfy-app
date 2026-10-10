#!/usr/bin/env node
/**
 * artifact-run.mjs — 产物级护栏那一档的**记账通道**（规范 §13.5.4 / §13.5.12）。
 *
 * 为什么它需要一条账：`pnpm run build` + `node scripts/check-standalone-contents.cjs`
 * 是 ISSUE #623 删掉平台流水线之后**没有自动执行者**的判定档之一（§13.5.3 的欠账表
 * 点名了它）。而它的失效形态恰好是**最不容易被发现**的那一类：
 *   · `next build` 无条件把仓库根 `.env` 与 `db.sqlite` 拷进 `.next/standalone`
 *     （AGENTS 硬规则 17）—— 产物级防线是 `standalone-private-inputs.mjs` 在
 *     `pnpm build` 收尾剥一次、`check-standalone-contents.cjs` 真数一次；
 *   · `outputFileTracingIncludes` 漏了 Next 运行时脚本时，表现是「**页面全 200、
 *     每个接口 500**」（硬规则 18）—— 只有真构建过才看得见。
 * 两者都只在**真跑过一次构建**时才有结论，而此前跑不跑全靠人记得。
 *
 * 判据与 `full` 那一档同形（`checkFreshnessLedger` 的 `track.dirty` 那一档），
 * 差异**只在数据上**：这一档吃的是产物链那几个文件（`next.config.js` / `src-tauri/**` /
 * 组装产物的几个脚本），而不是 `src/` 全目录 —— 改一个组件不必重新数一遍产物。
 *
 * 记账语义与另外三档**逐字同一份实现**（`writeFreshness` / `writeSkipRecord`）。
 *
 * 用法：
 *   node scripts/artifact-run.mjs --dry-run        只打印本次会跑什么（无副作用）
 *   node scripts/artifact-run.mjs                  构建 + 数产物，绿了记一笔账
 *   node scripts/artifact-run.mjs --skip "<理由>"   今天不跑，记一条写明理由的豁免
 *   node scripts/artifact-run.mjs --dirty "<理由>"  这次改动不吃这一档，记一条
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseLedgerFlag, writeLedgerNote } from "./daily-run.mjs";
import { runPnpmSync } from "./launcher-core/shell.mjs";
import {
  freshnessTrack,
  gitUser,
  writeFreshness,
} from "./freshness-ledger.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** 本档的登记（账文件 / 键 / 名字 / 「怎么跑」那条命令）。 */
export const TRACK = freshnessTrack("artifact");

/**
 * 本次要跑的两步 —— 抽成纯函数是为了让「跑的是什么」可被判据核。
 *
 * **两步都在 `pnpm run build` 里**（`package.json` 的那一行是
 * `next build && … && standalone-private-inputs.mjs && check-standalone-contents.cjs && …`），
 * 所以这里不另拼一遍：再抄一份就是「两处各写一条产物链」，而漏掉其中一步的表现是
 * 「构建绿了、产物里那把刀却没跑」（AGENTS 硬规则 17 判过的形态）。
 *
 * @param {string[]} [extra] 透传的额外参数
 * @returns {{label: string, args: string[]}}
 */
export function planRun(extra = []) {
  return {
    label: "产物级护栏（next build + 剥私有输入 + 数产物 + 冒烟）",
    args: ["run", "build", ...extra],
  };
}

/**
 * 这一跑该不该记账 —— 抽成纯入口，好让「红了不记」这条边界能被真跑一次。
 *
 * @param {{exitCode: number, dryRun: boolean}} input
 * @returns {boolean}
 */
export function shouldRecord({ exitCode, dryRun }) {
  return exitCode === 0 && !dryRun;
}

/**
 * @param {string[]} argv
 * @returns {number}
 */
function main(argv) {
  const dryRun = argv.includes("--dry-run");
  for (const flag of /** @type {const} */ (["--skip", "--dirty"])) {
    const parsed = parseLedgerFlag(argv, flag);
    if (parsed.mode === "run") continue;
    if (parsed.reason === null) {
      process.stderr.write(
        `[artifact-run] ✗ 理由（"${String(argv[argv.indexOf(flag) + 1] ?? "").trim()}"）` +
          "不算「有人回答过」—— 写清为什么（占位词与过短的理由都被拦）。\n" +
          `        用法：node scripts/artifact-run.mjs ${flag} "本次只改组件样式，不动产物链"\n`,
      );
      return 2;
    }
    if (dryRun) {
      process.stdout.write(`[artifact-run] 本次不跑、只记一条（${parsed.mode}）：${parsed.reason}\n`);
      return 0;
    }
    return writeLedgerNote({
      root: ROOT,
      kind: "artifact",
      mode: parsed.mode,
      reason: parsed.reason,
    });
  }
  const extra = argv.filter((a) => a !== "--dry-run");
  const run = planRun(extra);
  if (dryRun) {
    process.stdout.write(
      `[artifact-run] ${run.label} → pnpm ${run.args.join(" ")}\n`,
    );
    process.stdout.write(
      `[artifact-run] 记账文件：${TRACK.ledger}（键 \`${TRACK.key}\`，跑法 \`${TRACK.run}\`）\n`,
    );
    return 0;
  }
  const res = runPnpmSync(run.args, { cwd: ROOT, stdio: "inherit" });
  const exitCode = res.status ?? 1;
  if (!shouldRecord({ exitCode, dryRun })) {
    process.stderr.write(
      `[artifact-run] ✗ 产物级护栏未通过（退出码 ${res.status ?? "信号"}）—— **不记账**：\n` +
        "        这条账记的是「上一次真跑绿」，红着记一条「我跑过」会把两件事混成一件。\n" +
        `        规范：AGENTS.md 硬规则 17 / 18、docs/standards/13 章 §13.5.4\n`,
    );
    return exitCode;
  }
  const { note } = writeFreshness({ root: ROOT, kind: "artifact", who: gitUser(TRACK.key) });
  process.stdout.write(`[artifact-run] ✓ 产物级护栏通过\n[artifact-run] ${note}\n`);
  return 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(main(process.argv.slice(2)));
}
