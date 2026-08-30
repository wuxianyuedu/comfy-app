import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E 冒烟测试配置。
 * - webServer: `npm run dev` 起 Next dev server（3000 端口），测试前自动等待就绪
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
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
