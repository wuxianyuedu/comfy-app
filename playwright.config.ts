import { availableParallelism } from "node:os";

import { defineConfig, devices } from "@playwright/test";
import { resolveAppPort, resolveRepoRoot } from "./scripts/app-port.mjs";
import {
  fakeComfyuiEnv,
  fakeComfyuiStatsUrl,
} from "./e2e/support/fake-comfyui-endpoint.mjs";
import {
  COMFY_CLI_PYTHON_KEY,
  fakeExecutorEnv,
} from "./e2e/support/fake-comfyui-executor-env.mjs";
import {
  decodePythonPreflight,
  PYTHON_PREFLIGHT_ENV_KEY,
} from "./e2e/support/preflight-python.mjs";

/**
 * Playwright E2E 配置（AGENTS 硬规则：本仓库只用 pnpm，webServer 用 `pnpm dev`）。
 * - webServer: 起 Next dev server（端口走 scripts/app-port.mjs 的统一解析，
 *   与 dev/start/启动链路同源），测试前自动等待就绪
 *   （pnpm 而非 npm：AGENTS.md 硬规则 1，npm/npx 在本仓库解析 typescript 别名
 *   链会崩溃）
 * - testDir:   ./e2e
 *   - *.spec.ts            E2E / 冒烟（e2e/）
 * - 仅 chromium（本地冒烟，不跑全矩阵）
 */
const appPort = resolveAppPort(resolveRepoRoot());
const appOrigin = `http://localhost:${appPort}`;

/**
 * 假 comfy-cli 怎么被起（ISSUE #1621；跨平台形态见
 * `e2e/support/fake-comfyui-executor-env.mjs`）。
 *
 * 本应用的任务**只经 comfy-cli 执行**：`executor-cli.ts` 起
 * `spawn(comfyCliPython, ["-m", "comfy_cli", "run", …])`。要让「出图」这条
 * 链路在 e2e 里真跑通，这个解释器必须存在且能应答 —— 而它对 CI 的要求只是
 * 「有一个能跑的 Python」，不是「装好 torch 的 ComfyUI 环境」。
 *
 * 注入方式经 `COMFY_CLI_PYTHON` 环境变量：它是设置项 `comfyCliPython` 的
 * **默认值来源**（见 `src/lib/app-settings/index.ts` 的 DEFAULTS），所以
 * 不必让用例去写设置文件、也不必给整个仓库留一份本机配置。`webServer.env`
 * 会随 `pnpm dev` → `next dev` 一路继承到执行器进程。
 *
 * **它此前是一份 `python.sh` shim，而 Windows 上 Node spawn 起不了 `.sh`** ——
 * 两条 `@critical` 主链路用例在 Windows 开发机上因此必红。现在改喂
 * `PYTHONPATH` + 一个按平台探测出来的真解释器，两个平台同一条路径。
 *
 * 只在替身包与解释器都在时才注入：**没有它也不该让全套 e2e 起不来**（视觉档、
 * 冒烟档都不碰执行链路）。缺件时主链路用例会按「执行器起不来」失败，`reason`
 * 会打在开始时的提示里。
 *
 * ── 解释器**定死成绝对路径**（ISSUE #1959 第四轮）
 *
 * `fakeExecutorEnv()` 交给应用的 `COMFY_CLI_PYTHON` 是一个**裸名字**，而应用侧把它
 * 直接 `spawn`（`executor-cli.ts` → `spawn(comfyCliPython, ["-m", "comfy_cli", …])`）
 * —— Windows 上 Node 不认 PATHEXT，裸名字必然 `ENOENT`。那一档只在「生产构建 +
 * start」上暴露，而平台侧 E2E 正是那一档。
 *
 * 解析这件事的判据不在这里（它在 `src/lib/process/python-*` + `whichCommand`），
 * 本文件只**读** `scripts/e2e-run.mjs` 起 Playwright 之前算好的那份判决 —— 同
 * `globalSetup` 读 pre-flight 端口结论的口径（ISSUE #1766）。读不到时退回裸名字：
 * 那一格是「不知道」而不是「没有」，别把手工 `pnpm exec playwright test` 弄崩。 */
