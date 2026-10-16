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
import {
  canAutoApply,
  pendingStatements,
  pushSchema,
  riskyStatements,
} from "./db-push-core.mjs";
import {
  ensureSchemaCurrent,
  probeSchemaSync,
  readSchemaFingerprint,
  schemaFingerprint,
} from "./db-schema-state.mjs";
import { parseLedgerFlag, writeLedgerNote } from "./daily-run.mjs";
import {
  E2E_PREFLIGHT_ENV_KEY,
  encodePreflight,
  runPreflight,
} from "../e2e/support/preflight-ports.mjs";
import { resolveFakeComfyuiPort } from "../e2e/support/fake-comfyui-endpoint.mjs";
import {
  checkBrowserReady,
  describeBrowserMissing,
} from "../e2e/support/preflight-browser.mjs";
import {
  checkPythonReady,
  describePythonMissing,
  encodePythonPreflight,
  PYTHON_PREFLIGHT_ENV_KEY,
} from "../e2e/support/preflight-python.mjs";
import {
  freshnessTrack,
  gitUser,
  isWholeTrackRun,
  notWholeTrackNotice,
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
    args: ["test", ...stripArgvSeparator(extra)],
  };
}

/**
 * 丢掉 `--` 这个**参数分隔符**本身 —— 它此前被原样透传，代价是一整档的判据静默失效。
 *
 * ## 它修的那一格（ISSUE #1948 现场）
 *
 * `pnpm test:e2e -- e2e/smoke.spec.ts` 是本档文档里给的姿势（`--` 之后是「传给
 * Playwright 的额外参数」）。而 pnpm 对**简写调用**（`pnpm <脚本> -- args`）**不**剥
 * 那个分隔符 —— 实测 `pnpm test:e2e:dry -- e2e/smoke.spec.ts` 打出来的计划是
 * `playwright test -- e2e/smoke.spec.ts`，于是 `--` 一路到了 Playwright。
 *
 * Playwright 把 `--` 之后的**位置参数**当「不是选项、也不是要跑的用例」：实测
 * `playwright test --list -- e2e/smoke.spec.ts` 列 **81 条**，而
 * `playwright test --list e2e/smoke.spec.ts` 列 **3 条**。也就是说，一条
 * 「只跑冒烟档」的命令跑掉了整档，而它的退出码与输出里没有任何东西在说这件事
 * ——用户以为跑了 3 条、实际跑了 81 条（更坏的方向：以为跑过了关键路径，
 * 其实那一条根本没在筛选集里）。
 *
 * ## 为什么剥掉是安全的
 *
 * `--` 在本档的语义就是「后面的都是给 Playwright 的」—— 它没有第二个用途，
 * 也没有哪条 Playwright 参数需要靠它才不被当成选项（Playwright 的参数表里没有
 * 与用例路径同形的开关）。所以「剥掉分隔符、其余按位置透传」与调用方的本意
 * **逐字相同**，且它把这个坑收在一处：`--grep @critical` 这类不带分隔符的旧写法
 * 不受影响。
 *
 * 只剥**第一个**恰好等于 `--` 的那一项：分隔符的语义就是「第一个之后都是参数」，
 * 后面的 `--`（真想去表达一个叫 `--` 的值时）不该被一起吞掉 —— 全删会把
 * `-- -- x` 变成 `x`，而人写的是「分隔符 + 参数 `--` + 参数 `x`」。
 *
 * @param {string[]} argv
 * @returns {string[]} 剥掉分隔符之后的参数
 */
