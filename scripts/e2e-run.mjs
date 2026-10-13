#!/usr/bin/env node
/**
 * e2e-run.mjs — 真正跑一次**全量 e2e** 的那一层，跑绿即记一笔新鲜度账
 * （规范 §13.5.4「按需召唤」的那一层；账的形状见 §11.8）。
 *
 * 为什么这一档需要一条账（ISSUE #1545 收尾时点名、#1547 落地）：`pnpm test:e2e`
 * 此前是「人记得就跑」—— 没有任何东西守它上一次是绿的，实测的形态是靠人手动跑了
 * 一遍才发现它已经红了两天。
 *
 * 代价与「起 webServer + 浏览器 + 全量 spec」一个量级（十几分钟），不可能进钩子
 * （§13.5.4 的成本判据），所以它靠**人按需跑 + 跑绿即记账**；几档的账同形而不同键，
 * 见 `freshness-ledger.mjs` 的 `FRESHNESS_TRACKS`。
 *
 * 记账走 `writeFreshness`（同一份实现）：**只有绿了才记**、红着不记（跑过 ≠ 跑绿过），
 * 账上的日期因此是「上一次真跑绿」的事实而不是一句承诺。它替代不了「现在这一跑绿不绿」，
 * 它的价值是把 `pnpm test:e2e` 从「人记得就跑」变成一条**每次提交都能被看见的读数**。
 *
 * 这一档还多一条**每日自证**（ISSUE #1282）：`pnpm test:e2e` 跑绿即记，或
 * `--skip "<理由>"` 记一条写明理由的豁免 —— 两者都能让「**当天的第一次提交**带没带
 * 一次凭证」那条判据放行（`freshness-gate.mjs` 读的 `track.daily`）。
 * 豁免不是绕过：它留下的是一条能被复核的事实（占位词与过短的理由都被拦）。
 *
 * 用法：
 *   node scripts/e2e-run.mjs --dry-run   只打印本次会起什么（无副作用）
 *   node scripts/e2e-run.mjs             跑全量 e2e，绿了记一笔账
 *   node scripts/e2e-run.mjs --grep @critical   传给 Playwright 的额外参数（透传）
 *   node scripts/e2e-run.mjs --skip "<理由>"     不跑，记一条写明理由的豁免账
 *
 * **不落盘**：本档不产基线（那是像素档的 `--update` 档），所以这里没有「录」这一路。
 *
 * ── 本地这一档跑的是「现场编译」的形态（ISSUE #1834）────────────────────
 *
 * 默认（`PNPM_START` 未设）webServer 走 `pnpm dev`（Turbopack），而 dev server 是
 * **按需编译**的：某条路由要在第一个 worker 导航到它的**那一刻**编译出来。实测
 * （win32 检出、8 worker）43 条失败里 33 条正好卡在 60s 自测向预算上、且散在互不
 * 相干的屏上 —— 那是「服务还没编译完」，不是某条断言不成立。
 *
 * 处置**不是**抬 Playwright 的 `timeout`（那是拿预算换绿，会把真挂死的检出时间一起
 * 放大），而是把并发降到与「首帧要现场编译」相容的档：判据在
 * `playwright.config.ts` 的 `resolveE2eWorkers()` 一处（`e2e-runtime-budget.test.ts`
 * 两向钉住它），本文件只负责**把这一档说出来**（`PNPM_START=1` 那一档是生产构建 +
 * 零编译，并发回到默认）。
 *
 * 账面的 `how` 因此也分两档：`--start` 那一趟记的是 `PNPM_START=1 pnpm test:e2e`
 * —— 「按哪条命令复核的」这一栏必须写清是哪一档，否则下一个人按名义命令复跑、
 * 遇到的是另一种负载，却看不出差别在哪。
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { resolveAppPort, resolveRepoRoot } from "./app-port.mjs";
import { parseLedgerFlag, writeLedgerNote } from "./daily-run.mjs";
import {
  E2E_PREFLIGHT_ENV_KEY,
  encodePreflight,
  runPreflight,
} from "../e2e/support/preflight-ports.mjs";
import { resolveFakeComfyuiPort } from "../e2e/support/fake-comfyui-endpoint.mjs";
import {
  freshnessTrack,
  gitUser,
  writeFreshness,
} from "./freshness-ledger.mjs";

const ROOT = resolveRepoRoot();

/** 本档的登记（账文件 / 键 / 名字 / 「怎么跑」那条命令）。 */
export const TRACK = freshnessTrack("e2e");

/** e2e 目录 —— 与 `playwright.config.ts` 的 `testDir` 同一处落点。 */
export const E2E_DIR = "e2e";

