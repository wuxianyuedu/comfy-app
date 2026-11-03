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
import path from "node:path";
import process from "node:process";

import { resolveAppPort, resolveRepoRoot } from "./app-port.mjs";
/* 「怎么起 Playwright」那一族在 `e2e-run-playwright.mjs`（拆件理由见它的文件头：
 * 本文件受 900 行硬闸约束，而那一族本来就自成一体）。这里**再导出**一过，
 * 既有调用方（`tests/e2e-fake-comfyui-endpoint.test.ts` 的 `resolvePlaywrightFile`）
 * 不用改。 */
import {
  resolvePlaywrightCli,
  resolvePlaywrightInvocation,
  runChild,
} from "./e2e-run-playwright.mjs";

export {
  resolvePlaywrightCli,
  resolvePlaywrightFile,
  resolvePlaywrightInvocation,
  runChild,
  spawnFailureLine,
} from "./e2e-run-playwright.mjs";
/* schema 预检那三张卡（判词 / 取证 / 空库建齐）在 `./e2e-schema-preflight.mjs` ——
 * 拆的边界与 `e2e-run-playwright.mjs` 同一条：那一层是**判据与机制**，本文件是
 * **编排与打印**（§12.6 R5：本文件涨过了 900 行硬闸，出口只有拆）。 */
import { checkSchemaBeforeRun, ensureSchemaBeforeRun } from "./e2e-schema-preflight.mjs";
import { parseLedgerFlag, writeLedgerNote } from "./daily-run.mjs";
import { pnpmCli } from "./ci-install-deps.mjs";
import {
  E2E_PREFLIGHT_ENV_KEY,
  encodePreflight,
  runPreflight,
} from "../e2e/support/preflight-ports.mjs";
import { resolveFakeComfyuiPort } from "../e2e/support/fake-comfyui-endpoint.mjs";
import { reclaimOwnAppPort, reclaimOwnFakePort } from "../e2e/support/reclaim-ports.mjs";
import { checkBrowserReady, describeBrowserMissing } from "../e2e/support/preflight-browser.mjs";
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
  pushFreshnessLedger,
  writeFreshness,
} from "./freshness-ledger.mjs";

const ROOT = resolveRepoRoot();

/** 本档的登记（账文件 / 键 / 名字 / 「怎么跑」那条命令）。 */
export const TRACK = freshnessTrack("e2e");

/** e2e 目录 —— 与 `playwright.config.ts` 的 `testDir` 同一处落点。 */
export const E2E_DIR = "e2e";

/**
 * 开跑前 schema 预检的判决（`checkSchemaBeforeRun()` 的返回形状）。
 *
 * @typedef {{verdict: "proceed" | "ensure" | "abort", reason: string, risky?: string[]}}
 *   SchemaVerdict
 */

/**
 * 起 Playwright 之前的**三条短路判据**，各交一句「要么说话、要么拦下」（ISSUE #1998）。
 *
 * 收在一处的理由与 `runPreflightReadings` 同源：这三条此前是 `main` 里三段就地 `await`
 * + 短路 `return`，于是「它们说了什么」只有在那一跑真跑到那里时才看得见 —— 而平台侧
 * 那一跑 36 分钟零行，连它们说没说话都读不出来。现在由 `main` 一次编排（见
 * `runPreflightReadings`），每一步的结论形状统一成 `{say?, abort?}`。
 *
 * ⚠️ **判据一个字没搬**：Python / schema / 浏览器三份判决仍由
 * `checkPythonReady` / `checkSchemaBeforeRun` / `checkBrowserReady` 各自给出，
 * 这里只把它们翻成「一句读数 / 一句阻断话术」。阻断时的话术与退出码（`2`）与
 * 改动前逐字相同。
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   cwd: string,
 *   schema?: typeof checkSchemaBeforeRun,
 *   python?: typeof checkPythonReady,
 *   browser?: typeof checkBrowserReady,
 * }} input
 * @returns {{
 *   schemaVerdict: SchemaVerdict | null,
 *   python: () => Promise<{say?: string, abort?: string}>,
 *   schema: () => Promise<{say?: string, abort?: string}>,
 *   browser: () => Promise<{say?: string, abort?: string}>,
 * }}
 */
