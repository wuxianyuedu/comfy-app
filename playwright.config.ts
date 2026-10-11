import fs from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { resolveAppPort } from "./scripts/app-port.mjs";
import {
  fakeComfyuiEnv,
  fakeComfyuiStatsUrl,
} from "./e2e/support/fake-comfyui-endpoint.mjs";

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
const appPort = resolveAppPort(process.cwd());
const appOrigin = `http://localhost:${appPort}`;

/**
 * 假 comfy-cli 的解释器入口（ISSUE #1621）。
 *
 * 本应用的任务**只经 comfy-cli 执行**：`executor-cli.ts` 起
 * `spawn(comfyCliPython, ["-m", "comfy_cli", "run", …])`。要让「出图」这条
 * 链路在 e2e 里真跑通，这个解释器必须存在且能应答 —— 而它对 CI 的要求只是
 * `python3`（容器里都有），不是「装好 torch 的 ComfyUI 环境」。
 *
 * 注入方式经 `COMFY_CLI_PYTHON` 环境变量：它是设置项 `comfyCliPython` 的
 * **默认值来源**（见 `src/lib/app-settings/index.ts` 的 DEFAULTS），所以
 * 不必让用例去写设置文件、也不必给整个仓库留一份本机配置。`webServer.env`
 * 会随 `pnpm dev` → `next dev` 一路继承到执行器进程。
 *
 * 只在能定位到那份 shim 时才注入：**没有它也不该让全套 e2e 起不来**（视觉档、
 * 冒烟档都不碰执行链路）。缺件时主链路用例会按「执行器起不来」失败，报错指向
 * 本变量的解析结果。 */
const fakeComfyCli = path.resolve(
  process.cwd(),
  "e2e/support/fake-comfyui/python.sh",
);
const executorEnv: Record<string, string> = fs.existsSync(fakeComfyCli)
  ? {
      COMFY_CLI_PYTHON: fakeComfyCli,
      /* 失败路径的触发词（ISSUE #1621 的第二个用例）。假 comfy-cli 只看工作流里
       * **有没有这个词**：有就回放失败序列。换成一个「只有这条用例才发得出」的
       * 哨兵而不是固定文案，是为了让「判据真的在判」可以反证 —— 从工作流里删掉
       * 这个词，那条用例必须转绿。 */
      E2E_FAKE_CLI_FAIL_SENTINEL: "E2E_FAKE_CLI_FAIL_SENTINEL",
    }
  : {};

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/*.spec.ts"],
  /* 跑前的正面探测（ISSUE #1756）：替身端口上是不是坐着别人（真件 / 陌生服务）。
   * 放 globalSetup 而不是 webServer 的 command —— `reuseExistingServer` 为真时
   * command **不会被执行**，而那正是最需要探测的一条路径。 */
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
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
      // CI 上必须用生产构建 + start：dev server（Turbopack）首屏要现场编译，
      // 冷启动远超 180s 的等待窗口，会让冒烟用例集体超时。CI 门禁已先跑
      // `pnpm build`，这里只需起服务。本地开发仍用 dev（热更新、无需先构建）。
      command: process.env.CI ? "pnpm start" : "pnpm dev",
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
