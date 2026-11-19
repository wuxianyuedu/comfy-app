import { expect, test, type Page } from "@playwright/test";

/** 顶栏「应用菜单」真的能点开（ISSUE #1384 / @critical）。必须真浏览器：base-ui 开合挂在 pointerdown，
 * jsdom 合成事件走不到，那边写成用例只会得到恒绿的假判据。缺陷形态：两个 trigger 叠在同一元素、里层被
 * 外层吞掉 —— `Hint` 不转发任意 props，menu 的 pointerdown 与 `aria-haspopup` 被丢掉；故以
 * `aria-haspopup="menu"` 为现场证据（`data-slot` 被 tooltip 接管属已知无害副作用，别当判据，规范 16 §16.2.3.2）。
 */
async function openWorkspace(page: Page) {
  await page.goto("/workspace");
  const trigger = page.getByRole("button", { name: "应用菜单" });
  await expect(trigger).toBeVisible();
  return trigger;
}

test.describe("顶栏应用菜单 @critical", () => {
  test("触发按钮带 aria-haspopup=menu（menu 的触发 props 没被 Hint 吞掉）", async ({ page }) => {
    const trigger = await openWorkspace(page);
    await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  });

  test("点得开下拉，菜单项「设置」在浮层里", async ({ page }) => {
    const trigger = await openWorkspace(page);
    /* 开之前不该有菜单：否则下面那条 `toBeVisible` 可能是在看别人的浮层。 */
    await expect(page.getByRole("menu")).toHaveCount(0);

    await trigger.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "设置" })).toBeVisible();
  });
});
