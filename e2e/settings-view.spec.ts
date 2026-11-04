import { expect, test, type Page } from "@playwright/test";

import { openSettingsView } from "./support/settings-entry";

/**
 * 设置是**一个视图**，不是盖在内容区上的浮层（@critical）：改前是 `FullScreenLayer`（`SettingsOverlay`），无页签、不能边开边看别处。
 * 「在设置里」只活在布尔值里、浮层本职就盖住页签条 —— 形态问题不会让功能断言变红，只有判页签拦得住回潮。判据：顶栏菜单
 * 开设置（#1784 后入口仅剩这一处，见 `support/settings-entry.ts`）→ 有「设置」页签且为当前、可点回首页、无对话框；瞬时页签切走即退场。
 */
const stripOf = (page: Page) => page.getByRole("tablist", { name: "已打开的视图" });

test.describe("设置作为一个视图 @critical", () => {
  test("应用菜单点「设置」开出一页页签，页签条仍可操作，且没有对话框", async ({ page }) => {
    await page.goto("/workspace");
    const strip = stripOf(page);
    await expect(strip).toBeVisible({ timeout: 30_000 });
    /* 起步只有首页一页。 */
    await expect(strip.getByRole("tab")).toHaveCount(1);

    await openSettingsView(page);

    /* 定位按**位序 + 文本**，不按 name: 页签里含关闭按钮，算出来的可访问名是
       「设置 关闭 设置」这种拼接结果，`name:"设置", exact:true` 会命中 0 个。 */
    const settingsTab = strip.getByRole("tab").nth(1);
    await expect(settingsTab).toHaveCount(1);
    await expect(settingsTab).toContainText("设置");
    await expect(settingsTab).toHaveAttribute("aria-selected", "true");
    /* 光有页签不算数 —— 必须真的渲染出设置界面。取 `SettingsShell` 一挂载就在的
       分区导航（它只存在于设置视图内部），所以「页签开出来了但内容区没接上视图」
       这种半拉子改法也会被判红。反向验证正是这么发现缺口的：只判页签存在时，
       把 renderCenter 的 case 删掉，判据照样绿。
       顺序要紧：这一段必须在「切回首页」之前判 —— 设置不在当前页时导航自然不在。 */
    for (const section of ["外观", "应用更新", "本地模型", "数据库"]) {
      await expect(
        page.getByRole("button", { name: section, exact: true }).first(),
        `设置视图的分区导航里缺「${section}」`,
      ).toBeVisible();
    }
    /* 内容区三态之一必须在场：外壳的标题「设置」—— 不给空白页留机会。
       工作区这份挂载点**不渲染可见标题**（页签与顶栏已经在写「设置」，屏内不再
       重复，ISSUE #1872），屏名以 `sr-only` 留在 DOM —— 用 `toHaveCount` 判
       「这枚 `h1` 在场」，不拿 `toBeVisible` 去量一枚被裁到 1px 的元素。 */
    await expect(page.getByRole("heading", { level: 1, name: "设置", exact: true })).toHaveCount(1);

    /* 再开一次不产生第二页（与所有视图同一条契约：已存在即聚焦）。 */
    await openSettingsView(page);
    await expect(strip.getByRole("tab")).toHaveCount(2);

    /* 页签条没被浮层盖住：还能点回首页。旧 `SettingsOverlay` 是铺满内容区的 `FullScreenLayer`，页签在它下面。
       ISSUE #1784 起设置是**瞬时页签**：切回首页时它跟着退场（用户原话「有些项其实不需要保持打开，那些打开
       的标签随着切换关闭就行」）—— 所以这里从「切回首页后设置仍在、只是未选中」改成「切回首页后设置整页关掉」。 */
    const homeTab = strip.getByRole("tab").first();
    await expect(homeTab).toContainText("首页");
    await homeTab.click();
    await expect(homeTab).toHaveAttribute("aria-selected", "true");
    await expect(strip.getByRole("tab")).toHaveCount(1);
    await expect(settingsTab).toHaveCount(0);

    /* 不是对话框：设置内容不该活在 role=dialog 里（那意味着还是浮层）。 */
    await expect(page.getByRole("dialog").filter({ hasText: "外观" })).toHaveCount(0);
  });

  test("设置页签可关，关掉后回到首页；首页那一页依然不给关闭", async ({ page }) => {
    await page.goto("/workspace");
    const strip = stripOf(page);
    await expect(strip).toBeVisible({ timeout: 30_000 });

    await openSettingsView(page);
    await expect(strip.getByRole("tab")).toHaveCount(2);

    /* 关闭按钮的可访问名是「关闭 <页签名>」，这一颗可以 exact。 */
    await strip.getByRole("button", { name: "关闭 设置", exact: true }).click();
    await expect(strip.getByRole("tab")).toHaveCount(1);
    await expect(strip.getByRole("tab").first()).toHaveAttribute("aria-selected", "true");
    /* 关掉设置后，首页那一页依然不给关闭 —— 可关性是页签规则，不因新增视图而破。 */
    await expect(strip.getByRole("button", { name: /^关闭 / })).toHaveCount(0);
  });
});