export function makePreflightCollectors({
  env = /** @type {NodeJS.ProcessEnv} */ ({}),
  cwd,
  schema = checkSchemaBeforeRun,
  python = checkPythonReady,
  browser = checkBrowserReady,
}) {
  /* schema 那一跳的判决**算一次、交出去两次**：一次是「说一句 / 拦下」，
   * 一次给 `main` 决定「空库那一档要不要留下来建齐」。此前 `main` 判完这一条
   * 之后又调了一次 `checkSchemaBeforeRun()` 来问同一个问题 —— 而那一调在
   * 「指纹对不上」的机器上会**再起一轮 drizzle dry-run**（十几秒），只为读一个
   * 与刚才那次逐字相同的结论。`schema` 挂的是本趟算出的那份，不是函数。
   * ⚠️ 它只在 `runPreflightReadings` 真的走到 `schema` 这一步之后才有值：调用方
   * 必须等那一步跑过再读（`main` 就是在它返回之后读的）。 */
  const collectors = {
    schemaVerdict: /** @type {SchemaVerdict | null} */ (null),
    async python() {
      const verdict = python({ env });
      env[PYTHON_PREFLIGHT_ENV_KEY] = encodePythonPreflight(verdict);
      if (verdict.verdict === "missing") {
        return { abort: `${describePythonMissing(verdict)}\n` };
      }
      return { say: `[e2e-run] Python 预检：${verdict.detail}\n` };
    },
    async schema() {
      const verdict = schema(cwd);
      collectors.schemaVerdict = verdict;
      if (verdict.verdict === "abort") {
        const risky = (verdict.risky ?? [])
          .map((statement) => `[e2e-run]   ${statement}\n`)
          .join("");
        /* 「要人决定丢不丢得起」只在**真拿到清单**时成立；没拿到清单那一档说的是
         * 「这台机器读不出结论」，把前一句套上去等于替人编一个还没被证实的诊断。
         * 出口那一句两条共用：`pnpm db:push` 对两种情形都是把库推齐的动作。 */
        const hasRisky = (verdict.risky?.length ?? 0) > 0;
        return {
          abort:
            `[e2e-run] ✗ ${verdict.reason}\n${
              risky
            }[e2e-run] 跑下去的下场：task 表缺列 → queue-status 500 → ` +
            `queue-monitor / main-journey 一批红，报错说的是「元素没出现」。\n${
              hasRisky
                ? "[e2e-run] 这是要人做「丢不丢得起」决定的变更。"
                : "[e2e-run] 库与 schema 的关系现在读不出来，这一档不肯替你猜。"
            }先执行：pnpm db:push   然后重跑本档。\n`,
        };
      }
      return { say: `[e2e-run] schema 预检：${verdict.reason}\n` };
    },
    async browser() {
      const verdict = await browser();
      if (verdict.verdict === "missing") {
        return { abort: `${describeBrowserMissing(verdict)}\n` };
      }
      return {
        say: `[e2e-run] 浏览器预检：${
          verdict.verdict === "ready"
            ? "这一档要用的浏览器能起来"
            : `拿不到结论（${verdict.detail ?? "原因未知"}）—— 不阻断`
        }\n`,
      };
    },
  };
  return collectors;
}

