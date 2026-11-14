import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * 视图页签条在真浏览器里的行为（@critical）：判「装配 + 交互」这层，jsdom 替代不了 ——
 * 页签状态挂在 workspace 页面、侧栏导航要真的把它推起来、关闭要真的落回左邻。
 *
 * ISSUE #3740 之后页签条的口径变了：**侧栏常驻项**（首页 / 模型 / 历史 / 队列 /
 * ComfyUI / 工作流库 / 模型适配 / 测试模型 / 模式契约 / 控制台）不再平铺进页签条 ——
 * 它们在侧栏里恒在、可切可关，打开态与关闭入口都收在侧栏项上。页签条只承载项目类
 * 页签与**不在侧栏的界面**（设置、UI 控件总览）。所以起步是 0 页签，「点侧栏多一页」
 * 那类旧断言已不成立；这里的用例一律按新口径判，别再按老印象改回去。
 *
 * 边界：浏览器/dev 形态下没有 iframe 页签栏（可访问名「应用页签」，那是桌面壳才有的），
 * 视图页签条叫「已打开的视图」，两者名字不能混。
 */
async function openWorkspace(page: Page) {
  await page.goto("/workspace");
  const strip = page.getByRole("tablist", { name: "已打开的视图" });
  await expect(strip).toBeVisible();
  return strip;
}

/** 「+」菜单开一个界面。挑非侧栏界面才会在页签条上留下一页（ISSUE #3740）。 */
async function openFromPlus(page: Page, strip: Locator, name: string) {
  await strip.getByRole("button", { name: "新页签", exact: true }).click();
  const item = page.getByRole("menuitem", { name, exact: true });
  await expect(item).toBeVisible();
  await item.click();
}