export function stripArgvSeparator(argv) {
  const at = argv.indexOf("--");
  if (at === -1) return argv;
  return [...argv.slice(0, at), ...argv.slice(at + 1)];
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
 * 两个条件缺一不可：**绿** 且 **跑的是整档**。第二条是补上的（实测洞）：本档支持
 * 透传参数，而 `--help` 会让 Playwright 打一段 usage 就退 0 —— 只看退出码时，
 * 一条 `--help` 就能给「全量 e2e」买到一整天的凭证。形状判据与另两档共用一份
 * （`freshness-ledger.mjs` 的 `isWholeTrackRun`，§12.12）。
 *
 * @param {{exitCode: number, dryRun: boolean, extra?: string[]}} input
 * @returns {boolean}
 */
export function shouldRecord({ exitCode, dryRun, extra = [] }) {
  return exitCode === 0 && !dryRun && isWholeTrackRun(extra).ok;
}

/**
 * 开跑前的 **schema 预检判词**（纯函数，不起 drizzle、不碰库）。
 *
 * ## 为什么 e2e 需要这一卡（ISSUE #1834 收尾翻出来的现场）
 *
 * 本机 dev 库落后当前 schema 好几个版本，而待执行批次里含
 * `DROP TABLE loraTrainingJob`（丢数据）—— 启动链路**按设计**不自动执行这批
 * （`db-schema-state.mjs`：那种变更必须由人决定）。于是 `pnpm dev` 起来时
 * `task` 表一直缺 6 列，`queue-status.server.ts` 的查询 500，
 * **queue-monitor 四条 + main-journey 两条稳定红**，报错话术全在说
 * 「元素没出现」——看着像产品 bug，真因是这一台机器的库没同步。
 *
 * 这一卡不修库（那是人的决定），它只把「跑 8 分钟产出一片看不懂的红」
 * 换成「开跑前 30 秒告诉你要跑什么」：
 *   · 库还是空的（没表 / 读不到）⇒ **建齐它**（`ensure`，见下）；
 *   · 指纹一致 ⇒ 放行（正常机器，零成本，毫秒级）；
 *   · 不一致但 dry-run 没有待执行语句 ⇒ 放行（指纹只是没登记，库本来就对）；
 *   · 不一致且全是安全语句（建表 / 建索引 / 加列）⇒ 放行（启动链路会后台应用，
 *     与不带这一卡时的行为一致）；
 *   · 不一致且**含丢数据语句** ⇒ **阻断**：给出逐条语句与 `pnpm db:push` 出口。
 *
 * ## 空库为什么必须在这里**建齐**，而不是「交给启动链路」（ISSUE #1948）
 *
 * 这一档此前对空库说的是「建表那一批启动链路会自动应用」，然后**放行**。那句话
 * 本身没错，错在**时机**：webServer 是 `pnpm dev` / `pnpm start`，两者起
 * schema 同步的方式都是 `spawnSchemaSync` —— **detached、不等待**（那正是它的
 * 设计：把 15~30 秒还给人）。而 Playwright 等的是 `webServer.url` **可访问**，
 * Next 一 up 就满足，于是冒烟档的健康检查断言在**建表还没跑完**时就打过去：
 * 全新检出的现场是 `db: "empty"` ⇒ 503 ⇒ 冒烟那条 `@critical` 必红；用户以为
 * 「跑 `pnpm db:push` 才好」，实际是**这一档的启动顺序**把同步甩在了后面。
 *
 * 所以空库不进「放行」那一档，它是一个**要等**的动作：本档自己在 spawn Playwright
 * 之前把它建齐（`ensureSchemaCurrent`，与 `pnpm db:push` / 启动链路同一个出口，
 * 不另造一份实现）。只有它真建好了才放行 —— 那时冒烟探到的就是一张齐的库。
 *
 * 判据只对**空库**加这一步：`probe === "ready"` 的机器（绝大多数）零成本，
 * 不会因为这条改动多付一次 drizzle。
 *
 * @param {{
 *   probe: "ready" | "missing" | "unknown",
 *   fingerprintMatch: boolean,
 *   pending: string[],
 *   autoApplyable: boolean,
 * }} input
 * @returns {{verdict: "proceed" | "ensure" | "abort", reason: string, risky?: string[]}}
 */
export function schemaPreflightDecision({
  probe,
  fingerprintMatch,
  pending,
  autoApplyable,
}) {
  if (probe !== "ready") {
    return {
      verdict: "ensure",
      reason:
        "库里还没有表或读不到（全新检出 / 空库）—— 起 Playwright 之前先按 schema 建齐" +
        "（启动链路的同步是后台的、不等它，冒烟档会在建表完成前打健康检查）",
    };
  }
  if (fingerprintMatch) {
    return { verdict: "proceed", reason: "库结构与当前 schema 一致" };
  }
  if (pending.length === 0) {
    return {
      verdict: "proceed",
      reason:
        "指纹不一致但 dry-run 没有待执行语句（指纹只是没登记，库本来就对）",
    };
  }
  if (autoApplyable) {
    return {
      verdict: "proceed",
      reason: `待执行 ${pending.length} 条全是安全语句（建表 / 建索引 / 加列）—— 启动链路会后台应用`,
    };
  }
  return {
    verdict: "abort",
    reason:
      "库结构与当前 schema 不一致，且待执行语句里含「会丢数据」的变更 —— " +
      "启动链路（含本轮 webServer 的 pnpm dev）按设计不自动执行这批",
    risky: riskyStatements(pending),
  };
}

/**
 * 开跑前的 schema 预检（取证那一层：读指纹，不一致时 dry-run 一次 drizzle）。
 *
 * 与 `db-schema-state.mjs` 的 `ensureSchemaCurrent` **同源不同职**：那个是
 * 启动链路的唯一出口（会真的去同步），这个只回答「该不该放行 e2e 这一趟」，
 * 本函数**自己也不写库** —— 它只在空库那一档回 `ensure`，由 `main` 调那份唯一
 * 实现去建（见下）。指纹一致时零成本（不启动 drizzle）；只有不一致才付一次
 * dry-run（本机约 17 秒）—— 而那一刻本来就该被拦下。
 *
 * @param {string} [root]
 * @returns {{verdict: "proceed" | "ensure" | "abort", reason: string, risky?: string[]}}
 */
export function checkSchemaBeforeRun(root = ROOT) {
  const probe = probeSchemaSync(root);
  if (probe !== "ready") {
    return schemaPreflightDecision({
      probe,
      fingerprintMatch: false,
      pending: [],
      autoApplyable: false,
    });
  }
  const want = schemaFingerprint(root);
  /* 判据失效（读不到 schema 源 / 读不到库里的指纹）时**不阻断**：那一档
   * 没有结论可用，而「拿不到结论」不等于「库是旧的」—— 与 `ensureSchemaCurrent`
   * 报 `unknown` 的同一条口径。 */
  if (want === null) {
    return {
      verdict: "proceed",
      reason: "读不到 schema 源文件（判据失效，不阻断）",
    };
  }
  const have = readSchemaFingerprint(root);
  if (have === null) {
    return {
      verdict: "proceed",
      reason: "读不到库里的指纹（判据失效，不阻断）",
    };
  }
  if (have === want) {
    return schemaPreflightDecision({
      probe,
      fingerprintMatch: true,
      pending: [],
      autoApplyable: false,
    });
  }
  /* `force: false` 在无 TTY 下就是一次 dry-run：drizzle 先把语句列出来、
   * 再要求确认，而确认弹不出来时它原地退出、库不动 —— 那份语句列表正是
   * 「这批变更危不危险」的唯一依据（口径与 `ensureSchemaCurrent` 同一处）。 */
  const probeRun = pushSchema(root, { force: false, forward: () => {} });
  const pending = pendingStatements(probeRun.firstOutput);
  return schemaPreflightDecision({
    probe,
    fingerprintMatch: false,
    pending,
    autoApplyable: canAutoApply(pending),
  });
}

/**
 * 空库那一档：**起 Playwright 之前**把表建齐，并复核它真的落地了。
 *
 * 与 `checkSchemaBeforeRun` 是同一趟的两步：那个只**判**（永远不写库），这个在
 * 判成 `ensure` 时才**做**。做的那一步调的是 `ensureSchemaCurrent` —— 与
 * `pnpm db:push` / 启动链路 / 状态栏「立即同步」**同一份实现**（§12.18：缺能力
 * 补地基，不在调用点重抄一份建表逻辑）。
 *
 * ## 为什么必须等它，而不是「启动链路会后台应用」（ISSUE #1948 的根因）
 *
 * `spawnSchemaSync` 是 detached 且不等待的（那是它的设计：把 15~30 秒还给人），
 * 而 Playwright 要等的只是 webServer 的 URL **可访问**。于是全新检出时冒烟档的
 * 健康检查一定在建表完成之前打过去 —— 现场是 `db: "empty"` ⇒ 503 ⇒ 那条
 * `@critical` 必红，而话术说的是「数据库表还没建好」，看起来像环境没准备好，
 * 实际是这一档的启动顺序把同步甩在了后面。这里把它等回来。
 *
 * ## 判据只认「这一趟做完之后库是不是齐的」
 *
 * `ensureSchemaCurrent` 会按自己的白名单决定做不做（含丢数据语句时它不自动应用、
 * 报 `stale`）—— 本函数不越权，只把它的结论翻成本档的放行/阻断：
 *   · `ready` / `synced` ⇒ 放行（齐了）；
 *   · `missing` / `stale` ⇒ 阻断，出口是 `pnpm db:push`（那是人的决定）；
 *   · `unknown` ⇒ **不阻断**（拿不到结论不等于库是坏的，与另两处 `unknown`
 *     同一条口径），交给随后的用例如实报。
 *
 * 每次调用最多起一轮 drizzle（建表那一档本机实测 2~4 秒，空库一次建齐 23 张表）；
 * 非空库根本到不了这里（`checkSchemaBeforeRun` 已经放行）。
 *
 * @param {{root?: string, forward?: (chunk: string) => void,
 *          ensure?: typeof ensureSchemaCurrent}} [options]
 *   `ensure` 可注入，让两个方向都能被真跑一次。
 * @returns {{verdict: "proceed" | "abort", state: string, reason: string}}
 */
export function ensureSchemaBeforeRun(options = {}) {
  const { root = ROOT, forward, ensure = ensureSchemaCurrent } = options;
  const result = ensure(root, forward ? { forward } : {});
  switch (result.state) {
    case "ready":
      return {
        verdict: "proceed",
        state: result.state,
        reason: "库结构与当前 schema 一致",
      };
    case "synced":
      return {
        verdict: "proceed",
        state: result.state,
        reason: "空库已按 schema 建齐（起 Playwright 之前完成）",
      };
    case "unknown":
      /* 判据失效不阻断：拿不到结论 ≠ 库坏了（同 `checkSchemaBeforeRun` 那两处）。 */
      return {
        verdict: "proceed",
        state: result.state,
        reason: `库结构核对拿不到结论（${result.detail ?? "原因未知"}）—— 不阻断`,
      };
    default:
      /* `missing`（没建成）/ `stale`（含丢数据语句、启动链路不替你做那个决定）。 */
      return {
        verdict: "abort",
        state: result.state,
        reason:
          `数据库没建齐（${result.state}）：${result.detail ?? "原因未知"}。` +
          "这是需要人决定的一步，先执行：pnpm db:push   然后重跑本档。",
      };
  }
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

  /* **这一档要用的 Python 在吗**（ISSUE #1959 第四轮，e2e 侧）。
   *
   * 假 comfy-cli 是一个 Python 包，主链路那条 `@critical` 用例要由它起执行器 ——
   * 缺解释器时此前只有 Playwright 的 worker stdout 里那一行 `⚠ 假 comfy-cli 未注入`，
   * 而人看到的是两条「执行器收口失败」的功能红（一件事报成两条）。
   *
   * 判红**不放行**：跑下去那两条必然红，而报错指不到真因。出口写在话术里。
   * 这一档不是为了「让流水线红得好看」，而是让「一台没装 Python 的机器上跑 e2e」
   * 的结论在开跑前就成立（同批的浏览器预检同口径）。 */
  const python = checkPythonReady({ env });
  env[PYTHON_PREFLIGHT_ENV_KEY] = encodePythonPreflight(python);
  if (python.verdict === "missing") {
    process.stderr.write(`${describePythonMissing(python)}\n`);
    return 2;
  }
  process.stdout.write(`[e2e-run] Python 预检：${python.detail}\n`);
  process.stdout.write(
    `[e2e-run] ${run.label} → playwright ${run.args.join(" ")}\n`,
  );
  const mode = resolveServerMode(env);
  process.stdout.write(
    `[e2e-run] webServer：${mode.start ? "pnpm start（生产构建，首屏零编译）" : "pnpm dev（Turbopack，首帧现场编译）"}` +
      ` / 并发：${mode.workers ?? "Playwright 默认"}\n`,
  );
  /* 开跑前的 schema 预检（#1834 收尾的现场）：库结构带「会丢数据」的未应用变更时，
   * webServer 会带着一张缺列的 task 表跑完全程，红成一片且每条都指向错的地方。
   * 这里把它变成开跑前一条可执行的出口。`--dry-run` / `--skip` 已在上面返回，
   * 到不了这一步。 */
  const schema = checkSchemaBeforeRun(ROOT);
  if (schema.verdict === "abort") {
    process.stderr.write(`[e2e-run] ✗ ${schema.reason}\n`);
    for (const statement of schema.risky ?? []) {
      process.stderr.write(`[e2e-run]   ${statement}\n`);
    }
    process.stderr.write(
      "[e2e-run] 跑下去的下场：task 表缺列 → queue-status 500 → " +
        "queue-monitor / main-journey 一批红，报错说的是「元素没出现」。\n" +
        "[e2e-run] 这是要人做「丢不丢得起」决定的变更。先执行：pnpm db:push   然后重跑本档。\n",
    );
    return 2;
  }
  /* 开跑前先问一句「这一档要用的浏览器在不在」（ISSUE #1948）。
   *
   * 缺件时的形态是**全档每一条都报同一个 launch 失败**，而 Playwright 给的那句
   * `Executable doesn't exist at …` 会被埋在 81 份堆栈里 —— 看着像 81 个问题，
   * 实际是一件事。这一探把它变成开跑前一行 + 一条可执行的命令。
   *
   * **放在 schema 预检之前**：探浏览器是毫秒级（判完即关），而空库那一档要付
   * 一轮 drizzle 建表（秒级）—— 缺浏览器时没必要先花那个时间。 */
  const browser = await checkBrowserReady();
  if (browser.verdict === "missing") {
    process.stderr.write(`${describeBrowserMissing(browser)}\n`);
    return 2;
  }
  process.stdout.write(
    `[e2e-run] 浏览器预检：${
      browser.verdict === "ready"
        ? "这一档要用的浏览器能起来"
        : `拿不到结论（${browser.detail ?? "原因未知"}）—— 不阻断`
    }\n`,
  );
  process.stdout.write(`[e2e-run] schema 预检：${schema.reason}\n`);
  /* 空库那一档**在这里等它建齐**（ISSUE #1948）：启动链路的同步是后台的
   * （`spawnSchemaSync` detached、不等待），而 Playwright 等的是 webServer 的
   * URL 可访问 —— Next 一 up 就满足，于是冒烟档的健康检查会在建表还没跑完时打
   * 过去，全新检出的现场是 `db: "empty"` ⇒ 503 ⇒ 那条 `@critical` 必红。 */
  if (schema.verdict === "ensure") {
    const ensured = ensureSchemaBeforeRun({
      root: ROOT,
      forward: (chunk) => process.stdout.write(`[e2e-run]   ${chunk}`),
    });
    if (ensured.verdict === "abort") {
      process.stderr.write(`[e2e-run] ✗ ${ensured.reason}\n`);
      return 2;
    }
  }
  const res = spawnSync(process.execPath, [entry, ...run.args], {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });
  const exitCode = res.status ?? 1;
  if (exitCode === 0 && !shouldRecord({ exitCode, dryRun, extra })) {
    /* **绿了但不记账**：这一跑透传了参数（`--grep`、指到单个文件、甚至 `--help`），
     * 跑的只是整档的一个子集或压根没跑用例。它退 0 是「那件较小的事成了」，
     * 不是「全量 e2e 绿了」—— 混记会把账变成一句承诺，而这张账的价值全在它是事实。 */
    const why = isWholeTrackRun(extra).why;
    process.stderr.write(
      `[e2e-run] ` +
        notWholeTrackNotice({
          label: "全量 e2e",
          command: "pnpm test:e2e",
          why,
        }),
    );
    return 0;
  }
  if (!shouldRecord({ exitCode, dryRun, extra })) {
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