/**
 * 开跑前那几条读数，**一次交出去**（ISSUE #1998）。
 *
 * ## 它修的是「为什么顺序本身是判据」
 *
 * 本文件此前是「算一条、打一条」：`起 Playwright 前：应用端口 …` / `Python 预检：…` /
 * `webServer：…` 分散在十来处，中间隔着几条短路 `return 2`。那些读数本身没问题 ——
 * 问题是它们**一旦排在短路之后就不再说**，而 `E2E 关键流程` 在平台侧 36 分钟被 kill
 * 时日志零行（`cnb-m0t-1k54oljem`），事后能复原「这一跑在干什么」的一条都没有。
 *
 * 所以两件事同批做（缺一条另一半就白做）：
 *
 *   ① **起 Playwright 那一跳不带缓冲**（`e2e-run-playwright.mjs` 的 `spawn` +
 *      `inherit` —— 那一整段在此之前攒进 `spawnSync` 的 `res.stdout`、从不被读）；
 *   ② **开跑前的读数按序全部说出来再动手** —— 编排成一步，顺序因此不会在后续改动里
 *      变回「一条在短路之前、一条在短路之后」。短路的判据照旧短路（该拦还是要拦），
 *      只是**拦之前先把已算出来的说出口**。
 *
 * ## 为什么是纯函数（收 `collect` 而不是就地 `await`）
 *
 * 「顺序」与「第一条阻断结论生效」这两件事都是判据（`tests/e2e-run.test.ts`），而真去
 * 起一遍浏览器 / drizzle 才判得动的形状不适合每条用例都跑。所以这里只编排、不执行：
 * `collect` 交回每一步的结论，本函数负责**按序说话**并把第一条 `abort` 交出去。
 *
 * @param {{collect: (step: "ports" | "python" | "schema" | "browser") =>
 *            Promise<{say?: string, abort?: string} | null>}} deps
 * @returns {Promise<{abort: string | null}>}
 */
export async function runPreflightReadings({ collect }) {
  /* 顺序有理由，且与 `main` 里短路的顺序**必须一致**（否则「说出来的」与「拦下来的」
   * 不是同一件事）：端口（毫秒）→ Python（毫秒）→ schema（秒级，空库那档要付一轮
   * drizzle）→ 浏览器（毫秒，但缺件才是要早报的那一格）。 */
  for (const step of /** @type {const} */ (["ports", "python", "schema", "browser"])) {
    const result = await collect(step);
    if (!result) {
      continue;
    }
    if (result.say) {
      process.stdout.write(result.say);
    }
    if (result.abort) {
      return { abort: result.abort };
    }
  }
  return { abort: null };
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
  if (at === -1) {
    return argv;
  }
  return [...argv.slice(0, at), ...argv.slice(at + 1)];
}

/**
 * 本趟跑的是哪一档 webServer（`playwright.config.ts` 的 `resolveWebServerCommand()`
 * 判的是**同一件事**，读的是同一个键）。
 *
 * **为什么这一档必须由本文件说出来**：两档的负载形态完全不同（现场编译 vs 生产构建），
 * 而它们的差别在输出里一个字都看不见 —— 下一个人看到「8.7 分钟 / 43 failed」时无法
 * 判断那是哪一种，只能重新量一遍。
 *
 * ## `COMFY_E2E_SERVER`：把「有没有产物」从「是不是 CI」里分出来（2026-10-19）
 *
 * 旧形态只看 `CI || PNPM_START`，而那句话把两件独立的事绑成了一件。PR 那条流水线上的
 * `生产构建` 被撤掉之后当场露出来（`cnb-ob4-1k5828a36`）：那条 lane 仍然带 `CI`，配置
 * 仍然去起 `pnpm start`，而 `.next` 里已经没有产物 ——
 * `[WebServer] Could not find a production build` ⇒ `Timed out waiting 180000ms`。
 * 现在显式的 `COMFY_E2E_SERVER`（`dev` / `start`）**排在 `CI` 之前**，没设时沿用旧规则；
 * 认不出的值抛而不是回落（静默换档的表现是「e2e 集体超时」，读起来像用例问题）。
 * 同一条判断在配置文件里另有一份，两份**刻意不互相 import**，一致由
 * `tests/e2e-runtime-budget.test.ts` 钉。
 *
 * ## `workers` 现在**两档都有值**（ISSUE #1998）
 *
 * 它此前在 `CI` / `PNPM_START` 那一档回 `null`（= 「Playwright 默认」），而那正是
 * `E2E 关键流程` 跑到 36 分钟的那一格：`CI` 档的默认是 `cpus - 1`（16 核上 15 个
 * worker + 两条 webServer），叠起来把 30 分钟预算吃光。所以这一档现在同样收敛到
 * {@link COLD_COMPILE_WORKERS}，`null` 只剩「拿不到核数、连上界都用不上」这一种理论情形。
 *
 * ⚠️ 与 `playwright.config.ts` 的 `resolveE2eWorkers()` **判的是同一件事**，但两处
 * **刻意不互相 import**：那份配置是 Playwright 的入口文件，由 Playwright 自己加载
 * （会连带拉起整个配置图的求值），拿它当纯函数库引进来等于让跑法脚本依赖一个它本来
 * 不认识的模块。两处的一致性由 `tests/e2e-runtime-budget.test.ts` 钉住。
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {{start: boolean, workers: number | null}}
 *   `workers === null` = 用 Playwright 的默认并行度（只在算不出上界时出现）
 */
