import { test, expect, devices } from "@playwright/test";

/**
 * 视觉回归首个像素基线（样板）。
 *
 * 为什么选 /login：
 * - 纯 Client 组件、首次渲染不依赖 DB / 登录态 / ComfyUI 后端，确定性高。
 * - 承载品牌、表单、Tab 切换、空态提示等多类 UI，是稳定的像素基线起步对象。
 * - 登录页为固定深色 UI，可作为「深色主题」基线样板；其余关键 UI
 *   （xyflow 画布、空态、弹窗、深浅色对比）在能钉死渲染数据的页面就绪后，
 *   按 §11.8 约束补充到本目录。
 *
 * 维护：基线 PNG 提交入库，改动用 `--update-snapshots` 重录并在 PR 标注原因。
 * 失败产物在 test-results/（已 gitignore）。
 */

test.describe("登录页视觉基线", () => {
  test("桌面端登录页全页基线", async ({ page }) => {
    await page.goto("/login");
    // 等关键文案渲染完成，避免字体/首屏未就绪造成 flaky
    await expect(
      page.getByText("登录以同步你的作品、工作流与训练任务"),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot("login-desktop.png", { fullPage: true });
  });

  test("移动端断点下登录页基线（Tailwind 响应式样板）", async ({ browser }) => {
    const ctx = await browser.newContext({
      ...devices["iPhone 13"],
      locale: "zh-CN",
    });
    const page = await ctx.newPage();
    await page.goto("/login");
    await expect(
      page.getByText("登录以同步你的作品、工作流与训练任务"),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot("login-mobile.png", { fullPage: true });
    await ctx.close();
  });
});
