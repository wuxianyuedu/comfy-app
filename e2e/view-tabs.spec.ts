import { expect, test, type Page } from "@playwright/test";

/**
 * 视图页签条在真浏览器里的行为（@critical）：判「装配 + 交互」这层，jsdom 替代不了 —— 页签状态挂在
 * workspace 页面、侧栏导航要真的把它推起来、关闭要真的落回左邻。边界：浏览器/dev 形态下没有 iframe
 * 页签栏（可访问名「应用页签」，那是桌面壳才有的），视图页签条叫「已打开的视图」，两者名字不能混。
 */
async function openWorkspace(page: Page) {
  await page.goto("/workspace");
  const strip = page.getByRole("tablist", { name: "已打开的视图" });
  await expect(strip).toBeVisible();
  return strip;
}

test.describe("视图页签条 @critical", () => {
  test("起步只有首页一页，且首页那一页没有关闭按钮", async ({ page }) => {
    const strip = await openWorkspace(page);
    const tabs = strip.getByRole("tab");
    await expect(tabs).toHaveCount(1);
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    await expect(tabs.first()).toContainText("首页");
    await expect(strip.getByRole("button", { name: /^关闭 / })).toHaveCount(0);
  });

  test("侧栏切视图会多出一页并高亮；再点同一项是聚焦而不是开第二页", async ({ page }) => {
    const strip = await openWorkspace(page);
    await page.getByRole("button", { name: "模型", exact: true }).first().click();
    await expect(strip.getByRole("tab")).toHaveCount(2);
    await expect(strip.getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true");

    await page.getByRole("button", { name: "模型", exact: true }).first().click();
    await expect(strip.getByRole("tab")).toHaveCount(2);
  });

  test("关掉当前页落到左邻，关不掉首页", async ({ page }) => {
    const strip = await openWorkspace(page);
    await page.getByRole("button", { name: "模型", exact: true }).first().click();
    await page.getByRole("button", { name: "历史", exact: true }).first().click();
    await expect(strip.getByRole("tab")).toHaveCount(3);

    await strip.getByRole("button", { name: "关闭 历史" }).click();
    await expect(strip.getByRole("tab")).toHaveCount(2);
    /* 落左邻：历史右侧没有东西，左邻就是「模型」那一页。 */
    await expect(strip.getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(strip.getByRole("tab").nth(1)).toContainText("模型");
  });

  test("「+」能开一页；浏览器形态下不存在 iframe 页签栏", async ({ page }) => {
    const strip = await openWorkspace(page);
    await strip.getByRole("button", { name: "新页签", exact: true }).click();
    const item = page.getByRole("menuitem", { name: "队列", exact: true });
    await expect(item).toBeVisible();
    await item.click();
    await expect(strip.getByRole("tab")).toHaveCount(2);
    await expect(strip.getByRole("tab").nth(1)).toContainText("队列");

    /* 定位一律 exact：`name` 默认是非精确匹配，页签上的关闭按钮可访问名是
   「关闭 模型」这种包含式写法，不 exact 就会先命中它 —— 这条我自己踩过。 */
    /* 这条栏是「已打开的视图」；「应用页签」属于桌面壳的 iframe 栏，浏览器里没有。 */
    await expect(page.getByRole("tablist", { name: "应用页签" })).toHaveCount(0);
  });

  test("切走的那一页仍然挂载（页签的意义就是让打开的界面保持打开）", async ({ page }) => {
    /* 这条判的是 ISSUE #1784 的第一条：页签**不卸载**被切走的视图。
       收口前 `renderCenter()` 用 `switch (viewMode)` 只渲染当前那一屏，切走即卸载
       —— 表现是切回画布得到一张重开的空网、控制台里跑着的命令断连。 */
    const strip = await openWorkspace(page);
    await page.getByRole("button", { name: "模型", exact: true }).first().click();
    await page.getByRole("button", { name: "历史", exact: true }).first().click();
    await expect(strip.getByRole("tab")).toHaveCount(3);

    /* 三个视图容器都在 DOM 里（`data-view` 是各页 wrapper 的锚），
       当前那一页可见、另外两页带 `hidden`。 */
    for (const view of ["home", "models", "history"]) {
      // oxlint-disable-next-line no-await-in-loop -- e2e 按轮次串行取元素/断言，并行会让失败归因与截图错位
      await expect(
        page.locator(`[data-view="${view}"]`),
        `${view} 那一页被卸载了 —— 切回去会重新挂载`,
      ).toHaveCount(1);
    }
    await expect(page.locator('[data-view="home"]')).toBeHidden();
    await expect(page.locator('[data-view="models"]')).toBeHidden();
    await expect(page.locator('[data-view="history"]')).toBeVisible();

    /* 切回「模型」：它一直是同一个 DOM 节点（不是重新挂载的新节点）。
       用元素句柄判同一性 —— 重新挂载会让旧 handle 变成 detached。 */
    const models = page.locator('[data-view="models"]');
    const before = await models.elementHandle();
    await strip.getByRole("tab").nth(1).click();
    await expect(models).toBeVisible();
    expect(
      await models.evaluate((el, prev) => el === prev, before),
      "切回「模型」后拿到的是另一个元素 = 那一页重新挂载了，状态会丢",
    ).toBe(true);
  });

  /* 选中态要「看得出来」——这条是补的洞。
     此前这里只断言 `aria-selected`，于是「壳的标题行里选中页签用 `bg-canvas`
     （#0a0a0f）压在同色系的标题行上、比底还暗」这种问题**全绿通过**：无障碍语义
     是对的，眼睛读不出来。规范 §11.8 的口径就是这类事要读计算样式，而不是再靠
     语义属性兜。 */
  test("当前页那一张看得出来：选中页签的背景与顶部色条都不同于未选中", async ({ page }) => {
    const strip = await openWorkspace(page);
    /* 开第二页，场上才同时有「选中」与「未选中」可比。 */
    await page.getByRole("button", { name: "模型", exact: true }).first().click();
    await expect(strip.getByRole("tab")).toHaveCount(2);

    for (const dark of [true, false]) {
      // oxlint-disable-next-line no-await-in-loop -- e2e 按轮次串行取元素/断言，并行会让失败归因与截图错位
      await page.evaluate((d) => {
        document.documentElement.classList.toggle("dark", d);
      }, dark);
      const label = dark ? "暗色" : "浅色";

      // oxlint-disable-next-line no-await-in-loop -- e2e 按轮次串行取元素/断言，并行会让失败归因与截图错位
      const states = await strip.getByRole("tab").evaluateAll((els) =>
        els.map((el) => {
          const after = getComputedStyle(el, "::after");
          return {
            selected: el.getAttribute("aria-selected") === "true",
            bg: getComputedStyle(el).backgroundColor,
            barHeight: after.height,
            barImage: after.backgroundImage.slice(0, 60),
            barContent: after.content,
          };
        }),
      );
      const on = states.find((s) => s.selected);
      const off = states.find((s) => !s.selected);
      if (!on || !off) {
        throw new Error(`${label}：场上需要同时有选中与未选中的页签才能比对`);
      }

      expect(on.bg, `${label}：选中页签的背景与未选中相同 = 没有可见的当前态`).not.toBe(off.bg);
      /* 顶部那条品牌色条是第二条通道（只靠背景深浅，暗色下曾经不够）。 */
      expect(on.barHeight, `${label}：选中页签缺顶部色条`).toBe("2px");
      expect(on.barImage).toContain("linear-gradient");
      expect(off.barContent, `${label}：未选中的页签也画出了色条 = 当前态不再唯一`).toBe("none");
    }
  });
});