export function resolveServerMode(env) {
  /* 显式旋钮**优先于** `CI`：这一档现在由 stage 自己声明（`每日全量E2E` 写 `start`，
   * 因为它排在 `每日生产构建` 之后、同一分支共享工作区 ⇒ 那里真的有产物）。
   * 空串**不算**一个显式值：它落回旧规则（`??` 只挡 null/undefined，而空串要走的正是
   * 「没有显式声明」那一支 —— 两份实现在这一格必须逐字同语义，见那条对账判据）。 */
  const explicit = String(env.COMFY_E2E_SERVER ?? "")
    .trim()
    .toLowerCase();
  if (explicit === "dev") {
    return { start: false, workers: COLD_COMPILE_WORKERS };
  }
  if (explicit === "start") {
    return { start: true, workers: COLD_COMPILE_WORKERS };
  }
  if (explicit !== "") {
    throw new Error(
      `COMFY_E2E_SERVER 的值认不出来："${env.COMFY_E2E_SERVER}"（只认 dev / start）—— ` +
        "这一档决定 webServer 起的是「现场编译」还是「生产构建」，两种负载形态完全不同，" +
        "拼错时静默回落会让红读起来像用例问题。",
    );
  }
  /* **两档同一个并发**（上界见 `COLD_COMPILE_WORKERS`）：现场编译档的理由是首帧
   * 编译不抢核，生产构建档的理由是这台机上同时开着的浏览器与服务太多 —— 两条都不是
   * 「核多就铺开」那种自由度，所以档位只影响 webServer 命令，不影响 worker 数。 */
  if (env.CI || env.PNPM_START) {
    return { start: true, workers: COLD_COMPILE_WORKERS };
  }
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
 * 从 argv 里读出「这次是不是记一条不跑的账」——「给定开关 → 读理由 → 判合不合用」那三步
 * 收在 `scripts/daily-run.mjs` 的 `parseLedgerFlag`（四档共用一份，§12.12）。
 *
 * 这一层只是把那份共用解析的返回值**按本档的形状再包一层**：`skipped` 让调用点一句
 * `if (exit.skipped)` 就走掉，而「缺理由 / 占位理由 / 开关后面什么都没给」这三条边界
 * 自 ISSUE #1282 起由 `tests/e2e-run.test.ts` 直接断言 —— 它们是「豁免不是绕过」这句话
 * 的机器形态，形状变了不会有任何东西红，所以留着用例。
 *
 * 现在它管**两条**出路：`--skip`（今天故意不跑）与 `--dirty`（这次改动不吃这一档）。
 * 两条共用一份解析（`parseLedgerFlag`，四档同一份）与同一套理由下限，差别只在落账时
 * 写哪一栏（`skippedReason` / `dirtyReason`）—— 那一栏的分工在 `daily-run.mjs` 里，
 * 本函数不复制它。`mode` 原样带出去就是为了那个分工能由调用点照搬，不再判一次旗标。
 *
 * 参数收 `unknown[]` 而不是 `string[]`：「开关后面什么都没给」时那一格读出来就是
 * `undefined`，正是本判据要覆盖的形状。声明成 `string[]` 会把这条边界挪到调用方去绕。
 *
 * @param {unknown[]} argv
 * @param {"--skip" | "--dirty"} [flag]
 * @returns {{skipped: true, mode: "skip" | "dirty", reason: string | null} | {skipped: false, mode: "run", reason: null}}
 */
export function parseSkip(argv, flag = "--skip") {
  const { mode, reason } = parseLedgerFlag(argv, flag);
  return mode === "run"
    ? { skipped: false, mode: "run", reason: null }
    : { skipped: true, mode, reason };
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
  /* 两条「不跑」的出路互斥地先处理：给了它们就不该再去起 Playwright。
   * `--skip` 写「今天故意不跑」、`--dirty` 写「这次改动不吃这一档」—— 落哪一栏由
   * `writeLedgerNote` 分（与另两档 runner 同一个形状），本处只把 `mode` 原样传下去。 */
  for (const flag of /** @type {const} */ (["--skip", "--dirty"])) {
    const exit = parseSkip(argv, flag);
    if (!exit.skipped) {
      continue;
    }
    if (exit.reason === null) {
      const raw = argv[argv.indexOf(flag) + 1];
      process.stderr.write(
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- raw 由 argv 下标取，运行时可能 undefined，类型按 string 标窄
        `[e2e-run] ✗ 理由（"${String(raw ?? "").trim()}"）不算「有人回答过」—— ` +
          "写清这次为什么不跑 / 为什么不吃这一档（占位词与过短的理由都被拦）。\n" +
          `        用法：node scripts/e2e-run.mjs ${flag} "本次只改文档，不动功能链路"\n`,
      );
      return 2;
    }
    if (dryRun) {
      process.stdout.write(`[e2e-run] 本次不跑、只记一条（${exit.mode}）：${exit.reason}\n`);
      return 0;
    }
    return writeLedgerNote({
      root: ROOT,
      kind: "e2e",
      mode: exit.mode,
      reason: exit.reason,
    });
  }
  const extra = argv.filter((a) => a !== "--dry-run");
  const run = planRun(extra);
  if (dryRun) {
    process.stdout.write(`[e2e-run] ${run.label} → playwright ${run.args.join(" ")}\n`);
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
  if (!env.CI) {
    delete env.CI;
  }

  /* **就在这一刻**端口上有没有别人 —— 这是**唯一**能回答这个问题的时机
   * （ISSUE #1766）：再往后 Playwright 会先把 webServer 起起来并等它可访问，
   * 那时「有人应答」里就掺进了本轮自己起的服务，分不开了。结论随 env 带进
   * `globalSetup`，让它在说话时能把「起之前就在」与「本轮自己起的」分开。
   *
   * 探测**不阻断**任何事：冲突与否要看「谁在应答」（形状判据在 `globalSetup`），
   * 这里只回答「有没有人在」。 */
  const appPort = resolveAppPort(ROOT);
  const fakePort = resolveFakeComfyuiPort(env);
  let preflight = await runPreflight({ appPort, fakePort });
  process.stdout.write(
    `[e2e-run] 起 Playwright 前：应用端口 ${preflight.appOccupied ? "有人" : "空"} / ` +
      `替身端口 ${preflight.fakeOccupied ? "有人" : "空"}\n`,
  );

  /* 替身端口上坐着**我们上一跑漏下的替身**时，把它收掉（平台的 `E2E 关键流程`
   * 第二次真跑到最后一步就是这么红的，见 `e2e/support/reclaim-ports.mjs` 的文件头）。
   *
   * 为什么只能在**这里**做：Playwright 探测到「这个 URL 已有人应答」而 CI 档
   * `reuseExistingServer` 又是 false 时**直接抛**，连会说清「谁在那儿」的 `globalSetup`
   * 都到不了 —— 收它必须在 `spawn` Playwright 之前。
   *
   * 为什么只认「我们自己的」（两条证据、缺一不可）而**不动别人的进程**：别的东西
   * 占着这个口是**另一件事**，处置是让人看一眼（`describeSlotConflict` 的两条出口），
   * 不是替他把进程杀了（§1.4 多检出并行保护）。
   *
   * ⚠️ **只在 CI 档生效**：本地 `reuseExistingServer` 为真，Playwright 会复用那个替身，
   * 而那是本地刻意留的方便（`globalSetup` 会如实说「已在运行（复用）」），不该被这一步
   * 悄悄改成「杀掉重启」。 */
  if (env.CI && preflight.fakeOccupied) {
    const reclaimed = await reclaimOwnFakePort(fakePort);
    if (reclaimed.reclaimed.length > 0) {
      process.stdout.write(
        `[e2e-run] 替身端口 ${fakePort} 上坐着本检出上一跑漏下的替身` +
          `（PID ${reclaimed.reclaimed.join(", ")}），已回收整棵树\n`,
      );
      /* 收完**重算一遍**：带进 `globalSetup` 的那份结论必须是「起 Playwright 之前」的
       * 事实，而收掉之后的事实已经变了（不再是「有人」）。 */
      preflight = await runPreflight({ appPort, fakePort });
    }
    if (reclaimed.reclaimed.length === 0 && !reclaimed.free) {
      process.stdout.write(
        `[e2e-run] 替身端口 ${fakePort} 上坐着**别的东西**（PID ${reclaimed.foreign.join(", ")}）` +
          "—— 按多检出 / 别人的进程处理，不回收（出口见下面的话术）\n",
      );
    }
  }

  /* **应用端口**上坐着我们上一跑漏下的应用服务时，同一条处置（ISSUE #1977 第十三处）：
   * 替身那一格修好之后，红就落到这一格 —— 同一个成因（webServer 是 `shell: true`
   * 下面的孙子进程，上一跑被 stage 墙钟 kill 时收不到 teardown），只是对象从
   * 「第二个 webServer」换成了「第一个」。判据与边界见
   * `e2e/support/reclaim-ports.mjs` 里 `reclaimOwnAppPort()` 的头注（两条证据：
   * 命令行是本检出应用服务 + `/api/health` 是本应用形状）。 */
  if (env.CI && preflight.appOccupied) {
    const reclaimed = await reclaimOwnAppPort(appPort, ROOT);
    if (reclaimed.reclaimed.length > 0) {
      process.stdout.write(
        `[e2e-run] 应用端口 ${appPort} 上坐着本检出上一跑漏下的应用服务` +
          `（PID ${reclaimed.reclaimed.join(", ")}），已回收整棵树\n`,
      );
      preflight = await runPreflight({ appPort, fakePort });
    }
    if (reclaimed.reclaimed.length === 0 && !reclaimed.free) {
      process.stdout.write(
        `[e2e-run] 应用端口 ${appPort} 上坐着**别的东西**（PID ${reclaimed.foreign.join(", ")}）` +
          "—— 按多检出 / 别人的进程处理，不回收（Playwright 会用它自己那句话报出来）\n",
      );
    }
  }
  env[E2E_PREFLIGHT_ENV_KEY] = encodePreflight(preflight);
  /* webServer 起 `pnpm dev|start`，而平台节点（服务账号会话）的 PATH 里没有 pnpm
   * （ISSUE #2281）。把**这一步解析出来的**可执行文件交给配置 —— 配置那边只读这一个
   * 变量、不自己扫盘（扫盘只有 `ensurePnpmOnPath()` 一份实现）。 */
  const pnpm = pnpmCli();
  env.COMFY_E2E_PNPM = pnpm.command;

  process.stdout.write(`[e2e-run] ${run.label} → playwright ${run.args.join(" ")}\n`);
  const mode = resolveServerMode(env);
  process.stdout.write(
    `[e2e-run] webServer：${mode.start ? "pnpm start（生产构建，首屏零编译）" : "pnpm dev（Turbopack，首帧现场编译）"}` +
      ` / 并发：${mode.workers ?? "Playwright 默认"}\n`,
  );

  /* **开跑前的三条短路判据**（Python / schema / 浏览器），一次编排、按序说话
   * （ISSUE #1998）：它们的判决一个字没变，变的是「结论先说出来再动手」——
   * 平台侧那一跑 36 分钟零行时，连它们说没说话都读不出来。 */
  const collectors = makePreflightCollectors({ env, cwd: ROOT });
  const { abort } = await runPreflightReadings({
    /* `ports` 那一步的读数在上面（它要**在**回收替身 / 应用端口之前算，见前一段），
     * 这里不重复算 —— 少一条不必要的探针，少一次端口上「谁在」的时刻。 */
    collect: async (step) => (step === "ports" ? null : collectors[step]()),
  });
  if (abort !== null) {
    process.stderr.write(abort);
    return 2;
  }
  /* 空库那一档**在这里等它建齐**（ISSUE #1948）：启动链路的同步是后台的
   * （`spawnSchemaSync` detached、不等待），而 Playwright 等的是 webServer 的
   * URL 可访问 —— Next 一 up 就满足，于是冒烟档的健康检查会在建表还没跑完时打
   * 过去，全新检出的现场是 `db: "empty"` ⇒ 503 ⇒ 那条 `@critical` 必红。
   *
   * **判决只算一次**：`ensure` 那一档才要建齐，而「是不是这一档」由上面那条
   * schema 判据给出（`makePreflightCollectors` 已经把阻断那一档拦在门外）。
   * 读数取的是**那一步算出来的那份**（`collectors.schemaVerdict`），不重算 ——
   * 指纹对不上的机器上重算一次 = 再起一轮 drizzle dry-run（十几秒），只为读一个
   * 与刚才逐字相同的结论。 */
  if (collectors.schemaVerdict?.verdict === "ensure") {
    const ensured = ensureSchemaBeforeRun({
      root: ROOT,
      forward: (chunk) => process.stdout.write(`[e2e-run]   ${chunk}`),
    });
    if (ensured.verdict === "abort") {
      process.stderr.write(`[e2e-run] ✗ ${ensured.reason}\n`);
      return 2;
    }
  }
  /* 起法走 `resolvePlaywrightInvocation()`（唯一出处）：**不缓存子进程输出**。
   * `spawnSync` + `stdio: "inherit"` 会把 Playwright 那一整段攒进 `res.stdout`，
   * 而这个文件从不读它 —— 被 stage 墙钟 kill 时那一段随进程一起消失，日志零行
   * （ISSUE #1998，`cnb-m0t-1k54oljem` 的 36 分钟）。`spawn` + `inherit` 才是真落
   * 日志（与 `ci-cp936-exit.mjs` 第十二处同一个口径，只是缓存落在调用方这一层）。 */
  const invocation = resolvePlaywrightInvocation({
    entry,
    argv: run.args,
    env,
  });
  const res = await runChild(invocation);
  /* `status === null` 涵盖「被信号打死」与「起不来」两种收场（`runChild` 三条出口
   * 各打一句话）—— 两者都不是判据红，别让下一个人去查用例。 */
  if (res.status === null) {
    process.stderr.write(
      "[e2e-run] ✗ Playwright 没能跑完（被信号终止 / 起不来）—— **不记账**：\n" +
        "        这一跑没有结论，不是「用例红了」。先看上一行那句失败码。\n",
    );
    return 1;
  }
  const exitCode = res.status;
  if (exitCode === 0 && !shouldRecord({ exitCode, dryRun, extra })) {
    /* **绿了但不记账**：这一跑透传了参数（`--grep`、指到单个文件、甚至 `--help`），
     * 跑的只是整档的一个子集或压根没跑用例。它退 0 是「那件较小的事成了」，
     * 不是「全量 e2e 绿了」—— 混记会把账变成一句承诺，而这张账的价值全在它是事实。 */
    const why = isWholeTrackRun(extra).why;
    process.stderr.write(
      `[e2e-run] ${notWholeTrackNotice({
        label: "全量 e2e",
        command: "pnpm test:e2e",
        why,
      })}`,
    );
    return 0;
  }
  if (!shouldRecord({ exitCode, dryRun, extra })) {
    process.stderr.write(
      `[e2e-run] ✗ 全量 e2e 未通过（退出码 ${exitCode}）—— **不记账**：\n` +
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
  /* 回写机器自有分支 `ci/freshness-ledger`（ISSUE #2247）；仅每日档置
   * `FRESHNESS_LEDGER_PUSH=1` 时真正推，否则 no-op。 */
  const freshPush = pushFreshnessLedger({ root: ROOT, kinds: ["e2e"] });
  if (freshPush.pushed) {
    process.stdout.write("[e2e-run] ✓ 新鲜度账已回写机器分支 ci/freshness-ledger\n");
  } else if (freshPush.reason && freshPush.reason !== "opt-out") {
    process.stdout.write(`[e2e-run] （新鲜度账回写未执行：${freshPush.reason}）\n`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exit(await main(process.argv.slice(2)));
}
