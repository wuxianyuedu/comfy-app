import { expect, test } from "@playwright/test";

import {
  clearProjectIndex,
  setTheme,
  settle,
  unstableChromeMasks,
} from "./support/page-baseline";

/**
 * 首页（`/workspace`）像素基线 —— 应用主界面（§11.8）。
 *
 * 它是用户进应用看到的第一屏，承载侧栏 / 顶栏 / 视图页签 / 首页卡片栅格 /
 * 「最近项目」数块，是**布局与配色退化最贵**的一页：这里塌了，用户第一眼就知道。
 *
 * 两档主题都录：卡片层级（`bg-surface` / `border-subtle` / 阴影）与空态文案在各档
 * 下取的是不同 token，只录一档等于把另一档的退化敞着。
 *
 * ⚠️ **钉的是「无项目」的形态**，而「最近项目」区渲染空态占位卡还是真项目卡，
 * 取决于 `canvas-store`（localStorage + 服务端对账 hydration）：同一次浏览器上下文
 * 里跑过别的用例就会带上项目。所以进页面前**显式清掉项目索引**，否则基线会随
 * 「这次上下文里有没有项目」变 —— 那不是像素退化，是基线不成立。
 */

const READY_TEXT = "灵感从这里开始";

test.describe("首页视觉基线", () => {
  test("暗色档（默认外观）全页基线", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setTheme(page, "dark");
    await clearProjectIndex(page);
    await page.goto("/workspace");
    await settle(page, READY_TEXT);
    await expect(page).toHaveScreenshot("workspace-desktop-dark.png", {
      fullPage: true,
      mask: await unstableChromeMasks(page),
    });
  });

  test("浅色档全页基线（深浅两态对比）", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setTheme(page, "light");
    await clearProjectIndex(page);
    await page.goto("/workspace");
    await settle(page, READY_TEXT);
    await expect(page).toHaveScreenshot("workspace-desktop-light.png", {
      fullPage: true,
      mask: await unstableChromeMasks(page),
    });
  });
});
