import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  closeTempTab,
  openTempView,
  tempTabButton,
  tempTabButtons,
  tempTabsOf,
} from "./support/sidebar-tabs";

/**
 * 临时页签在真浏览器里的行为（@critical）：判「装配 + 交互」这层，jsdom 替代不了 ——
 * 页签状态挂在 workspace 页面、侧栏导航要真的把它推起来、关闭要真的落回左邻。
 *
 * ISSUE #4770 之后「顶部页签栏」退役：已打开的视图页签改在**左侧栏「临时页签」组**
 * 列出（见 `SidebarTempTabs`），与常驻导航项同一套状态语言（data-active / 悬停关闭）。
 * 分组没有页签时整组不渲染，所以「起步为空」用 `toHaveCount(0)` 判，不再等一个
 * 不存在的 tablist。浏览器 / dev 形态下仍没有 iframe 页签栏（可访问名「应用页签」）。
 */
async function openWorkspace(page: Page): Promise<void> {
  await page.goto("/workspace");
}

/** 临时页签按钮集合（新 UI 下等价于旧用例里的 strip.getByRole("tab")）。 */
function tabs(page: Page): Locator {
  return tempTabButtons(page);
}

test.describe("临时页签（侧栏）@critical", () => {
  test("起步没有临时页签：首页等常驻项不参与", async ({ page }) => {
    await openWorkspace(page);
    await expect(tempTabsOf(page)).toHaveCount(0);
    await expect(page.locator('[data-view="home"]')).toBeVisible();
  });

  test("侧栏切视图不往临时页签里加页；再点同一项是聚焦而不是开第二屏", async ({ page }) => {
    await openWorkspace(page);
    await openTempView(page, "UI 控件总览");
    await expect(tabs(page)).toHaveCount(1);
    await page.getByRole("button", { name: "模型", exact: true }).first().click();
    await expect(page.locator('[data-view="models"]')).toBeVisible();
    await expect(tabs(page)).toHaveCount(1);

    const models = page.locator('[data-view="models"]');
    const before = await models.elementHandle();
    await page.getByRole("button", { name: "模型", exact: true }).first().click();
    await expect(tabs(page)).toHaveCount(1);
    expect(
      await models.evaluate((el, prev) => el === prev, before),
      "再点同一项把那一屏重挂了 —— 编辑态会丢",
    ).toBe(true);
  });

  test("关掉当前页落到左邻，首页不受影响", async ({ page }) => {
    await openWorkspace(page);
    await openTempView(page, "UI 控件总览");
    await openTempView(page, "设置");
    await expect(tabs(page)).toHaveCount(2);

    await closeTempTab(page, "设置");
    await expect(tabs(page)).toHaveCount(1);
    /* 落左邻：设置的左邻就是「UI 控件总览」，且它成为当前页。 */
    await expect(tabs(page).first()).toContainText("UI 控件总览");
    await expect(tabs(page).first()).toHaveAttribute("data-active");
    await expect(page.locator('[data-view="home"]')).toHaveCount(1);
  });

  test("能从命令面板开第一页；浏览器形态下不存在 iframe 页签栏", async ({ page }) => {
    await openWorkspace(page);
    await openTempView(page, "UI 控件总览");
    await expect(tabs(page)).toHaveCount(1);
    await expect(tabs(page).first()).toContainText("UI 控件总览");
    await expect(page.getByRole("tablist", { name: "应用页签" })).toHaveCount(0);
  });

  test("UI 控件总览切到别处仍开着（ISSUE #3798：出厂独立标签页）", async ({ page }) => {
    /* 默认档是 independent，切走不关；设置出厂 shared，切走即关。两档一次都验到。 */
    await openWorkspace(page);
    await openTempView(page, "UI 控件总览");
    await expect(tabs(page)).toHaveCount(1);

    await page.getByRole("button", { name: "模型", exact: true }).first().click();
    await expect(tabs(page)).toHaveCount(1);
    await expect(tabs(page).first()).toContainText("UI 控件总览");
    await expect(page.locator('[data-view="models"]')).toBeVisible();
    await expect(page.locator('[data-view="uiKit"]')).toBeHidden();

    await openTempView(page, "设置");
    await expect(tabs(page)).toHaveCount(2);
    await page.getByRole("button", { name: "历史", exact: true }).first().click();
    await expect(tabs(page)).toHaveCount(1);
    await expect(tabs(page).first()).toContainText("UI 控件总览");
  });

  test("切走的那一页仍然挂载（页签的意义就是让打开的界面保持打开）", async ({ page }) => {
    /* 判的是 ISSUE #1784 的第一条：页签**不卸载**被切走的视图。 */
    await openWorkspace(page);
    await openTempView(page, "UI 控件总览");
    await page.getByRole("button", { name: "模型", exact: true }).first().click();
    await page.getByRole("button", { name: "历史", exact: true }).first().click();

    for (const view of ["home", "uiKit", "models", "history"]) {
      // oxlint-disable-next-line no-await-in-loop -- e2e 按轮次串行取元素/断言，并行会让失败归因与截图错位
      await expect(
        page.locator(`[data-view="${view}"]`),
        `${view} 那一页被卸载了 —— 切回去会重新挂载`,
      ).toHaveCount(1);
    }
    await expect(page.locator('[data-view="history"]')).toBeVisible();
    for (const view of ["home", "uiKit", "models"]) {
      // oxlint-disable-next-line no-await-in-loop -- e2e 按轮次串行取元素/断言，并行会让失败归因与截图错位
      await expect(page.locator(`[data-view="${view}"]`)).toBeHidden();
    }

    const uiKit = page.locator('[data-view="uiKit"]');
    const before = await uiKit.elementHandle();
    await tempTabButton(page, "UI 控件总览").click();
    await expect(uiKit).toBeVisible();
    expect(
      await uiKit.evaluate((el, prev) => el === prev, before),
      "切回「UI 控件总览」后拿到的是另一个元素 = 那一页重新挂载了，状态会丢",
    ).toBe(true);
  });

  /* 选中态要「看得出来」——侧栏项的激活态由底色 + 左缘品牌条两路表达（§3 a11y）。 */
  test("当前页那一张看得出来：底色与左缘色条都不同于未选中", async ({ page }) => {
    await openWorkspace(page);
    await openTempView(page, "UI 控件总览");
    await openTempView(page, "设置");
    await expect(tabs(page)).toHaveCount(2);

    const readStates = () =>
      tabs(page).evaluateAll((els) =>
        els.map((el) => {
          const before = getComputedStyle(el, "::before");
          return {
            active: el.dataset.active !== undefined,
            bg: getComputedStyle(el).backgroundColor,
            barWidth: before.width,
            barOpacity: before.opacity,
          };
        }),
      );

    for (const dark of [true, false]) {
      // oxlint-disable-next-line no-await-in-loop -- e2e 按轮次串行取元素/断言，并行会让失败归因与截图错位
      await page.evaluate((d) => {
        document.documentElement.classList.toggle("dark", d);
      }, dark);
      const label = dark ? "暗色" : "浅色";

      /* 切页签 / 切主题后，左缘色条的 opacity 走 transition（ISSUE #4946）：
       * 采样早了读到的是中间值（CI 实测 0.54 / 0.82，断言未选中项色条应透明
       * 就会假红）。先轮询等它收敛到终态再取快照做下面的逐条断言 —— 是「等
       * 动画收敛」，不是抬单次断言的超时。 */
      // oxlint-disable-next-line no-await-in-loop -- e2e 按轮次串行取元素/断言，并行会让失败归因与截图错位
      await expect
        .poll(async () => {
          const off = (await readStates()).find((s) => !s.active);
          return Number(off?.barOpacity ?? "1");
        })
        .toBeLessThan(0.1);

      // oxlint-disable-next-line no-await-in-loop -- 同上，串行轮次
      const states = await readStates();
      const on = states.find((s) => s.active);
      const off = states.find((s) => !s.active);
      if (!on || !off) {
        throw new Error(`${label}：场上需要同时有选中与未选中的页签才能比对`);
      }

      expect(on.bg, `${label}：选中页签的底色与未选中相同 = 没有可见的当前态`).not.toBe(off.bg);
      expect(on.barWidth, `${label}：选中页签缺左缘色条`).toBe("2px");
      expect(Number(on.barOpacity), `${label}：选中页签的左缘色条没亮`).toBeGreaterThan(0);
      /* opacity 走 transition，采样瞬间可能还剩一个极小尾数，按「接近 0」判。 */
      expect(
        Number(off.barOpacity),
        `${label}：未选中的页签也画出色条 = 当前态不唯一`,
      ).toBeLessThan(0.1);
    }
  });
});
