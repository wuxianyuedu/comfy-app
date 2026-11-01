import { expect, test, type Page } from "@playwright/test";

/**
 * 统一容器在真浏览器里的宽度账（@critical）。
 *
 * 这一刀承诺的是「收口，不改视觉」，所以判据必须落在**计算样式**上：三档宽度在
 * 产物里解析成的像素值，要和收口前散在八个视图里的那三个数逐一对上。
 * 只判「渲染出了 data-view-container」等于什么都没判 —— 类名拼错、档位没生成、
 * 令牌没发射，都能让属性在那儿而宽度是 `none`。
 *
 * 顺带判一件事：文档型容器内**恰好一层**纵向滚动条。多一层就是双层滚动
 * （整屏滚 + 内层滚），是这次要修的病形之一。
 */
/**
 * 当前**可见**那一屏里的文档容器。
 *
 * 为什么要按 `[data-view]:not(.hidden)` 限定：`f72a55ee`（PR #1786）把视图栈改成
 * **按页签逐屏渲染并保持挂载**（切走不卸载），于是所有开过的屏都留在 DOM 里，不活跃的
 * 那些带 `hidden`（见 `WorkspaceViewStack.tsx` 的 wrapper）。此前那种
 * `.first()` 会命中**首页**那一份 —— 它在「模型库」这一档里正好是隐藏的，断言于是报
 * 「hidden」，而它看起来在判的事（宽度档）根本没被读到。
 *
 * 判据用「不隐藏」而不是「第 N 个」：位序随开过的页签数漂，而「可见的那一屏」是
 * 这一档真正要问的东西（用户看到的是它）。
 */
const activeView = (page: Page) => page.locator("[data-view]:not(.hidden)").first();

const column = (page: Page) => activeView(page).locator('[class*="overflow-y-auto"] > div').first();

async function maxWidthOf(page: Page): Promise<string> {
  const el = column(page);
  await expect(el).toBeVisible();
  return el.evaluate((node) => getComputedStyle(node).maxWidth);
}

test.describe("统一容器的宽度账 @critical", () => {
  test("首页落在 narrow = 960px，且容器内只有一层滚动", async ({ page }) => {
    await page.goto("/workspace");
    /* 首页是起步唯一那一屏，所以这里 `data-view-container` 的计数就是 1（视图栈还不
       可能挂上别的屏）—— 保留这条是为了「起步只有一屏」这个前提本身被钉住。 */
    await expect(activeView(page)).toHaveAttribute("data-view", "home");
    const frame = activeView(page).locator('[data-view-container="document"]');
    await expect(frame).toHaveCount(1);
    expect(await maxWidthOf(page)).toBe("960px");

    /* 滚动层由容器写死成唯一一层，判的是**外框的直接子层**：视图内部将来加一个带
       `max-h` 的小滚动区（列表、日志框）不该把这条宿主判据打红；而视图自己再套一层
       整屏滚动，才是这里要拦的东西。 */
    await expect(
      activeView(page).locator('[data-view-container="document"] > [class*="overflow-y-auto"]'),
    ).toHaveCount(1);
  });

  test("网格类屏落在 wide = 1200px（模型库）", async ({ page }) => {
    await page.goto("/workspace");
    await page.getByRole("button", { name: "模型", exact: true }).first().click();
    await expect(activeView(page)).toHaveAttribute("data-view", "models");
    expect(await maxWidthOf(page)).toBe("1200px");
  });

  test("设置页的两栏壳用同一档位：medium = 1100px", async ({ page }) => {
    /* 设置页是「分区导航 + 内容」双栏壳，不并入 DocumentFrame，但它那个 1100 以前
       是自己写死的 —— 现在取同一颗令牌，所以这里判的是「数字只有一个家」。 */
    await page.goto("/settings");
    const shell = page.locator(".mx-auto.max-w-medium").first();
    await expect(shell).toBeVisible();
    expect(await shell.evaluate((node) => getComputedStyle(node).maxWidth)).toBe("1100px");
  });

  test("工坊屏只有一条滚动条：外框落在视口内，滚动归容器内那一层", async ({ page }) => {
    /* 走独立路由 `/workshop`：它不经过 AppShell（`(main)` 组没有 layout.tsx），
       是工坊屏的第二条渲染路径，也是这次改动最容易出事的一条 —— 外框改成「吃满
       父级」之后，如果高度链没给到，外框会退成内容高度并把底部顶出视口。
       实测（1280×720）：外框高 = innerHeight、内层滚动区 720 装 776 的内容、
       文档零溢出。所以这里三条各钉一个坏形态：
         · 外框底边不许越过视口（塌成内容高就会越）；
         · 内层必须真的能滚（不许「裁掉又够不着」）；
         · 文档不许滚（缺陷原形：根上 `min-h-screen` + 调用点再包一层
           `h-full overflow-y-auto` = 两条滚动条叠着，各滚各的）。
       也正因为外框在两条路径上都正好拿到视口高度，路由侧不需要再补一个高度壳。 */
    await page.goto("/workshop", { waitUntil: "domcontentloaded" });

    const frame = page.locator('[data-view-container="workspace"]');
    await expect(frame).toHaveCount(1);

    // 顶栏标题在视口内（内容没被裁掉）
    await expect(page.getByRole("group", { name: "工坊流程健康度" })).toBeVisible();

    /* 外框的直接子层恰好一条。工作区型内部那些带 `max-h` 的小滚动区（属性多选
       下拉、pre 块、角色列表）是视图自己的事，不在这条判据范围内。 */
    await expect(
      page.locator('[data-view-container="workspace"] > [class*="overflow-y-auto"]'),
    ).toHaveCount(1);

    const numbers = await page.evaluate(() => {
      const f = document.querySelector('[data-view-container="workspace"]');
      /* SAFETY: 类型断言已复核 */
      const scroller = f?.querySelector(
        '[class*="overflow-y-auto"]',
      ) as HTMLElement | null;
      const doc = document.scrollingElement ?? document.documentElement;
      /* SAFETY: 类型断言已复核 */
      const box = (f as HTMLElement | null)?.getBoundingClientRect();
      return {
        innerHeight: window.innerHeight,
        frameBottom: box ? Math.round(box.bottom) : -1,
        scrollerClient: scroller ? Math.round(scroller.clientHeight) : 0,
        scrollerContent: scroller ? Math.round(scroller.scrollHeight) : 0,
        docOverflow: Math.round(doc.scrollHeight - doc.clientHeight),
      };
    });

    expect(
      numbers.frameBottom,
      `外框底边 ${numbers.frameBottom} 越过视口 ${numbers.innerHeight} = 高度没从父级拿到，底部内容会被顶出去`,
    ).toBeLessThanOrEqual(numbers.innerHeight + 1);
    expect(
      numbers.scrollerContent,
      "内层滚动区装不下内容又不出滚动条 = 裁掉且够不着",
    ).toBeGreaterThan(numbers.scrollerClient);
    expect(numbers.docOverflow, "文档级滚动条还在 = 双层滚动没修掉").toBeLessThanOrEqual(1);
  });
});
