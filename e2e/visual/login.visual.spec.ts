import {
  test,
  expect,
  devices,
  type Locator,
  type Page,
} from "@playwright/test";

/**
 * 视觉回归首个像素基线（样板）。
 *
 * 为什么选 /login：
 * - 纯 Client 组件、首次渲染不依赖 DB / 登录态 / ComfyUI 后端。
 * - 承载品牌、表单、Tab 切换、空态提示等多类 UI，是稳定的像素基线起步对象。
 * - 登录页为固定深色 UI，可作为「深色主题」基线样板；其余关键 UI
 *   （xyflow 画布、空态、弹窗、深浅色对比）在能钉死渲染数据的页面就绪后，
 *   按 §11.8 约束补充到本目录。
 *
 * ⚠️ **「不依赖后端」不等于「像素可复现」**：根布局会在页面上挂全局
 * `BrowserStatusBar`，它自带**实时帧率与系统时钟**，Next 的 dev 指示器也会出现在
 * 左下角。这两块都不是被测界面，却会逐帧变 —— 桌面端 fullPage 因此永远取不到两张
 * 稳定截图，表现为 `Failed to take two consecutive stable screenshots`（实测差异只有
 * 约 90 个像素，就是 FPS 那两位数字）。所以本文件把它们**遮罩**掉：像素层守的是
 * 布局 / 配色 / 尺寸，不是时钟读数。
 *
 * 维护：基线 PNG 提交入库，改动用 `--update-snapshots` 重录并在 PR 标注原因。
 * 失败产物在 test-results/（已 gitignore）。基线的齐全性由
 * `tests/visual-baseline-pairing.test.ts` 判（§11.8）。
 */

/** 与被测界面无关、但会逐帧变化的两块 chrome。 */
async function unstableChromeMasks(page: Page): Promise<Locator[]> {
  const masks = [page.locator('[aria-label="底部状态栏"]')];
  // Next 的 dev 指示器只在 dev 存在；生产构建下给它加 mask 会因为定位不到而报错，
  // 所以按存在与否决定 —— 判据要能同时在 `pnpm dev` 与 `pnpm start` 下跑。
  const devIndicator = page.locator("nextjs-portal");
  if ((await devIndicator.count()) > 0) masks.push(devIndicator);
  return masks;
}

test.describe("登录页视觉基线", () => {
  test("桌面端登录页全页基线", async ({ page }) => {
    await page.goto("/login");
    // 等关键文案渲染完成，避免字体/首屏未就绪造成 flaky
    await expect(
      page.getByText("登录以同步你的作品、工作流与训练任务"),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot("login-desktop.png", {
      fullPage: true,
      mask: await unstableChromeMasks(page),
    });
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
    await expect(page).toHaveScreenshot("login-mobile.png", {
      fullPage: true,
      mask: await unstableChromeMasks(page),
    });
    await ctx.close();
  });
});