const pythonPreflight = decodePythonPreflight(
  process.env[PYTHON_PREFLIGHT_ENV_KEY],
);

const fakeExecutor = fakeExecutorEnv();
if (fakeExecutor.reason) {
  process.stdout.write(
    `[playwright] ⚠ 假 comfy-cli 未注入：${fakeExecutor.reason}\n`,
  );
}
const executorEnv: Record<string, string> = fakeExecutor.env;
if (pythonPreflight?.interpreter && executorEnv[COMFY_CLI_PYTHON_KEY]) {
  executorEnv[COMFY_CLI_PYTHON_KEY] = pythonPreflight.interpreter;
}

/**
 * 现场编译档的并发 —— **不是**「慢机器降并发」那种旋钮，是「首帧要现场编译」这一格的取值。
 *
 * 2 的来历（ISSUE #1834 的 win32 读数，2026-10-13）：档位先取过 4，实测仍有
 * 3 条正好卡在 `Test timeout of 60000ms exceeded`（`/settings` ×2、`/workspace` ×1，
 * 都是重路由），而**单 worker 独跑同一条 spec 时冷编译只要 14.8s** —— 判据说的是
 * 「这一屏活不过 60s」（`timeout: 60_000` 本来就是这么设计的，不是要绕开的东西），
 * 4 个 worker 并发时重路由的首帧编译仍会被同伴撕超。所以降到 2：重路由彼此不再
 * 同时抢核。降到 2 后复测，60s 超时形态 33 → 3 → 1（剩下那条在 runtime-budget 的
 * `/workspace`，该 spec 本机**单跑也是真红** —— 性能预算 715.5ms > 640ms，与负载无关）。
 * 与钩子 C 组那个 `--maxWorkers=4` 同一条理由（并发只调负载、不碰判据）。
 *
 * ## 它为什么**不只**在本地生效（ISSUE #1993 收尾）
 *
 * 这一档此前写成「`CI` 给了就不覆盖」（`if (env.CI) return undefined`），理由是
 * 「CI 档是生产构建、首屏零编译，并发不是这一格的自由度」。那条理由只说了一半：
 * **并发不是编译的问题，是「这台机同时开几个浏览器 + 几个 worker」的问题**。实测
 * （`cnb-m0t-1k54oljem`，PR #1998）：生产构建那一档在这台 16 核机上没写 `workers`
 * ⇒ Playwright 按默认铺开（`cpus - 1` = 15），叠上 `fullyParallel` + 两条 webServer
 * ⇒ `E2E 关键流程` 跑到 **36 分钟**被平台按 stage 墙钟 kill。
 *
 * 所以判据改成「**跑生产构建时并发按现场核数算，且不高于 2**」：
 *
 *   · 核数是**事实**（`CNB_CPUS` → `os.availableParallelism()`，与 `scripts/ci-load.mjs`
 *     同一条口径，唯一出处不在这里）—— 小机器上不该开 2；
 *   · 上界 2 是**实测档**（#1834 的同一批读数：4 仍有争用形态的红）—— 大机器上不该
 *     因为核多就铺开，e2e 的用例里有大量**真起子进程**的环节（假 comfy-cli、Next 的
 *     服务端执行器），超订的代价是「等子进程」而不是「等 CPU」。
 *
 * 与 `.cnb.yml` 里 `生产构建` 那一格的 `scripts/ci-load.mjs` 是同一条取向（#1993）：
 * **降负载的杠杆是并发，不是预算**。`timeout: 60_000` 一个字不动。
 *
 * 取 `cpus - 1` 而不是 `cpus` 是 Playwright 自己的默认算法，这里沿用 —— 把那一块
 * 留给 `next start` 与替身那两个服务。
 */
const COLD_COMPILE_WORKERS = 2;

/** webServer 能起的两档，逐字就是 Playwright 要执行的命令。 */
export const E2E_SERVER_COMMANDS = {
  dev: "pnpm dev",
  start: "pnpm start",
} as const;

