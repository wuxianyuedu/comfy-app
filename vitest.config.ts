import { defineConfig } from "vitest/config";
import path from "node:path";

import { isCiEnvironment, resolveCiWorkers } from "./scripts/ci/ci-load.mjs";

import { COVERAGE_EXCLUDE, COVERAGE_INCLUDE } from "./scripts/gates/coverage/include.mjs";
import { COVERAGE_THRESHOLDS as COVERAGE_THRESHOLDS_GLOBS } from "./scripts/gates/coverage/thresholds-globs.mjs";
import { COVERAGE_THRESHOLDS as COVERAGE_THRESHOLDS_FILES } from "./scripts/gates/coverage/thresholds-files.mjs";
import { COVERAGE_THRESHOLDS as COVERAGE_THRESHOLDS_UI } from "./scripts/gates/coverage/thresholds-ui.mjs";

/**
 * `DOM_TEST_GLOBS` —— 进 **DOM 档**（`happy-dom`）的用例面（§11.17）。
 *
 * 只有两种形状**整目录一致**时才按目录声明：① 该目录下全部用例都要 DOM（下面那批，
 * 实测 26 个目录，逐个核过）；② \`.test.tsx\`。混合目录（同目录下两种都有）**不在这里**
 * —— 它们保持 node 档，其中要 DOM 的继续靠文件头（是它们归属的唯一声明）。
 *
 * ## 为什么 DOM 档默认是 happy-dom 而不是 jsdom
 *
 * 两个都是 DOM 实现，差别在**代价**与**保真度**，账是分开记的：
 *   · happy-dom 启动一个 window 明显更便宜（environment 时间占比是本仓库实测
 *     最大的一项），大多数「渲染一个组件、断言点了会回调」的用例并不需要 jsdom
 *     那些边角行为；
 *   · jsdom 保真度更高：它的 CSSOM 认 `color-mix()`、它的 DOM 节点能在
 *     `Node.prototype` 上给出 `nodeName`、它的 `Element.prototype.clientWidth`
 *     是访问器（可 `spyOn`）、它**不做同源检查**。少数用例真的落在这些差异上 ——
 *     那些文件用**文件头** `// @vitest-environment jsdom` 逐份声明，是本档的例外。
 *
 * ⚠️ **例外不是「随手加一行」**：写 jsdom 头的必须有**能被指出的具体理由**
 * （哪一条 API / 哪一个行为在 happy-dom 下不同），因为这一档的默认值选 happy-dom
 * 的全部意义就是「只有真的需要 jsdom 时才付它的钱」。判据：
 * `node scripts/gates/check-test-environment.cjs --report` 会列出每份 jsdom 头的文件。
 *
 * ⚠️ **路径里的 `(main)` 这类路由组括号必须转义成 `\\(main\\)`** —— 括号是 glob 的
 * 分组语法，写成字面量时 `src/app/(main)/…` 会被翻成「匹配 `src/app/main/…`」，
 * 条目**静默不匹配**（下面覆盖率那批的注释里早就写了这条，本清单曾漏掉两条：
 * `settings/components` 与 `settings/hooks` 实际一个都没进来）。同 §11.7
 * 「门槛写着 100、报告里查无此文件」那一族：清单条目失效不报错，只是不见了。
 *
 * ⚠️ 新增一批 DOM 用例时：若整个目录都是，就把目录加到这里；只加几份就别动它，
 * 直接写文件头（`scripts/gates/check-test-environment.cjs` 会核「目录档与文件头矛盾」）。
 * **不要为了省几行文件头去 `exclude` 少数派** —— 见上面 `projects` 的注释。
 */
