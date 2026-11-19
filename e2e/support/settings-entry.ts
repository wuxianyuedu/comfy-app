import { expect, type Page } from "@playwright/test";

/**
 * 「打开设置」的**唯一入口**：顶栏右上角的应用菜单 → 设置。此前有三处入口（侧栏列表项、侧栏底部项、顶栏菜单项），用户反馈一句话就收成一处（ISSUE #1784）。
 * 代价是所有 e2e 都得改走这里：留 `getByRole("button", { name: "设置" })` 在侧栏撤掉后会静默变成「等到超时」，红的原因（入口没了）与它看起来判的事（设置页长相）不是一回事。
 * 菜单项是 `menuitem` 不是 `button`（`DropdownMenuItem` 渲染 `role="menuitem"`，侧栏那两项才是 `button`），这个角色差别正是「入口已搬走」的证据。
 */
export async function openSettingsView(page: Page): Promise<void> {
  /* 菜单开合挂在 pointerdown 上（base-ui），真浏览器里才点得开 —— 见
     `top-bar-app-menu.spec.ts` 的说明。先确认菜单是关的，避免下面那次
     `menuitem` 可见断言是在看别人的浮层。 */
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.getByRole("button", { name: "应用菜单" }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "设置" }).click();
  /* 设置是 dynamic import + 首屏 loading，给它更宽的等待窗口（与收口前一致）。
     等的是**分区导航**而不是标题：工作区这份挂载点的屏名是 `sr-only`（页签与顶栏
     已经在写「设置」，屏内不再重复，ISSUE #1872），`toBeVisible` 量不了那枚被裁到
     1px 的 `h1`；而导航只存在于设置视图内部，它出现即「内容区真的接上了视图」。 */
  await expect(
    page
      .getByRole("navigation", { name: "设置分区" })
      .getByRole("button", { name: "外观", exact: true }),
  ).toBeVisible({ timeout: 20_000 });
}
