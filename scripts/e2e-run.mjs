#!/usr/bin/env node
/**
 * e2e-run.mjs — 真正跑一次**全量 e2e** 的那一层，跑绿即记一笔新鲜度账
 * （规范 §13.5.4「按需召唤」的那一层；账的形状见 §11.8）。
 *
 * 为什么这一档也需要一条账（ISSUE #1545 收尾时点名、#1547 落地）：
 * 入库的 linux 像素基线**过期了两天**而没有任何东西报红 —— 它的触发条件是嵌套在
 * 全量 e2e 里的（`playwright.config.ts` 的 `testMatch` 把 `*.visual.spec.ts` 与普通
 * e2e 一起收进同一次 `playwright test`），而 `pnpm test:e2e` 此前是「人记得就跑」：
 * 没有任何东西守它上一次是绿的。那次是靠人手动跑了一遍才发现的。
 *
 * 与像素那一档的分工（两条账**同形而不同键**，见 `visual-baselines.mjs` 的
 * `FRESHNESS_TRACKS`）：
 *   · 像素档（`pnpm check:visual`）判「这一档基线现在还跑得绿」，代价小、有明确触发面
 *     （改了 `e2e/visual/**` 或 `playwright.config.ts`），并且**每次提交都会被点名**
 *     （`scripts/freshness-gate.mjs` 在 D 组判两份账）。
 *   · 本文件是全量 e2e 那一档：它是像素档的**超集**（同一次 `playwright test` 里既跑
 *     spec 也跑像素），代价与「起 webServer + 浏览器 + 全量 spec」一个量级 ——
 *     不可能进钩子（§13.5.4 的成本判据），所以它靠**人按需跑 + 跑绿即记账**。
 *
 * 记账这一步与像素档逐字同形（`writeFreshness`，同一份实现）：**只有绿了才记**、
 * 红着不记（跑过 ≠ 跑绿过），账上的日期因此是「上一次真跑绿」的事实而不是一句承诺。
 * 它替代不了「现在这一跑绿不绿」，它的价值是把 `pnpm test:e2e` 从「人记得就跑」
 * 变成一条**每次提交都能被看见的读数**。
 *
 * 这一档还多一条**每日自证**（ISSUE #1282）：`pnpm test:e2e` 跑绿即记，或
 * `--skip "<理由>"` 记一条写明理由的豁免 —— 两者都能让「**当天的第一次提交**带没带
 * 一次凭证」那条判据放行（`visual-freshness-gate.mjs` 的 `track.daily`）。
 * 豁免不是绕过：它留下的是一条能被复核的事实（占位词与过短的理由都被拦）。
 *
 * 用法：
 *   node scripts/e2e-run.mjs --dry-run   只打印本次会起什么（无副作用）
 *   node scripts/e2e-run.mjs             跑全量 e2e，绿了记一笔账
 *   node scripts/e2e-run.mjs --grep @critical   传给 Playwright 的额外参数（透传）
 *   node scripts/e2e-run.mjs --skip "<理由>"     不跑，记一条写明理由的豁免账
 *
 * **不落盘**：本档不产基线（那是像素档的 `--update` 档），所以这里没有「录」这一路。
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseLedgerFlag, writeLedgerNote } from "./daily-run.mjs";
import { freshnessTrack, writeFreshness } from "./visual-baselines.mjs";
import { gitUser } from "./pixel-run.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** 本档的登记（账文件 / 键 / 名字 / 「怎么跑」那条命令）。 */
export const TRACK = freshnessTrack("e2e");

/** e2e 目录 —— 与 `playwright.config.ts` 的 `testDir` 同一处落点。 */
export const E2E_DIR = "e2e";

/**
 * 解析 Playwright 的 CLI 入口。
 *
 * 与 `pixel-run.mjs` 同一条理由（§12.12：两处各写一份就会漂）：不写死
 * `node_modules/@playwright/test/cli.js`（pnpm 布局下顶层那个是链接），也不
 * `spawn` 裸 `pnpm exec playwright`（Windows 上那经 `.cmd` shim，Node 直接起会
 * `EINVAL`，规范 §2.1.1 判定过的形态）。
 *
 * ⚠️ 这里确实是第二份实现，但**不是孪生对**：它只解决「入口在哪」这一件事，
 * 而两条跑法真正共享的东西（记账读写、账的形状、档的登记）都在
 * `visual-baselines.mjs`。把这段也抽出去会让 `pixel-run.mjs` 为「别人怎么解析
 * CLI」多背一个出口，而两处的调用形态（一个跑目录、一个跑全量）本来就不一样。
 *
 * @param {string} cwd
 * @returns {string}
 */