const DOM_TEST_GLOBS = [
  String.raw`src/app/\(main\)/settings/components/**/*.test.{ts,tsx}`,
  String.raw`src/app/\(main\)/settings/hooks/**/*.test.{ts,tsx}`,
  "src/components/agent-run/**/*.test.{ts,tsx}",
  "src/components/agent-run/hooks/**/*.test.{ts,tsx}",
  "src/components/code-update/**/*.test.{ts,tsx}",
  "src/components/code-update/hooks/**/*.test.{ts,tsx}",
  "src/components/model/hooks/**/*.test.{ts,tsx}",
  "src/components/studio/library/**/*.test.{ts,tsx}",
  "src/components/studio/library/hooks/**/*.test.{ts,tsx}",
  "src/components/studio/project-canvas/**/*.test.{ts,tsx}",
  "src/components/studio/project-canvas/CanvasNode/**/*.test.{ts,tsx}",
  "src/components/studio/project-canvas/CanvasNode/hooks/**/*.test.{ts,tsx}",
  "src/components/studio/project-canvas/hooks/**/*.test.{ts,tsx}",
  "src/components/studio/project-home/**/*.test.{ts,tsx}",
  "src/components/studio/comfyui/**/*.test.{ts,tsx}",
  "src/components/studio/logs/**/*.test.{ts,tsx}",
  "src/components/studio/queue/hooks/**/*.test.{ts,tsx}",
  "src/components/studio/workflow-editor/hooks/**/*.test.{ts,tsx}",
  "src/components/studio/workflow-form/DynamicWorkflowForm/**/*.test.{ts,tsx}",
  "src/components/studio/workflow-form/DynamicWorkflowForm/hooks/**/*.test.{ts,tsx}",
  "src/components/studio/workflow-form/DynamicWorkflowForm/sections/**/*.test.{ts,tsx}",
  "src/components/studio/workflow-library/CustomNodesSettings/hooks/**/*.test.{ts,tsx}",
  "src/components/studio/workflow-library/hooks/**/*.test.{ts,tsx}",
  "src/components/studio/workflow-library/sections/**/*.test.{ts,tsx}",
  "src/components/workshop/hooks/**/*.test.{ts,tsx}",
  "src/config/**/*.test.{ts,tsx}",
  "src/lib/markdown/**/*.test.{ts,tsx}",
  "tests/integration/**/*.test.{ts,tsx}",

  /* `.test.tsx` ⇒ jsdom 是实测出来的完全相关（116/116）。
   * 扩展名是这套分档里**唯一**一条能整体成立的推导：422 份 `.test.ts` 里另有 68 份要 jsdom，
   * 那部分靠自己的文件头，别试图从扩展名推。 */
  "src/**/*.test.tsx",
  "tests/**/*.test.tsx",
];

/**
 * 判据预算（`testTimeout` / `hookTimeout`）的**临时乘数**（ISSUE #2959）。
 *
 * 业主口径（ISSUE #2948 / #2959）：「把 CI 里测试的超时时长临时改长，避免负载红」。
 * 它和 §11.13 / §13.6.4 那两条「不许抬预算」直接对撞，所以这一格不是「调参」，是
 * **有形状的临时放宽**，形状由四条定死：
 *
 *   1. **默认 1 = 与放宽前逐字等价**：不设变量时算出来的数就是 `30_000` / `45_000`，
 *      配置解析结果一个字都不变（`tests/test-config-inheritance.test.ts` 那条钉的就是它）。
 *   2. **只抬判据那一层**：`.cnb.yml` 的 stage 预算（`45m` 那几格）、`full-suite-run.mjs`
 *      的墙钟、Playwright 的 `timeout: 60_000`（红线用例钉着）**一律不动** —— 它们是
 *      「卡死多久有人知道」的护栏，抬它们只是把唯一的早期信号拆掉。
 *   3. **上限 3 倍、超了落回 1 并说出口**：再高就等于把「真挂死」的检出时间一起放大到
 *      §11.13 说的那个数上。
 *   4. **恢复 = 把 `.cnb.yml` 里那一行变量删掉**（不是「再抬一次」）：默认值 1 让「收回」
 *      成为一个不需要改代码的动作。
 *
 * 这一格的**执行者是 `.cnb.yml` 的流水线级 env**（`COMFY_TEST_TIMEOUT_SCALE: "2"`），
 * 本地不设 ⇒ 本地行为与今天完全一样 —— 抬的只有共享节点上那一台机器。
 */
const TIMEOUT_SCALE_MAX = 3;

/** 判据预算的基数（抬之前的值；`tests/test-config-inheritance.test.ts` 用它们当默认档）。 */
export const BASE_TEST_TIMEOUT_MS = 30_000;
export const BASE_HOOK_TIMEOUT_MS = 45_000;

/**
 * 读 `COMFY_TEST_TIMEOUT_SCALE` 并算出这一跑生效的两条预算。
 *
 * 非法值（非正数 / 超上限）**落回 1 并给一句 note**，不静默算成一个怪数 ——
 * 与 `ci-load.mjs` 读 `COMFY_CI_MAX_WORKERS` 同一条口径：坏值要读得出来，
 * 否则下一次「这台机器为什么这么慢」会查到配置上去。
 *
 * @param {string | undefined} raw 环境变量原值
 * @returns {{scale: number, testTimeout: number, hookTimeout: number, note: string | null}}
 */