/**
 * 「这一趟 webServer 起的是哪一档」的**唯一出处**。
 *
 * `scripts/e2e-run.mjs` 的 `resolveServerMode()` 判的是同一件事，两处**刻意不互相
 * import**（本文件是 Playwright 的入口，由它自己加载 —— 拿配置当纯函数库引进来等于让
 * 跑法脚本依赖一个它本来不认识的模块），一致性由 `tests/e2e-runtime-budget.test.ts` 钉，
 * 与 {@link resolveE2eWorkers} 那条同一个理由。
 *
 * ## 为什么这件事需要一个**显式**的旋钮，而不是继续拿 `CI` 当代理
 *
 * 旧形态是 `CI || PNPM_START ⇒ pnpm start`。那句话把两件本来独立的事绑成了一件：
 * 「这是不是一条 CI」与「这个工作区里有没有 `next build` 的产物」。2026-10-19 把 PR
 * 那条流水线上的 `生产构建` 撤掉之后，耦合当场露出来（`cnb-ob4-1k5828a36`，
 * `E2E 关键流程` 185.8s 红）：
 *
 *   [WebServer] Error: Could not find a production build in the '.next' directory.
 *   Error: Timed out waiting 180000ms from config.webServer.
 *
 * 红在**没人声明过的东西**上：那条流水线仍然带 `CI`，配置于是仍然去起生产服务器，而产物
 * 已经不在了。`PNPM_START` 帮不上 —— 它的缺席本来代表「dev 档」，而 `CI` 那一支在它前面。
 *
 * ## 形状（三条都是刻意的）
 *
 *   · `COMFY_E2E_SERVER=dev` ⇒ `pnpm dev`（首帧**现场编译**那一档）；`= start` ⇒ `pnpm start`；
 *   · 没设这个键时**沿用旧规则**（`CI` / `PNPM_START` ⇒ start，否则 dev）：本地默认不减配，
 *     而每日那一跑的 `每日全量E2E` 现在**显式写 start** —— 它对产物的依赖从此是配置里读得出的
 *     一句话，而不是「它是 CI」的推论；
 *   · **值不认识就抛，不回落**。回落 = 「写错一个字母 ⇒ 悄悄换一档」，而两种档的负载形态
 *     完全不同（现场编译 vs 零编译），换错了只表现为「e2e 莫名其妙集体超时」——
 *     本仓最不能有的那种「红在别处」（§11.23 / §12.12 同族）。
 *
 * ⚠️ `dev` 那一档在自托管节点上**没有读数**：本文件旧注释记着它的历史形态（ISSUE #1834，
 * 8 worker 下首屏现场编译让冒烟用例集体超时）。所以「把 PR 那一格改成 dev 档」这条路
 * 今天是**已知不利**的，本仓选的是把 E2E 整格挪到每日档（`.cnb.yml` 里那段撤档说明），
 * 而不是拿一条会集体超时的 lane 冒充「PR 上也端到端验过」。
 *
 * @param env 进程环境（纯函数：用例注入，不读全局）
 * @returns `pnpm dev` 或 `pnpm start`
 */
export function resolveWebServerCommand(
  env: NodeJS.ProcessEnv,
): (typeof E2E_SERVER_COMMANDS)[keyof typeof E2E_SERVER_COMMANDS] {
  const explicit = String(env.COMFY_E2E_SERVER ?? "")
    .trim()
    .toLowerCase();
  if (explicit === "dev") return E2E_SERVER_COMMANDS.dev;
  if (explicit === "start") return E2E_SERVER_COMMANDS.start;
  if (explicit !== "") {
    throw new Error(
      `COMFY_E2E_SERVER 的值认不出来："${env.COMFY_E2E_SERVER}"（只认 dev / start）—— ` +
        "这一档决定 webServer 起的是「现场编译」还是「生产构建」，两种负载形态完全不同，" +
        "拼错时静默回落会让红读起来像用例问题。",
    );
  }
  return env.CI || env.PNPM_START
    ? E2E_SERVER_COMMANDS.start
    : E2E_SERVER_COMMANDS.dev;
}

