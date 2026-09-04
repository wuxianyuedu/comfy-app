import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E 冒烟测试配置。
 * - webServer: `pnpm dev` 起 Next dev server（3000 端口），测试前自动等待就绪
 *   （pnpm 而非 npm：AGENTS.md 硬规则 1，npm/npx 在本仓库解析 typescript 别名
 *   链会崩溃）
 * - testDir:   ./e2e
 * - 仅 chromium（本地冒烟，不跑全矩阵）
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    locale: "zh-CN",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // CI 上必须用生产构建 + start：dev server（Turbopack）首屏要现场编译，
    // 冷启动远超 180s 的等待窗口，会让冒烟测试集体超时。CI 门禁已先跑
    // `pnpm build`，这里只需起服务。本地开发仍用 dev（热更新、无需先构建）。
    command: process.env.CI ? "pnpm start" : "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Next 16 默认读 .env / .env.production：CI 无真实密钥，跳过 env.js 校验
    env: { SKIP_ENV_VALIDATION: "1" },
  },
});
