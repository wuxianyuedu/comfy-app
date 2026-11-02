import { expect, test, type Page } from "@playwright/test";

import { openSettingsView } from "./support/settings-entry";

/**
 * 设置是**一个视图**，不是盖在内容区上的一层浮层（@critical）。
 *
 * 为什么值得单独钉：改之前它是 workspace 里的一层 `FullScreenLayer`（`SettingsOverlay`），
 * 「当前在设置里」这件事只活在一个布尔值里 —— 没有页签、也不能一边开着设置一边看别处，
 * 而那层浮层的本职就是**盖住页签条**。这类"形态"问题不会让任何功能断言变红，
 * 只有直接判页签才拦得住下一次回潮。
 *
 * 判据读的是用户看得见的事实：从顶栏应用菜单打开设置（ISSUE #1784 把侧栏那两处
 * 入口撤掉了，入口只剩这一处，见 `support/settings-entry.ts`）→ 页签条上有一页
 * 「设置」并且是当前页；页签条本身仍可点（能切回首页）；屏面上没有对话框角色。
 *
 * 设置是**瞬时页签**（`NavItem.transient`）：切走就关、不常驻 —— 所以这份里
 * 「切回首页后设置那一页还在」的旧断言已经反过来，现在判的是「它退场了」。
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

    /* 页签条没被浮层盖住：还能点回首页。这条是这次改动的正面判据 ——
       旧的 `SettingsOverlay` 是铺满内容区的 `FullScreenLayer`，页签在它下面。

       ISSUE #1784 起设置是**瞬时页签**：切回首页时它**跟着退场**（用户原话
       「有些项其实不需要保持打开，那些打开的标签随着切换关闭就行」）—— 所以
       这里从「切回首页后设置仍在、只是未选中」改成「切回首页后设置整页关掉」。 */
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