/**
 * 「这次跑的 webServer 会不会**现场编译**首帧」—— 它决定并发档（ISSUE #1834）。
 *
 * 为什么要有这条判据：`PNPM_START` 未设时 webServer 跑 `pnpm dev`（Turbopack），
 * 而 dev server 是**按需编译**：某一个 worker 第一次导航到某条路由时，那条路由要在
 * 那一刻编译出来。实测（win32 检出，8 worker 并发、`e2e-run.mjs` 起自己的 dev server）
 * 43 条失败里有 33 条正好卡在 `Test timeout of 60000ms exceeded (1.0m)`，且散在
 * 互不相干的屏上（`appearance-steps` / `critical-flows` / `nav-auto-collapse` …）——
 * **同形态跨屏**说明红的是服务响应，不是某一条断言。
 *
 * 而这两件事（冷编译的墙钟 / 用例的自测向预算）**不是同一个旋钮**：抬 `timeout`
 * 是「拿预算换绿」，它把真挂死的检出时间一起放大；降并发是**改负载**，不碰任何
 * 判据（同 §13.6.4 那句「降负载的杠杆是并发，不是预算」）。
 *
 * 于是两条档**都要收敛**，只是理由不同：
 *
 *   · 现场编译档（本地默认）⇒ {@link COLD_COMPILE_WORKERS}：首帧编译不能与同伴抢核；
 *   · 生产构建档（`CI` / `PNPM_START`）⇒ 同样收敛到 {@link COLD_COMPILE_WORKERS}，
 *     但上界性质不同：那一档没有编译，红的是「这台机上同时开着的浏览器与服务太多」
 *     （`cnb-m0t-1k54oljem` 的 36 分钟，见文件头那段）。
 *
 * 既然两档都收敛，这个函数还成立的理由只剩一条：**核数要按现场算**（小机器上不该
 * 开 2）。所以它读 `CNB_CPUS` / `os.availableParallelism()` —— 与 `scripts/ci-load.mjs`
 * 同一条口径，但**刻意不 import 它**：那份模块是 `.mjs`（给 CI 脚本用的），本文件由
 * Playwright 自己加载，两边一致由 `tests/e2e-runtime-budget.test.ts` 钉住（它读两侧
 * 源码比对），而不是靠一条跨模块的 import 把配置图拉长。
 *
 * **为什么纯函数**：这一格要能被用例两向钉住（小机器 ⇒ 1、大机器 ⇒ 2），而
 * 「判据自己的取值」没法只在注释里自证（§11.13）。
 *
 * @param env
 * @param cpus 现场逻辑核数（缺省按环境读；`0` / 非整数 ⇒ 只用上界）
 * @returns 覆盖 Playwright 默认并行度的 worker 数（**恒有值**：不写这个键就等于让
 *   Playwright 按核数铺开 —— `cpus - 1`，16 核上是 15 —— 而那正是本条要治的形态）
 */
export function resolveE2eWorkers(
  env: NodeJS.ProcessEnv,
  cpus = resolveLocalCpus(env),
): number {
  /* 两档都收敛（见函数头注），所以 `CI` / `PNPM_START` 不再分流 —— 入参留着是为了
   * 让「同一对键」这条口径在签名上仍然只有一处（调用点与跑法脚本共用）。 */
  void env;
  /* `cpus - 1` 是 Playwright 自己的默认算法（留一块给 `next start` 与替身两个服务），
   * 单核那档**不能**算成 0 —— `Math.max(1, …)` 兜住它，而不是让它退化成上界。 */
  const usable =
    Number.isInteger(cpus) && cpus >= 1 ? Math.max(1, cpus - 1) : null;
  const byCores = usable ?? COLD_COMPILE_WORKERS;
  return Math.max(1, Math.min(COLD_COMPILE_WORKERS, byCores));
}

