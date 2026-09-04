import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E 配置（AGENTS 硬规则：本仓库只用 pnpm，webServer 用 `pnpm dev`）。
 * - webServer: 起 Next dev server（3000 端口），测试前自动等待就绪
 * - testDir:   ./e2e
 *   - *.spec.ts            E2E / 冒烟（e2e/）
 *   - *.visual.spec.ts     视觉回归像素基线（e2e/visual/），复用同一 webServer
 * - 仅 chromium（本地冒烟，不跑全矩阵）
 *
 * 视觉基线维护：改动需人工 review。用例基线变更时用
 * `pnpm exec playwright test --update-snapshots` 重录，并在 PR 描述标注原因。
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/*.spec.ts", "**/*.visual.spec.ts"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: {
    toHaveScreenshot: {
      // 关动画/隐藏光标，让截图确定可复现（视觉基线不依赖时变内容）
      animations: "disabled",
      caret: "hide",
      // 允许轻微抗锯齿/子像素差异，避免无关噪声击穿基线
      threshold: 0.1,
    },
  },
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
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