test.describe("视图页签条 @critical", () => {
  test("起步页签条为空：侧栏常驻项（含首页）不占页签", async ({ page }) => {
    const strip = await openWorkspace(page);
    await expect(strip.getByRole("tab")).toHaveCount(0);
    await expect(strip.getByRole("button", { name: /^关闭 / })).toHaveCount(0);
    /* 首页是固定页签：恒在、不可关，只是不再在条上平铺（ISSUE #3740）。 */
    await expect(page.locator('[data-view="home"]')).toBeVisible();
  });

  test("侧栏切视图不往页签条加页；再点同一项是聚焦而不是开第二屏", async ({ page }) => {
    const strip = await openWorkspace(page);
    await page.getByRole("button", { name: "模型", exact: true }).first().click();
    await expect(page.locator('[data-view="models"]')).toBeVisible();
    await expect(strip.getByRole("tab")).toHaveCount(0);

    const models = page.locator('[data-view="models"]');
    const before = await models.elementHandle();
    await page.getByRole("button", { name: "模型", exact: true }).first().click();
    await expect(strip.getByRole("tab")).toHaveCount(0);
    expect(
      await models.evaluate((el, prev) => el === prev, before),
      "再点同一项把那一屏重挂了 —— 编辑态会丢",
    ).toBe(true);
  });

  test("关掉当前页落到左邻，首页不受影响", async ({ page }) => {
    const strip = await openWorkspace(page);
    await openFromPlus(page, strip, "UI 控件总览");
    await openFromPlus(page, strip, "设置");
    await expect(strip.getByRole("tab")).toHaveCount(2);

    await strip.getByRole("button", { name: "关闭 设置" }).click();
    await expect(strip.getByRole("tab")).toHaveCount(1);
    /* 落左邻：设置的左邻就是「UI 控件总览」，且它成为当前页。 */
    await expect(strip.getByRole("tab").first()).toContainText("UI 控件总览");
    await expect(strip.getByRole("tab").first()).toHaveAttribute("aria-selected", "true");
    /* 首页没有关闭入口，任何一页被关都不该把它带走。 */
    await expect(page.locator('[data-view="home"]')).toHaveCount(1);
  });

  test("「+」能开一页；浏览器形态下不存在 iframe 页签栏", async ({ page }) => {
    const strip = await openWorkspace(page);
    await openFromPlus(page, strip, "UI 控件总览");
    await expect(strip.getByRole("tab")).toHaveCount(1);
    await expect(strip.getByRole("tab").first()).toContainText("UI 控件总览");

    /* 定位一律 exact：`name` 默认是非精确匹配，页签上的关闭按钮可访问名是
       「关闭 UI 控件总览」这种包含式写法，不 exact 就会先命中它 —— 这条我自己踩过。 */
    /* 这条栏是「已打开的视图」；「应用页签」属于桌面壳的 iframe 栏，浏览器里没有。 */
    await expect(page.getByRole("tablist", { name: "应用页签" })).toHaveCount(0);
  });

  test("UI 控件总览切到别处仍在页签条上（ISSUE #3798：出厂独立标签页）", async ({ page }) => {
    /* 诉求原话「UI 控件总览期望切换其他界面不要关闭」。此前它在注册表里被写死
       `transient`，配置面里又没有条目 ⇒ 设置怎么配都不认。现在默认档是
       independent，判据只认配置面（src/lib/shell/sidebar-tab-defaults.json）。 */
    const strip = await openWorkspace(page);
    await openFromPlus(page, strip, "UI 控件总览");
    await expect(strip.getByRole("tab")).toHaveCount(1);
    await expect(strip.getByRole("tab").first()).toContainText("UI 控件总览");

    /* 切到侧栏项是「切到别的界面」最常见的路径。#3740 后侧栏项自己不进页签条，
       所以条上仍只有 UI 控件总览 —— 这正是「切走不关」最干净的可观测证据。 */
    await page.getByRole("button", { name: "模型", exact: true }).first().click();
    await expect(strip.getByRole("tab")).toHaveCount(1);
    await expect(strip.getByRole("tab").first()).toContainText("UI 控件总览");
    await expect(page.locator('[data-view="models"]')).toBeVisible();
    await expect(page.locator('[data-view="uiKit"]')).toBeHidden();

    /* 同一份配置里的另一档：设置出厂 `shared`（切走即关）。把它开成第二页再切走，
       条上只剩 independent 的 UI 控件总览 —— 两档行为在真浏览器里一次都验到。 */
    await openFromPlus(page, strip, "设置");
    await expect(strip.getByRole("tab")).toHaveCount(2);
    await page.getByRole("button", { name: "历史", exact: true }).first().click();
    await expect(strip.getByRole("tab")).toHaveCount(1);
    await expect(strip.getByRole("tab").first()).toContainText("UI 控件总览");
  });

  test("切走的那一页仍然挂载（页签的意义就是让打开的界面保持打开）", async ({ page }) => {
    /* 这条判的是 ISSUE #1784 的第一条：页签**不卸载**被切走的视图。
       收口前 `renderCenter()` 用 `switch (viewMode)` 只渲染当前那一屏，切走即卸载
       —— 表现是切回画布得到一张重开的空网、控制台里跑着的命令断连。 */
    const strip = await openWorkspace(page);
    await openFromPlus(page, strip, "UI 控件总览");
    await page.getByRole("button", { name: "模型", exact: true }).first().click();
    await page.getByRole("button", { name: "历史", exact: true }).first().click();

    /* 四个视图容器都在 DOM 里（`data-view` 是各页 wrapper 的锚），
       当前那一页可见、另外三页带 `hidden`。 */
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

    /* 切回「UI 控件总览」：它一直是同一个 DOM 节点（不是重新挂载的新节点）。
       用元素句柄判同一性 —— 重新挂载会让旧 handle 变成 detached。 */
    const uiKit = page.locator('[data-view="uiKit"]');
    const before = await uiKit.elementHandle();
    await strip.getByRole("tab").first().click();
    await expect(uiKit).toBeVisible();
    expect(
      await uiKit.evaluate((el, prev) => el === prev, before),
      "切回「UI 控件总览」后拿到的是另一个元素 = 那一页重新挂载了，状态会丢",
    ).toBe(true);
  });

  /* 选中态要「看得出来」——这条是补的洞。
     此前这里只断言 `aria-selected`，于是「壳的标题行里选中页签用 `bg-canvas`
     （#0a0a0f）压在同色系的标题行上、比底还暗」这种问题**全绿通过**：无障碍语义
     是对的，眼睛读不出来。规范 §11.8 的口径就是这类事要读计算样式，而不是再靠
     语义属性兜。 */
  test("当前页那一张看得出来：选中页签的背景与顶部色条都不同于未选中", async ({ page }) => {
    const strip = await openWorkspace(page);
    /* 场上要同时有「选中 / 未选中」两张可比：得开两个都不在侧栏的界面，
       它们才都会进页签条（ISSUE #3740）。 */
    await openFromPlus(page, strip, "UI 控件总览");
    await openFromPlus(page, strip, "设置");
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
