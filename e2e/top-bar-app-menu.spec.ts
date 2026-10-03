import { expect, test, type Page } from "@playwright/test";

/**
 * 顶栏「应用菜单」真的能点开（ISSUE #1384 / @critical）。
 *
 * 这条必须在**真浏览器**里判：jsdom 那侧连一个光秃秃的 `DropdownMenuTrigger`
 * 都点不开（base-ui 的开合挂在 pointerdown 上，jsdom 的合成事件走不到那一步），
 * 所以「菜单能不能开」这件事 jsdom 给不出证据 —— 在那边写成用例只会得到一条
 * 永远绿的假判据。
 *
 * 缺陷形态是**两个 trigger 叠在同一个元素上、里层那个被外层吞掉**：
 * `DropdownMenuTrigger` 把自己那套触发 props 以 props 形式灌进 `render` 收到的
 * 元素，而 `Hint` 只吃 `label` / `side` / `accessibleName` / `wrap` / `children`、
 * 不转发任意 props —— 于是 menu 的 pointerdown / `aria-haspopup` 全落在 `Hint`
 * 上被丢掉，按钮长着一颗按钮的样子却什么都不做。`aria-haspopup="menu"` 是这件事
 * 最贴题的现场证据（`data-slot` 被 tooltip 接管属于**已知且无害**的副作用，
 * 见 `ui/hint` 与规范 16 §16.2.3.2，别拿它当判据）。
 */
async function openWorkspace(page: Page) {
  await page.goto("/workspace");
  const trigger = page.getByRole("button", { name: "应用菜单" });
  await expect(trigger).toBeVisible();
  return trigger;
}

test.describe("顶栏应用菜单 @critical", () => {
  test("触发按钮带 aria-haspopup=menu（menu 的触发 props 没被 Hint 吞掉）", async ({
    page,
  }) => {
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