/**
 * 解析 Playwright 的 CLI 入口。
 *
 * 与其余几个跑法脚本同一条理由（§12.12：两处各写一份就会漂）：不写死
 * `node_modules/@playwright/test/cli.js`（pnpm 布局下顶层那个是链接），也不
 * `spawn` 裸 `pnpm exec playwright`（Windows 上那经 `.cmd` shim，Node 直接起会
 * `EINVAL`，规范 §2.1.1 判定过的形态）。
 *
 * ⚠️ 它只解决「入口在哪」这一件事，而几条跑法真正共享的东西（记账读写、账的形状、
 * 档的登记）都在 `freshness-ledger.mjs`。
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
    throw new Error(
      `[e2e-run] @playwright/test 没有 bin.playwright：${pkgPath}`,
    );
  }
  const entry = path.resolve(path.dirname(pkgPath), bin.replace(/^\.\//, ""));
  if (!existsSync(entry)) {
    throw new Error(`[e2e-run] Playwright CLI 入口不存在：${entry}`);
  }
  return entry;
}

/**
 * 解析 `playwright` 包里的一个文件（相对包根）。
 *
 * 为什么不能直接 `require.resolve("playwright/…")`：本仓库**不直接依赖**
 * `playwright` —— 它是 `@playwright/test` 的依赖，pnpm 的布局下没有顶层软链，
 * 从仓库根解析必然 `MODULE_NOT_FOUND`。所以只能**从 `@playwright/test` 那里**
 * 借一个 require 去解析（与 `resolvePlaywrightCli` 同一条思路：不写死 pnpm 的
 * `.pnpm/<name>@<version>/` 路径 —— 那会随版本漂）。
 *
 * 存在它的理由是**判据侧也要读上游源码**：`tests/e2e-fake-comfyui-endpoint.test.ts`
 * 要拿「webServer 作为 plugin 排在 globalSetup 之前」这条真实顺序来立断言，
 * 而那条断言不能自己拼路径（拼法与版本耦合，换布局就静默找不到文件）。
 *
 * @param {string} rel 相对 `playwright` 包根的路径（如 `lib/runner/index.js`）
 * @param {string} [cwd]
 * @returns {string} 绝对路径
 */
export function resolvePlaywrightFile(rel, cwd = ROOT) {
  const require = createRequire(path.join(cwd, "noop.js"));
  const testPkg = require.resolve("@playwright/test/package.json");
  /* 借 `@playwright/test` 的位置再解析一次 —— 它的依赖 `playwright` 就在那一层。 */
  const viaTest = createRequire(testPkg);
  const pwPkg = viaTest.resolve("playwright/package.json");
  const target = path.resolve(path.dirname(pwPkg), rel);
  if (!existsSync(target)) {
    throw new Error(`[e2e-run] playwright 里没有这个文件：${target}`);
  }
  return target;
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
    label: "全量 e2e（Playwright）",
    args: ["test", ...extra],
  };
}

/**
 * 本趟跑的是哪一档 webServer（`playwright.config.ts` 的 `command` 读的是同一对键）。
 *
 * **为什么这一档必须由本文件说出来**：两档的负载形态完全不同（现场编译 vs 生产构建），
 * 而它们的差别在输出里一个字都看不见 —— 下一个人看到「8.7 分钟 / 43 failed」时无法
 * 判断那是哪一种，只能重新量一遍。
 *
 * ⚠️ 与 `playwright.config.ts` 的 `resolveE2eWorkers()` **判的是同一件事**（`CI` 或
 * `PNPM_START`），但两处**刻意不互相 import**：那份配置是 Playwright 的入口文件，
 * 由 Playwright 自己加载（会连带拉起整个配置图的求值），拿它当纯函数库引进来等于
 * 让跑法脚本依赖一个它本来不认识的模块。两处的一致性由
 * `tests/e2e-runtime-budget.test.ts` 钉住（它读两侧源码比对）。
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {{start: boolean, workers: number | null}}
 *   `workers === null` = 用 Playwright 的默认并行度
 */
export function resolveServerMode(env) {
  if (env.CI || env.PNPM_START) return { start: true, workers: null };
  return { start: false, workers: COLD_COMPILE_WORKERS };
}

/**
 * 现场编译档的并发 —— `playwright.config.ts` 里那个数的**同一个值**（两处由
 * `tests/e2e-runtime-budget.test.ts` 核一致）。它只用于**报读数**，不参与判决。
 */
export const COLD_COMPILE_WORKERS = 2;

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
 * @returns {Promise<number>}
 */
async function main(argv) {
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
      "[e2e-run] 说明：跑绿之后会把这一档的**新鲜度**记进账里\n" +
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

  /* **就在这一刻**端口上有没有别人 —— 这是**唯一**能回答这个问题的时机
   * （ISSUE #1766）：再往后 Playwright 会先把 webServer 起起来并等它可访问，
   * 那时「有人应答」里就掺进了本轮自己起的服务，分不开了。结论随 env 带进
   * `globalSetup`，让它在说话时能把「起之前就在」与「本轮自己起的」分开。
   *
   * 探测**不阻断**任何事：冲突与否要看「谁在应答」（形状判据在 `globalSetup`），
   * 这里只回答「有没有人在」。 */
  const preflight = await runPreflight({
    appPort: resolveAppPort(ROOT),
    fakePort: resolveFakeComfyuiPort(env),
  });
  env[E2E_PREFLIGHT_ENV_KEY] = encodePreflight(preflight);
  process.stdout.write(
    `[e2e-run] 起 Playwright 前：应用端口 ${preflight.appOccupied ? "有人" : "空"} / ` +
      `替身端口 ${preflight.fakeOccupied ? "有人" : "空"}\n`,
  );
  process.stdout.write(
    `[e2e-run] ${run.label} → playwright ${run.args.join(" ")}\n`,
  );
  const mode = resolveServerMode(env);
  process.stdout.write(
    `[e2e-run] webServer：${mode.start ? "pnpm start（生产构建，首屏零编译）" : "pnpm dev（Turbopack，首帧现场编译）"}` +
      ` / 并发：${mode.workers ?? "Playwright 默认"}\n`,
  );
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
    /* `how` 收的是**实际跑绿的那条命令**：两档的负载形态不同，账面上必须分得开
     * （`writeFreshness` 的 `how` 那一栏就是为此存在的）。 */
    how: mode.start ? "PNPM_START=1 pnpm test:e2e" : TRACK.run,
  });
  process.stdout.write(`[e2e-run] ✓ 全量 e2e 通过\n[e2e-run] ${note}\n`);
  return 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(await main(process.argv.slice(2)));
}