/**
 * 现场逻辑核数 —— `CNB_CPUS`（平台读数）优先，读不到落本机。
 *
 * 与 `scripts/ci-load.mjs` 的 `resolveCores()` 同序、同一条理由（平台池 / cgroup
 * 限额下 `availableParallelism` 会照宿主机报）。**不合法值不静默变成 0**：
 * 非正整数就往后落，两条都拿不到才回 `0`（`resolveE2eWorkers` 把它当「不知道」，
 * 只用上界 —— 猜核数比不猜更危险）。
 *
 * @param env
 * @returns 逻辑核数；读不到回 `0`
 */
export function resolveLocalCpus(env: NodeJS.ProcessEnv = process.env): number {
  const raw = String(env.CNB_CPUS ?? "").trim();
  const parsed = Number(raw);
  if (raw !== "" && Number.isInteger(parsed) && parsed >= 1) return parsed;
  const local = availableParallelism();
  return Number.isInteger(local) && local >= 1 ? local : 0;
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/*.spec.ts"],
  /* 跑前的正面探测（ISSUE #1756）：替身端口上是不是坐着别人（真件 / 陌生服务）。
   * 放 globalSetup 而不是 webServer 的 command —— `reuseExistingServer` 为真时
   * command **不会被执行**，而那正是最需要探测的一条路径。 */
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  /* 两档都收敛（见 `resolveE2eWorkers`）：它改的是**负载**，不是任何判据的预算。
   * 此前 `CI` 档刻意不写这个键、让 Playwright 用它自己的默认（`cpus - 1`）——
   * 那在 16 核节点上等于 15 个 worker + 两条 webServer，`E2E 关键流程` 因此跑到
   * 36 分钟被墙钟 kill（`cnb-m0t-1k54oljem`）。 */
  workers: resolveE2eWorkers(process.env),
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: appOrigin,
    trace: "on-first-retry",
    locale: "zh-CN",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      // 起哪一档由 `resolveWebServerCommand` 一处决定（下面那格），这里只消费它的结论。
      command: resolveWebServerCommand(process.env),
      url: appOrigin,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      // Next 16 默认读 .env / .env.production：CI 无真实密钥，跳过 env.js 校验
      /* 除跳过 env 校验外，还要把假 comfy-cli 的解释器注进来（ISSUE #1621）：
       * 执行器是**服务端**起的子进程，它的 PATH / 解释器都来自这个进程的环境，
       * 浏览器侧任何拦截都够不到。 */
      env: {
        SKIP_ENV_VALIDATION: "1",
        ...executorEnv,
        /* 应用连**替身**而不是 8188 上的真件（ISSUE #1756）：替身换到自己
         * 的端口后，本机真 ComfyUI 继续在 8188 上跑、互不遮挡。
         * 三个键一次喂全见 `fakeComfyuiEnv()`（拼漏一处的表现就是
         * 「应用连真件、替身空跑」，正是本 ISSUE 要根治的形态）。 */
        ...fakeComfyuiEnv(),
      },
    },
    {
      // 假 ComfyUI（ISSUE #310）：内嵌能不能成，取决于**被嵌页自己**的响应头
      // （未开 CORS 时对跨源请求返 403）。这条链路是**服务端**探测的
      // （`setting.comfyEmbeddable`），浏览器侧 `route.fulfill` 伪造不到，
      // 必须真有一个 HTTP 服务在替身端口上，才能覆盖「点打开查看 → 页签真的
      // 渲染出被嵌页」这条路。默认带 `--enable-cors-header` 语义（用户实际
      // 会遇到的正常路径）。
      // 端口**不是** 8188（那会被本机真件占走，见 ISSUE #1756）：替身默认在
      // 18188，`fake-comfyui-endpoint.mjs` 是它的唯一落点。
      command: "node e2e/support/fake-comfyui-server.mjs",
      /* 端口与地址都由 `fake-comfyui-endpoint.mjs` 给（单一落点）：替身与真件
       * 因此**不同端口**，本机开着真 ComfyUI 也能跑 e2e —— 不必让谁先停掉它。 */
      url: fakeComfyuiStatsUrl(),
      env: fakeComfyuiEnv(),
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
