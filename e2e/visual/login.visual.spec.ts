import { expect, test, devices } from "@playwright/test";

import {
  setTheme,
  settle,
  unstableChromeMasks,
} from "./support/page-baseline";

/**
 * 登录页像素基线（页面级视觉，§11.8）。
 *
 * 为什么它是第一个页面级对象：纯 Client 组件、首次渲染不依赖 DB / 登录态 /
 * ComfyUI 后端，且承载品牌、表单、Tab 切换、空态提示等多类 UI。
 *
 * ⚠️ **它不固定为深色**：本节此前写「登录页为固定深色 UI，可作为深色主题基线
 * 样板」——那是过期口径。`ThemeProvider` 的约定是「**所有**表面跟随主题 token，
 * 不存在『暗色品牌页』」，登录页同样随 `.dark` 切换。默认外观是 `dark`
 * （`defaultTheme`），所以 `login-desktop.png` 这一张就是**暗色档**；
 * 浅色档要显式写 `theme` 偏好（`login-desktop-light.png`），
 * 两张一起构成 §11.8 要的「深浅两态对比」。
 *
 * 移动端那一档是 Tailwind 响应式断点的样板。
 *
 * 维护：基线 PNG 提交入库，改动用
 * `pnpm exec playwright test e2e/visual --update-snapshots` 重录并在 PR 标注原因；
 * 成套性与「被 git 跟踪」由 `tests/visual-baseline-pairing.test.ts` 判（§11.8）。
 */

const READY_TEXT = "登录以同步你的作品";

test.describe("登录页视觉基线", () => {
  test("暗色档（默认外观）全页基线", async ({ page }) => {
    await setTheme(page, "dark");
    await page.goto("/login");
    await settle(page, READY_TEXT);
    await expect(page).toHaveScreenshot("login-desktop.png", {
      fullPage: true,
      mask: await unstableChromeMasks(page),
    });
  });

  test("浅色档全页基线（深浅两态对比）", async ({ page }) => {
    await setTheme(page, "light");
    await page.goto("/login");
    await settle(page, READY_TEXT);
    await expect(page).toHaveScreenshot("login-desktop-light.png", {
      fullPage: true,
      mask: await unstableChromeMasks(page),
    });
  });

  test("移动端断点下全页基线（Tailwind 响应式样板）", async ({ browser }) => {
    const ctx = await browser.newContext({
      ...devices["iPhone 13"],
      locale: "zh-CN",
    });
    const page = await ctx.newPage();
    await page.goto("/login");
    await settle(page, READY_TEXT);
    await expect(page).toHaveScreenshot("login-mobile.png", {
      fullPage: true,
      mask: await unstableChromeMasks(page),
    });
    await ctx.close();
  });
});