export function resolveTimeoutBudget(raw: string | undefined) {
  const text = String(raw ?? "").trim();
  const base = {
    scale: 1,
    testTimeout: BASE_TEST_TIMEOUT_MS,
    hookTimeout: BASE_HOOK_TIMEOUT_MS,
    /* SAFETY: 类型断言已复核 */
    note: null as string | null,
  };
  if (text === "") {
    return base;
  }
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0 || value > TIMEOUT_SCALE_MAX) {
    return {
      ...base,
      note:
        `COMFY_TEST_TIMEOUT_SCALE="${raw}" 不在 (0, ${TIMEOUT_SCALE_MAX}] 内 ⇒ 按 1 倍办` +
        `（testTimeout 仍是 ${BASE_TEST_TIMEOUT_MS}ms，不是被算成了一个怪数）`,
    };
  }
  return {
    scale: value,
    testTimeout: Math.round(BASE_TEST_TIMEOUT_MS * value),
    hookTimeout: Math.round(BASE_HOOK_TIMEOUT_MS * value),
    note: null,
  };
}

const TIMEOUT_BUDGET = resolveTimeoutBudget(process.env.COMFY_TEST_TIMEOUT_SCALE);

/* 只在**真放宽了**的时候打一行读数：默认档一个字都不多（本地跑测试的屏幕不该多出噪音）。
 * 而放开了就必须读得出来 —— 否则「这一跑的预算为什么是 60s」与「有人偷偷改过配置」
 * 在日志里长得一模一样（同 `.cnb.yml` 那几行停用登记的理由）。 */
if (TIMEOUT_BUDGET.scale !== 1) {
  process.stdout.write(
    `[vitest] 判据预算临时放宽 ×${TIMEOUT_BUDGET.scale}：testTimeout ${BASE_TEST_TIMEOUT_MS} → ` +
      `${TIMEOUT_BUDGET.testTimeout}ms、hookTimeout ${BASE_HOOK_TIMEOUT_MS} → ${TIMEOUT_BUDGET.hookTimeout}ms` +
      "（ISSUE #2959：只抬判据那一层，stage 墙钟与 e2e 的 60s 没动）\n",
  );
} else if (TIMEOUT_BUDGET.note) {
  process.stdout.write(`[vitest] ${TIMEOUT_BUDGET.note}\n`);
}

/* 并发档：唯一出处 `scripts/ci/ci-load.mjs`（§13.5.21）。本地开发机（三个 CI 变量都缺席）
 * 自 #4613 起按 `cores/2` 铺开（16 核 ⇒ 8）；CNB 共享宿主机与 GA 档见该文件头。 */
const WORKER_PLAN = resolveCiWorkers();

/* 并发档同样要读得出来：覆盖了（或给了坏值）念 `resolveCiWorkers()` 的那句话；
 * 本地默认档打一整行 —— 「这一跑开几个 worker、按哪一档算的、想改找哪个旋钮」
 * 不再藏在配置注释里（ISSUE #4613 的第 2 条期望）。CI 侧不加行：那边的 stage 日志
 * 本就带 `--maxWorkers / 核数 / 来源` 读数（§13.5.21「读得到才算数」），别重复占预算。 */
if (WORKER_PLAN.note) {
  process.stdout.write(`[vitest] ${WORKER_PLAN.note}\n`);
} else if (!isCiEnvironment(process.env)) {
  process.stdout.write(
    `[vitest] 本地并发档 --maxWorkers=${WORKER_PLAN.workers}（${WORKER_PLAN.cores} 核 ÷2；` +
      "要压并发设 COMFY_CI_MAX_WORKERS=<n>，只调并发、不动任何判据）\n",
  );
}

/* 覆盖率门槛的「登记处 ⇄ 判定开关」在**文件末尾**（ISSUE #2669）：这里先把整份配置
 * 收成一份具名对象，末尾再决定「传给 vitest 的那一份带不带 thresholds」。
 * 那 149 条门槛的**字面量一行都没动**，也没有搬家 —— 挪走的只是「谁来判」。 */
