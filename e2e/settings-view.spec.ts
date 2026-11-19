import { expect, test, type Page } from "@playwright/test";

import { openSettingsView } from "./support/settings-entry";

/**
 * 设置是**一个视图**，不是盖在内容区上的浮层（@critical）：改前是 `FullScreenLayer`（`SettingsOverlay`），无页签、不能边开边看别处。
 * 判据：顶栏菜单开设置（#1784 后入口仅剩这一处，见 `support/settings-entry.ts`）→ 设置以**瞬时页签**出现在页签条上且为当前、可关回首页、无对话框。
 * #3740 起：侧栏常驻项（含**首页**）不再进顶部页签条 —— 页签条起步为空，首页的选中态由侧栏 `data-active` 表达；
 * 设置不在侧栏（入口在顶栏菜单），所以它仍以瞬时页签进页签条。#4034：按这套现行语义重写断言。
 */
const stripOf = (page: Page) => page.getByRole("tablist", { name: "已打开的视图" });

test.describe("设置作为一个视图 @critical", () => {
  test("应用菜单点「设置」开出瞬时页签，页签条仍可操作，且没有对话框", async ({ page }) => {
    await page.goto("/workspace");
    const strip = stripOf(page);
    await expect(strip).toBeVisible({ timeout: 30_000 });
    /* 起步页签条为空：首页是侧栏常驻项，#3740 起不再进页签条。 */
    await expect(strip.getByRole("tab")).toHaveCount(0);

    await openSettingsView(page);

    /* 设置是瞬时页签：开出来且为当前。 */
    const settingsTab = strip.getByRole("tab");
    await expect(settingsTab).toHaveCount(1);
    await expect(settingsTab).toContainText("设置");
    await expect(settingsTab).toHaveAttribute("aria-selected", "true");
    /* 光有页签不算数 —— 必须真的渲染出设置界面。取 `SettingsShell` 一挂载就在的
       分区导航（它只存在于设置视图内部），所以「页签开出来了但内容区没接上视图」
       这种半拉子改法也会被判红。反向验证正是这么发现缺口的：只判页签存在时，
       把 renderCenter 的 case 删掉，判据照样绿。 */
    for (const section of ["外观", "应用更新", "本地模型", "数据库"]) {
      // oxlint-disable-next-line no-await-in-loop -- e2e 按轮次串行断言，并行会让失败归因与截图错位
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
    await expect(strip.getByRole("tab")).toHaveCount(1);

    /* 切回首页走侧栏「首页」项（#3740：首页不进页签条）；设置是瞬时页签，
       切走即退场 —— 页签条回到空。 */
    await page.getByRole("button", { name: "首页", exact: true }).first().click();
    await expect(strip.getByRole("tab")).toHaveCount(0);

    /* 不是对话框：设置内容不该活在 role=dialog 里（那意味着还是浮层）。 */
    await expect(page.getByRole("dialog").filter({ hasText: "外观" })).toHaveCount(0);
  });

  test("设置页签可关，关掉后回到首页", async ({ page }) => {
    await page.goto("/workspace");
    const strip = stripOf(page);
    await expect(strip).toBeVisible({ timeout: 30_000 });

    await openSettingsView(page);
    await expect(strip.getByRole("tab")).toHaveCount(1);

    /* 关闭按钮的可访问名是「关闭 <页签名>」，这一颗可以 exact。 */
    await strip.getByRole("button", { name: "关闭 设置", exact: true }).click();
    await expect(strip.getByRole("tab")).toHaveCount(0);
    /* 回到首页：侧栏首页项回到激活态（#3740：首页不在页签条上，激活态在侧栏）。 */
    await expect(page.getByRole("button", { name: "首页", exact: true }).first()).toHaveAttribute(
      "data-active",
      { timeout: 20_000 },
    );
  });
});