export function resolvePlaywrightCli(cwd = ROOT) {
  const require = createRequire(path.join(cwd, "noop.js"));
  const pkgPath = require.resolve("@playwright/test/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const bin = pkg?.bin?.playwright;
  if (typeof bin !== "string") {
    throw new Error(`[e2e-run] @playwright/test 没有 bin.playwright：${pkgPath}`);
  }
  const entry = path.resolve(path.dirname(pkgPath), bin.replace(/^\.\//, ""));
  if (!existsSync(entry)) {
    throw new Error(`[e2e-run] Playwright CLI 入口不存在：${entry}`);
  }
  return entry;
}

/**
 * 本次要跑的那一次调用 —— 抽成纯函数是为了让「跑的是什么」可被判据核。
 *
 * 传入的额外参数**按位置透传**（`--grep @critical` 之类），所以这个函数只管
 * 拼默认形态；`testMatch` 由 `playwright.config.ts` 定，这里不抄目录清单
 * （抄一份就会与配置漂）。
 *
 * @param {string[]} [extra]
 * @returns {{label: string, args: string[]}}
 */
export function planRun(extra = []) {
  return {
    label: "全量 e2e（Playwright：普通 spec + e2e/visual 像素档）",
    args: ["test", ...extra],
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
 * 从 argv 里读出「这次是不是记一条豁免」—— 「给定开关 → 读理由 → 判合不合用」那三步
 * 收在 `scripts/daily-run.mjs` 的 `parseLedgerFlag`（四档共用一份，§12.12）。
 *
 * 这一层只是**把返回值映射回本档历史的形状**（`{skipped, reason}`）：`parseSkip` 自
 * ISSUE #1282 起被 `tests/e2e-run.test.ts` 直接断言，而形状变了没有任何东西会红 ——
 * 那条边界（缺理由 / 占位理由 / 没给）值得留着。
 *
 * 参数收 `unknown[]` 而不是 `string[]`：「`--skip` 后面什么都没给」时那一格读出来就是
 * `undefined`，正是本判据要覆盖的形状。声明成 `string[]` 会把这条边界挪到调用方去绕。
 *
 * @param {unknown[]} argv
 * @returns {{skipped: boolean, reason: string | null}}
 */
export function parseSkip(argv) {
  const { mode, reason } = parseLedgerFlag(argv, "--skip");
  return { skipped: mode === "skip", reason };
}

/**
 * @param {string[]} argv
 * @returns {number}
 */
function main(argv) {
  const dryRun = argv.includes("--dry-run");
  /* `--skip "<理由>"` 是**另一条出路**，不是绕过：它写的是一条有人回答过的账
   * （理由要能被复核），判据照样放行。两者都不是「什么都不做」。
   * 与 `--dry-run` 互斥地先处理：给了 `--skip` 就不该再去起 Playwright。 */
  const skip = parseSkip(argv);
  if (skip.skipped) {
    if (skip.reason === null) {
      const raw = argv[argv.indexOf("--skip") + 1];
      process.stderr.write(
        `[e2e-run] ✗ 豁免理由（"${String(raw ?? "").trim()}"）不算「有人回答过」—— ` +
          "写清这次为什么不跑（占位词与过短的理由都被拦）。\n" +
          '        用法：node scripts/e2e-run.mjs --skip "本次只改文档，不动功能链路"\n',
      );
      return 2;
    }
    if (dryRun) {
      process.stdout.write(`[e2e-run] 本次不跑、只记豁免：${skip.reason}\n`);
      return 0;
    }
    return writeLedgerNote({
      root: ROOT,
      kind: "e2e",
      mode: "skip",
      reason: skip.reason,
    });
  }
  const extra = argv.filter((a) => a !== "--dry-run");
  const run = planRun(extra);
  if (dryRun) {
    process.stdout.write(
      `[e2e-run] ${run.label} → playwright ${run.args.join(" ")}\n`,
    );
    process.stdout.write(
      "[e2e-run] 说明：本档不产基线（那是 `pnpm check:visual --update` 那一档）；" +
        "跑绿之后会把这一档的**新鲜度**记进账里\n" +
        `[e2e-run] 记账文件：${TRACK.ledger}（键 \`${TRACK.key}\`，跑法 \`${TRACK.run}\`）\n`,
    );
    return 0;
  }

  const entry = resolvePlaywrightCli();
  /* 与本仓库其它跑法一致：`CI` 没设就不要给它设（空串 ≠ 未设置）。`CI` 的真假决定
   * `playwright.config.ts` 走 `pnpm dev` 还是 `pnpm start`，而后者要求先有生产构建 ——
   * 把这一步留给 Playwright 自己按环境判，本文件不改它的语义。 */
  const env = { ...process.env };
  if (!env.CI) delete env.CI;
  process.stdout.write(`[e2e-run] ${run.label} → playwright ${run.args.join(" ")}\n`);
  const res = spawnSync(process.execPath, [entry, ...run.args], {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });
  const exitCode = res.status ?? 1;
  if (!shouldRecord({ exitCode, dryRun })) {
    process.stderr.write(
      `[e2e-run] ✗ 全量 e2e 未通过（退出码 ${res.status ?? "信号"}）—— **不记账**：\n` +
        "        这条账记的是「上一次真跑绿」，红着记一条「我跑过」会把两件事混成一件。\n" +
        "        红的定性先按 §11.13 隔离重跑那条走，别把红当成「账没记上」。\n" +
        `        规范：docs/standards/11-测试与可观测性.md §11.8 / ` +
        "docs/standards/13-提交与-code-review.md §13.5.4\n",
    );
    return exitCode;
  }
  const { note } = writeFreshness({
    root: ROOT,
    kind: "e2e",
    who: gitUser(TRACK.key),
  });
  process.stdout.write(`[e2e-run] ✓ 全量 e2e 通过\n[e2e-run] ${note}\n`);
  return 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(main(process.argv.slice(2)));
}