const BASE_CONFIG = defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "~": path.resolve(import.meta.dirname, "src"),
      // server-only 包在 vitest node 环境会抛错（它就是干这个的）；
      // 数据访问层的硬约束在 Next 构建期仍然生效，测试里换空实现。
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    /* ── 两个 project 共用的那几项，**写在根 `test` 上**（§11.17.3）─────────────
     *
     * vitest 5 的 inline project（`projects: [{ test: {…} }]`）**默认继承本文件
     * `test` 这一层的选项** —— 这就是它们该待的地方：一处定义、两档都拿。
     *
     * ⚠️ 这条口径曾经写反过。此处原先立着一个 `SHARED_TEST_OPTIONS` 常量、两个
     * project 各 spread 一次，理由是「`projects` 不继承声明方 `test` 的选项（实测）」。
     * 本轮按仓库规矩先复现那个实测，结论是**当时那次测量站不住**：
     *   · 同一份配置把 `setupFiles` 放根 `test`、inline project 只写 `include`，
     *     实测两档都拿到 `setupFiles` / `testTimeout` / `hookTimeout` / `expect.poll`；
     *   · 负对照 `extends: false`（vitest 5 显式关掉继承的开关）下，`task.timeout`
     *     退回出厂 **5000**、`jest-dom` 匹配器消失（`Invalid Chai property`）——
     *     证明「继承」确实是机制，不是别的东西碰巧生效。
     * 当年那 2 条红是真的，但归因错了：那时的根 `test` 里确实没有那几项（后来才
     * 抽成常量），红的是「抽出去之后没 spread 回来」，不是「继承失效」。
     *
     * ⚠️ 判断「继承有没有生效」只看**配置文本**会自欺 —— 本轮改动的验收口径是
     * 两条：① `vitest list` 的 `[project] … > 用例名` 逐行零差异（7160 条）；
     * ② `tests/test-config-inheritance.test.ts` 用 **vitest 自己的 `createVitest()`**
     * 读解析后的配置，逐档核那几项真的落到位（不自己写一份 glob / 继承规则，
     * 那是 #1509 踩过的坑）。
     *
     * ⚠️ 新增一项 `test` 级配置时先问：它是「每份用例都要的」还是「只对某档有意义」？
     * 前者写这一层（两档自动拿，别复制成两份）；后者写进对应 project 内部。
     * 只对某档有意义的项写成根级 = 另一档静默吃到（§11.7 的「配置看着在」那一族），
     * 这一条由上面那份用例按**白名单**守着。 */
    /* 每条用例的 setupFiles（jest-dom 匹配器 + 限流桶复位）。 */
    setupFiles: ["tests/setup.ts"],
    /* 与仓里既有口径一致：不注入 `expect` / `describe` 等全局，用例逐个 import。 */
    globals: false,
    /* 超时预算：vitest 的默认值（用例 5s / 钩子 10s）低于本仓库的实测下限。
     *
     * 串行隔离跑（`--no-file-parallelism`）的最慢单条用例已经是 5469ms
     * （`client-bundle-node-builtins` 的全 `src/**`「use client」可达性 DFS），
     * `db-schema-ready` 4770ms —— 一条贴着默认值、一条在默认值之上，
     * 也就是**不开并行都会红**。全量并行时再乘一份争用系数：16 逻辑核上
     * 约 10 个 worker，而门禁用例各条要 `execFileSync` 真起 Node / git /
     * prettier 子进程，一轮实测 28 条报 `Test timed out in 5000ms`、
     * 2 个文件报 `Hook timed out in 10000ms`。
     * 那两份红来自 theme 用例的 `beforeAll` 现编一份 CSS（隔离 7.2s/文件），
     * 这一项已经从根上去掉了：编译输入源固定后实测 0.13s/文件
     * （理由与反向判据见 `tests/helpers/theme-tokens.ts` 和
     * `tests/theme-tokens-compile-source.test.ts`，ISSUE #1336），
     * 所以这两个预算**没有为它再抬一次**，留给「起子进程」那一类继续用。
     *
     * 20s = 最慢实测值 ×3.6；`it()` / `describe()` 上已有的显式预算
     * （10s / 30s / 60s / 120s 那几处）优先级更高，不受这里影响。
     * ⚠️ 这是**天花板不是目标**：用例慢到接近 20s 时该优化用例本身
     * （收窄扫描面、复用子进程），别再往上调这个数 —— 那等于把
     * 「挂死」的检出时间一起放大。
     *
     * 2026-09-27 复测：套件涨到 449 文件后 ×3.6 的余量被吃掉 —— 全量满载下
     * theme 的 beforeAll（隔离 7.2s）与 LogPanel 渲染双双越过 30s/20s，
     * 6 文件 / 11 例争用假红（单跑全绿）。抬到 30s / 45s，同样只买余量
     * 不改用例；下一轮涨套件时按同一条「最慢实测 × 余量」重算。
     *
     * ⚠️ 这里写的两个数**是基数，不是生效值**（ISSUE #2959）：生效值由上面
     * `resolveTimeoutBudget()` 按 `COMFY_TEST_TIMEOUT_SCALE` 算出来，缺省乘数 1 ⇒
     * 生效值与这两个数逐字相同。要动它们，动基数（上面那两个常量）而不是在这里写乘数。 */
    testTimeout: TIMEOUT_BUDGET.testTimeout,
    hookTimeout: TIMEOUT_BUDGET.hookTimeout,
    /* `expect.poll` 的默认预算。vitest 出厂是 1000ms / 50ms —— 那两个数字是给
     * 「内存里的状态翻转」定的，而本仓库一大批轮询等的是**真的进程动作**：
     * `spawn` 落地、`sleep` 挂成组长、孙进程被 `taskkill` 收走，实测单次就已
     * 越过 1s（所以这批用例的入参一直写着 4000ms）。默认值定在这里之后，
     * 调用点只在确实需要更宽 / 更窄时再写 `{ timeout }`。
     *
     * ⚠️ 同 `testTimeout` 那条口径：这是**给真进程留的余量，不是给慢用例兜底**。
     * 一条 `expect.poll` 走到超时说明被等的事根本没发生 —— 去查它为什么没发生，
     * 别把这个数往上抬。 */
    expect: { poll: { timeout: 4000, interval: 50 } },
    /* ★ 显式钉住 `reporters`，目的是**不让 vitest 自己往 Job Summary 里写**。
     *
     * vitest 5 的默认值是 `["default", ...(GITHUB_ACTIONS === "true" ? ["github-actions"] : [])]`
     * （`vitest/dist/chunks/defaults.*.js`）。那个 `github-actions` reporter 会：
     *   ① 把每条失败用例写成 `::error::` 注解；
     *   ② **往 `$GITHUB_STEP_SUMMARY` 追加一整段 `## Vitest Test Report`** ——
     *      `jobSummary.outputPath` 的默认值就是那个环境变量，而它在 `test.reporters`
     *      这一层**关不掉**（只有 `new GithubActionsReporter({jobSummary:{enabled:false}})`
     *      能关，但那要走自定义 reporter）。
     *
     * 后果实测（本文件 + `ci-step-verdict.mjs` 的摘要，2026-11-09 的 GA 页）：
     * 一次 job 里跑了几次 vitest，摘要里就有几段 `Vitest Test Report`，而且**数字互相
     * 矛盾**（3 passes 与 1 pass 并排）。读者没法判断哪份是这次的总账，而这几段还压在
     * 真正的判据结论**前面** —— 这正是「摘要乱糟糟」的形状。
     *
     * 口径：本仓的摘要**只有一个写入者** —— `scripts/ci/ci-step-verdict.mjs`（§「一步红了，
     * 为什么」的唯一出口）。它写的是「这一格判没判、红在哪」，比 reporter 的用例级
     * 计数更贴近读者要回答的那一问；两套并存 = 同一页两个口径。
     *
     * 代价写在明处：**失败用例的 `::error::` 注解随之消失**。这一条不是白丢 ——
     * `ci-step-verdict.mjs` 在主进程侧按退出码打一条 `::error::`/`::warning::`，注解面仍然
     * 有；而逐条用例的位置与堆栈本来就在日志里（junit / 终端输出照旧）。
     *
     * ⚠️ 命令行**显式**给 `--reporter` 会盖掉这里（`full-suite-run.mjs` 就是
     * `--reporter=default --reporter=junit`）；那种情况下 `github-actions` 本来也不会被
     * 追加，所以两边一致。改这一段时跑 `tests/vitest-gha-summary.test.ts` —— 它按
     * 「GITHUB_ACTIONS=true 跑一次、摘要里不许出现 `Vitest Test Report`」正面判。 */
    reporters: ["default"],
    /* 并发上限：**取自 `scripts/ci/ci-load.mjs` 那一处**（ISSUE #2324，以前这里是字面 8）。
     * 为什么不再写数字：同一句「一个 worker 至少 8 核」的判断曾在三个地方各留一份副本
     * （这里 8、`run-affected-tests.mjs` 的 4、`ci-load.mjs` 的按核折算），结果就是
     * 「单条链别占满整台机」那一档压住了平台两格，**本地这一跳照旧 8 个 worker**
     * —— 而本地跑的正是 `pnpm check:all` / `pnpm test` / `quality-gate` 的 vitest 步。
     * 数字的历史与实测推导（含 8 那一批的三档数据）**只记在规范 §11.13 那张表里**，
     * 抄到这儿就会和那份表漂移。
     * ⚠️ 这一档买到的是「红得少 + 峰值占用低」，**买不到**「红即可归因」：红仍然要先
     * `--no-file-parallelism` 隔离重跑定性（§13.6.4），别靠抬预算掩盖。
     * 本地默认档自 #4613 起按 cores/2 铺开（16 核 ⇒ 8，文件顶部那行读数会念出来）；
     * 机器被别的东西占着时压并发：`COMFY_CI_MAX_WORKERS=<n> pnpm test`（只调并发，
     * 不动任何判据）。 */
    maxWorkers: WORKER_PLAN.workers,
    /* 环境档：**默认 node，按目录把 jsdom 挂到该用的地方**（§11.17）。
     *
     * 这里曾经是一条全局 `environment: "node"` + 183 份用例各自在文件头写
     * `// @vitest-environment jsdom`。两件都是真的，但第二件从来**没人判过**：
     * 少写一行不报错，只会让用例留在 node 档下跑 —— 真碰 DOM 的当场红（响的），
     * 而写了 `if (typeof window !== "undefined") return;` 这类**环境早退**的
     * 照样报绿、**一条断言都没跑**（静默的，见 §11.13.1）。
     *
     * ⚠️ **换掉全局档 ≠ 删掉文件头**（实测，vitest 5.0.3）：文件头的
     * `@vitest-environment` **优先级高于 project 的 environment**，所以
     * `projects` 只决定「没写文件头时跑在哪」。摘掉全部 183 份头有 178 份立刻红 ——
     * 但那是「文件头有作用」，推不出「每份都有作用」：**按「它有没有替目录档兜底」
     * 逐份判，147 份是纯冗余（目录档已给出同结论）、37 份承重**（混合目录里归属的
     * 唯一声明）。147 份已删，剩 37 份继续留 —— 同一件事只留一个来源。
     * 第 148 份冗余（`tests/sidebar-selected-state.test.tsx`）是这轮收尾时手工比漏掉的，
     * 现在由 `scripts/gates/check-test-environment.cjs` 的判据③「冗余文件头」守着，
     * 以后不会再长出来（§11.17.1.2）。
     *
     * 分档判据是**实测出来的目录归属**，不是「按扩展名猜」：`.test.tsx` ⇒ jsdom
     * 是 116/116 的完全相关，但另有 68 份 `.test.ts` 也要 jsdom（store / hook /
     * 路由断言里碰 `localStorage`、`document` 的那些），扩展名推不出来。
     * 所以只在**两种「整目录一致」的形状**上声明目录档：
     *   ① 该目录下**全部**用例都 jsdom（实测 26 个目录）；
     *   ② `.test.tsx` —— 实测 116 份全部要 jsdom，读作「渲染用例」这一档。
     * 混合目录（同目录下两种都有）**保持 node 档**，其中要 jsdom 的
     * 那份继续靠自己的文件头 —— 不为了少几行注释把 260 份 node 用例误升进 jsdom
     *（jsdom 档下跑纯逻辑**不报错、只是变慢**，是「静默跑错档」里坏的那一侧）。
     *
     * ⚠️ **混合目录别试着用 `exclude` 摘少数派**（实测否决）：想让 `src/components/ui`
     * 这种目录进 jsdom 档，就得把它的少数 node 用例从 jsdom 档 `exclude` 掉 ——
     * 可 **node 档的 `exclude` 正是同一份 `DOM_TEST_GLOBS`**，于是那些用例
     * **两个 project 都不跑**。实测：给 DOM 档加 exclude 之后
     * `vitest list <那份文件>` 输出**为空**（一个档都没接住）—— 静默消失，
     * 比多写一行文件头坏得多。要修就得把 node 档的 exclude 拆成逐条清单、
     * 与 DOM 档手工对齐，那是把「一处 glob 两处用」换成「两处清单要同步」。
     * **文件头就是这一档的正确机制**：它天然只影响自己那一份，不动别人的归属。
     *
     * 这一档买到的是三件事，都不是「省注释」：
     *   ① 没写文件头的用例有确定的、按目录判定的归属（而不是一条全局默认值）；
     *   ② 归属可被门禁核对：`scripts/gates/check-test-environment.cjs`（进 pre-commit D 组）
     *      判「目录档与文件头矛盾」与「环境早退」两件 —— 前者让「挪目录 / 改档」
     *      这类改动留下痕迹，后者是这条线索真正的病根；
     *   ③ 每个 project 可以按自己的代价配并发，而不是全库一个 `maxWorkers`。
     *
     * ⚠️ **这个 `test` 块里的选项只有 `include` / `exclude` / `name` / `environment`
     * 这一档是「本档专属」的** —— 其余共用项一律写在根 `test` 上、由 inline project
     * 默认继承（口径与实测见文件顶部那段）。这里再写一遍共享项 = 同一件事两个来源，
     * 改一处漏一处没人发现（§11.17.1.2 那条「冗余」的同族）。 */
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          /* 纯逻辑用例：不碰 DOM 的 store / 判据 / 纯函数。默认档，面最大。 */
          include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
          /* ⚠️ `exclude` 只写 glob、**不写 jsdom 例外那一份**：node 档是
           * 「两条 DOM glob 都没命中的那一块」，所以 DOM 档的 include 改成什么，
           * 这里就跟着排掉什么（见下 `DOM_TEST_GLOBS`）。
           * 写反了（比如这里列 jsdom 目录清单）会让 profile 与 node 档的差集
           * 出现缝：那些用例一个档都进不去、`vitest list` 里直接消失。 */
          exclude: DOM_TEST_GLOBS,
        },
      },
      {
        /* DOM 档。**默认 happy-dom**，落在 jsdom 特有行为上的文件靠文件头
         * `// @vitest-environment jsdom` 逐份改档（口径见文件顶部那段）。 */
        test: {
          name: "happy-dom",
          environment: "happy-dom",
          include: DOM_TEST_GLOBS,
        },
      },
    ],
    coverage: {
      provider: "v8",
      /* ⚠️ `thresholds` 里 glob 条目的判定口径（官方 config/coverage.md）：
       * ① **不继承**全局门槛——条目里没写的那一维不判；
       * ② 默认判的是**匹配集合的聚合值**，要逐文件各自达标必须显式写 `perFile: true`。
       * 本文件所有条目都**没有** `perFile`，所以目录档（`src/lib/agent/**` 这类）判的是
       * 目录聚合 —— 注释里「目录实测」的说法与之一致；而一条 glob 盖多个文件时
       * （如 `src/lib/comfyui/desktop-storage-paths*.ts`）**不要**按「单个文件隔离实测」
       * 读它：那个文件掉很低不会红，动它之前先明确要的是聚合还是逐文件。 */
      /* 一条试用例红 → v8 默认**清掉覆盖率数据、不产出报告** —— 于是 `thresholds`
       * 表里的每一条都没被判定，而终端上只看得见那条红。表现不是「门槛没过」，
       * 是**门槛静默缺席**：现场实测 `pnpm test:coverage` 全量 464 文件 / 2 败，
       * `coverage/` 目录空的。`reportOnFailure` 让红与覆盖率**各自记账**：红照样
       * 非零退出，但覆盖率照常汇总并按门槛判 —— 否则「修红」会变成覆盖率唯一的
       * 阻塞条件，而它本来不该管这件事（规范 §11.7 的覆盖率棘轮）。 */
      reportOnFailure: true,
      // 三种格式各有明确用途，别按「没人看就删掉」精简：
      //   text          —— 人读（终端日志）；
      //   json-summary  —— 本地看目录汇总；
      //   lcov          —— 机器读的那份。平台侧流水线曾用 `testing:coverage` 插件
      //                    读 `coverage/lcov.info`（ISSUE #623 后该流水线已删除，
      //                    见 docs/standards/13 §13.5.3）。保留 lcov 是因为它是
      //                    「覆盖率接任何外部工具」的通用入口，且删掉会让
      //                    日后重启上报时重新踩一遍「插件找不到报告文件」那个坑
      //                    ——当时的现场是插件 1.8s 就退出，而报错完全指不出是
      //                    reporter 少配了一项。
      /* ⚠️ **本档的输出量是有预算的**（ISSUE #1959）：`text` 这个 reporter 会把
       * 报告里**每一个文件**打一行，450+ 行的表格本身就有 ~90KB —— 而平台侧
       * （CNB）对单次构建日志的硬上限是 **102400 字节**，超过就只留一句
       * `The log length exceeds the limit(102400)`、后面全部截断。现场实测：
       * `pnpm test:coverage` 只跑三个目录（`src/lib/{comfyui,log,workshop}`）
       * 就已经 **107256 字节**，全量更是数倍 —— 于是 CI 里看不到任何失败原因，
       * 只有一句「日志超长」（正是 ISSUE #1959 截图里的第一行）。
       *
       * 出路是把「人读的那份」压成汇总档：`text-summary` 只打总计（几行），
       * 而**逐文件的明细一个都没少** —— 它本来就在 `lcov` 与 `json-summary`
       * 里（那两份是给机器与本地细读的，不受日志预算约束）。
       *
       * 由 `COMFYAPP_QUIET_COVERAGE` 控制而不是直接换掉默认值：本地人手动跑
       * `pnpm test:coverage` 时**要看**那张表（那正是它的用处），把它删掉等于
       * 为了 CI 砍掉本地的能力。判据见 `tests/coverage-reporter-budget.test.ts`。 */
      reporter: process.env.COMFYAPP_QUIET_COVERAGE
        ? ["text-summary", "json-summary", "lcov"]
        : ["text", "json-summary", "lcov"],
      include: COVERAGE_INCLUDE,
      exclude: COVERAGE_EXCLUDE,
      thresholds: {
        ...COVERAGE_THRESHOLDS_GLOBS,
        ...COVERAGE_THRESHOLDS_FILES,
        ...COVERAGE_THRESHOLDS_UI,
      },
    },
  },
});

