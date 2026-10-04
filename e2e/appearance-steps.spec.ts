import { expect, test, type Page } from "@playwright/test";

/**
 * 外观两档（圆角 / 标题字阶）在真浏览器里的效果（@critical）。
 *
 * 这是仓库里第一次有「运行时改全局 CSS 变量」的控制面，所以判据必须落在
 * **计算样式**上，而不是只判"按钮点过了"：
 *   · 圆角：改 `--radius` 后，卡片与按钮的圆角要按各自系数一起变（不是只有一处动）；
 *   · 字阶：改 `--font-scale` 后标题要变，而**正文不许变** —— 界面文案就是这么承诺的，
 *     承诺和现实不符比没有这档更糟；
 *   · 刷新后仍然生效（偏好挂在根布局的引导里，跨路由成立）。
 */
const radiusGroup = (page: Page) =>
  page.getByRole("radiogroup", { name: "圆角" });
const scaleGroup = (page: Page) =>
  page.getByRole("radiogroup", { name: "标题字阶" });

async function openAppearance(page: Page) {
  await page.goto("/settings");
  await page.getByRole("button", { name: "外观", exact: true }).first().click();
  /* 设置页是按分区切换的 —— 选「外观」时看不到「应用更新」那一行，
     所以这里只能判本区自己的控件。 */
  await expect(radiusGroup(page)).toBeVisible();
  await expect(scaleGroup(page)).toBeVisible();
  /* 先等「已存偏好」落到选中态再往下点。设置页把读取延到提交之后（effect 体内
     同步 setState 会被判级联渲染），所以刚进来的那一瞬，选中态还是默认值；
     不等它就点，选中态可能被那次延迟读覆盖回去。 */
  await expect(
    radiusGroup(page).getByRole("radio", { name: /中 · 12px/ }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    scaleGroup(page).getByRole("radio", { name: /标准 100%/ }),
  ).toHaveAttribute("aria-checked", "true");
}

test.describe("外观两档 @critical", () => {
  test("圆角改档会真的传导到卡片与按钮，且刷新后仍在", async ({ page }) => {
    await openAppearance(page);

    const card = page.locator('[data-slot="card"]').first();
    await expect(card).toBeVisible();
    const before = await card.evaluate(
      (el) => getComputedStyle(el).borderTopLeftRadius,
    );

    await radiusGroup(page).getByRole("radio", { name: /特大/ }).click();
    const after = await card.evaluate(
      (el) => getComputedStyle(el).borderTopLeftRadius,
    );
    expect(after).not.toBe(before);
    /* 同一个总闸派生：按钮圆角也必须跟着变，否则说明有两份圆角来源。 */
    const buttonRadius = await radiusGroup(page)
      .getByRole("radio", { name: /特大/ })
      .evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    expect(parseFloat(buttonRadius)).toBeGreaterThan(12);

    await page.reload();
    await page
      .getByRole("button", { name: "外观", exact: true })
      .first()
      .click();
    await expect(
      radiusGroup(page).getByRole("radio", { name: /特大/ }),
    ).toHaveAttribute("aria-checked", "true");
    const reloaded = await page
      .locator('[data-slot="card"]')
      .first()
      .evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    expect(reloaded).toBe(after);
  });

  test("字阶只作用于标题，正文不跟着变（界面就是这么承诺的）", async ({
    page,
  }) => {
    await openAppearance(page);

    const title = page.getByRole("heading", { name: "设置" });
    const bodyText = page.getByText("适合低光环境");

    const titleBefore = await title.evaluate(
      (el) => getComputedStyle(el).fontSize,
    );
    const bodyBefore = await bodyText.evaluate(
      (el) => getComputedStyle(el).fontSize,
    );

    await scaleGroup(page).getByRole("radio", { name: /宽松/ }).click();

    const titleAfter = await title.evaluate(
      (el) => getComputedStyle(el).fontSize,
    );
    expect(parseFloat(titleAfter)).toBeGreaterThan(parseFloat(titleBefore));
    /* 正文锚定：这一档的作用范围必须与设置页那句说明一致。 */
    const bodyAfter = await bodyText.evaluate(
      (el) => getComputedStyle(el).fontSize,
    );
    expect(bodyAfter).toBe(bodyBefore);
  });
});
