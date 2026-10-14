import { defineConfig, devices } from "@playwright/test";
import { resolveAppPort, resolveRepoRoot } from "./scripts/app-port.mjs";
import {
  fakeComfyuiEnv,
  fakeComfyuiStatsUrl,
} from "./e2e/support/fake-comfyui-endpoint.mjs";
import { fakeExecutorEnv } from "./e2e/support/fake-comfyui-executor-env.mjs";

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
 * 会打在开始时的提示里。 */
const fakeExecutor = fakeExecutorEnv();
if (fakeExecutor.reason) {
  process.stdout.write(
    `[playwright] ⚠ 假 comfy-cli 未注入：${fakeExecutor.reason}\n`,
  );
}
const executorEnv: Record<string, string> = fakeExecutor.env;

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
 */
const COLD_COMPILE_WORKERS = 2;

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
 * 所以这里只做**降并发**这一半：现场编译时收敛到 {@link COLD_COMPILE_WORKERS} 个
 * worker（排在后面的那批不再与首帧编译抢核），`PNPM_START` 给了（= 生产构建，
 * 首屏零编译）就照旧用 Playwright 的默认并行。
 *
 * **为什么纯函数**：这一格要能被用例两向钉住（冷编译 ⇒ 收敛、已构建 ⇒ 不收敛），
 * 而「判据自己的取值」没法只在注释里自证（§11.13）。
 *
 * @param env
 * @returns `undefined` = 不覆盖 Playwright 的默认并行度
 */
export function resolveE2eWorkers(env: NodeJS.ProcessEnv): number | undefined {
  if (env.CI) return undefined;
  return env.PNPM_START ? undefined : COLD_COMPILE_WORKERS;
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/*.spec.ts"],
  /* 跑前的正面探测（ISSUE #1756）：替身端口上是不是坐着别人（真件 / 陌生服务）。
   * 放 globalSetup 而不是 webServer 的 command —— `reuseExistingServer` 为真时
   * command **不会被执行**，而那正是最需要探测的一条路径。 */
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  /* 现场编译档收敛并发（见 `resolveE2eWorkers`）：它改的是**负载**，不是任何判据的
   * 预算。`undefined`（已构建 / CI）时不写这个键 —— Playwright 用它自己的默认。 */
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
      /* 页面级性能档**不在这里跑** —— 它单独一个 project，理由见下面那条。 */
      testIgnore: ["**/runtime-budget.spec.ts"],
    },
    {
      /**
       * 页面级性能档独立成 project，且**依赖主档跑完**（ISSUE #1834 的最后一格）。
       *
       * 为什么要隔开：这一档量的是「同一路径 12 轮导航取 min」，而其余 spec 在同一台
       * dev server 上会不断触发**首帧现场编译**（本地默认就是 `pnpm dev`）。min 也扛不住
       * 这种争抢 —— 每一轮都可能被同伴撕到。实测两向：
       *   · 单跑：`1 passed (34.1s)`，在预算内；
       *   · 全量里：`loadEventEnd 964.8ms` > 预算 `320 × 2 = 640ms`（基线 2026-10-12，
       *     自带 `measuredSpread ±10.1%` —— 3.0 倍基线远在它自己的噪声带之外）。
       *
       * `dependencies` 让 Playwright 跑完 `chromium` 才起这个 project，于是那 12 轮
       * 期间**没有别的用例在抢编译**。这是治因那一半；另一半是别拿判据换颜色 ——
       * `timeout` / `factor` / 基线三处一个字节都不动（红线由
       * `tests/e2e-runtime-budget.test.ts` 钉着）。
       */
      name: "chromium-perf",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["chromium"],
      testMatch: ["**/runtime-budget.spec.ts"],
    },
  ],
  webServer: [
    {
      // CI 上必须用生产构建 + start：dev server（Turbopack）首屏要现场编译，
      // 冷启动远超 180s 的等待窗口，会让冒烟用例集体超时。CI 门禁已先跑
      // `pnpm build`，这里只需起服务。本地开发仍用 dev（热更新、无需先构建）。
      //
      // 本地那条默认**刻意不减配**：`pnpm dev` 要求先 `pnpm build` 才能跑 ——
      // 那会让「按需跑一次 e2e」变成「先花十分钟构建」。要那一档的人用
      // `PNPM_START=1` 显式说（`scripts/e2e-run.mjs` 认它，语义与 CI 档逐字相同：
      // 生产构建 + start + 不现场编译 ⇒ 并发也回到默认，见 `resolveE2eWorkers`）。
      command:
        process.env.CI || process.env.PNPM_START ? "pnpm start" : "pnpm dev",
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