/* ── 覆盖率门槛：登记处 ⇄ 判定开关（ISSUE #2669，业主口径）────────────────────
 *
 * 口径原文（该单 2026-10-29 的评论）：**整体覆盖率只上报，不要让 CI 红**。
 * 那三条理由决定了这里的形态，所以抄在决定发生的位置上，不是注释装饰：
 *   ① **它会红在与这次改动无关的原因上** —— 别人动了别的文件、分母变了，你的 PR 红了，
 *      而你的 diff 里没有任何该改的东西；「无法据此行动」的红灯成本远大于收益
 *      （§13.5.29 那一族的同类）；
 *   ② **它会惩罚正确行为** —— 删掉一个覆盖很好但已废弃的模块，剩下的是低覆盖代码，
 *      整体覆盖率下降，做对了事反而红；
 *   ③ **它会诱导刷指标** —— 门槛卡住合并时人就写「执行但不验证」的用例凑数，而覆盖率
 *      量的是执行、不是验证：一条没有任何断言的用例照样贡献分子。
 * 该红的是 **patch coverage**（只量这次 diff 里新增/改动的行：红 ⇒ 原因一定在你这次
 * 改的代码里，且知道该给哪几行补测试）—— 那是另一种能力，另立单，不在这里顺手做。
 *
 * ⚠️ 「摘掉**判定**」与「摘掉**登记**」是两件事，这一层的形状就是为分清它们：
 *   · `COVERAGE_THRESHOLDS`（登记处）**永远原样在场** —— 那 149 条按实测登记的数
 *     （规范 §11.7 / §18.6 的「只升不降 + 实测值向下取整到 5 的倍数」）。
 *     判「每一条门槛的键都要落到真实文件」的那条判据（`tests/coverage-targets-exist.test.ts`）
 *     **读的是这里**，不是默认导出里那份可能被摘空的东西 —— 否则默认档下那扇门
 *     就变成「写着有、其实没人判」，而它正是那条判据立单时要治的形状；
 *   · 传给 vitest 的那一份才由开关决定。默认**不判**：覆盖率照跑、报告照出
 *     （`text` / `json-summary` / `lcov` 三种 reporter 一个都没动），只是不拿它决定退码；
 *     `COMFY_COVERAGE_ENFORCE=1` 才按门槛判红（本地与 `pnpm check:all` 那一档用它，
 *     见 `scripts/gates/quality-gate.mjs` 的 `test` 条目与 `scripts/affected-tests/full-suite-run.mjs` 的
 *     `--enforce-coverage`）。
 * ⚠️ **不许**在这里开 vitest 自带的 `coverage.thresholds.autoUpdate`：它会在跑的过程中
 *   改写本文件（业主点名「只能在专门 job 或本地跑，别在正常 gated run 里开」），
 *   那等于把「谁最近跑过一次覆盖率」变成改登记处的通道 —— 棘轮的每次上移都得是人签的账。
 */
const COVERAGE_ENFORCE = process.env.COMFY_COVERAGE_ENFORCE === "1";

/** 覆盖率门槛的**登记处**：与判定开关无关，永远在场（读它，不要读下面那份）。 */
/* SAFETY: 类型断言已复核 */
export const COVERAGE_THRESHOLDS = (BASE_CONFIG.test?.coverage?.thresholds ?? {}) as Record<
  string,
  unknown
>;

export default defineConfig(
  COVERAGE_ENFORCE
    ? BASE_CONFIG
    : {
        ...BASE_CONFIG,
        test: {
          ...BASE_CONFIG.test,
          coverage: { ...BASE_CONFIG.test?.coverage, thresholds: {} },
        },
      },
);
