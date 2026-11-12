import { expect, test, type Page } from "@playwright/test";

/** 外观两档（圆角 / 标题字阶）在真浏览器里的效果（@critical）。首次有「运行时改全局 CSS 变量」的控制面，
 * 故判据落在**计算样式**而非「按钮点过了」：圆角改 `--radius` 后卡片与按钮按各自系数一起变；字阶改
 * `--font-scale` 后标题变而正文不许变（界面文案的承诺，不符比没有这档更糟）；刷新后仍生效（偏好挂在
 * 根布局引导里，跨路由成立）。
 */
const radiusGroup = (page: Page) => page.getByRole("radiogroup", { name: "圆角" });
const scaleGroup = (page: Page) => page.getByRole("radiogroup", { name: "标题字阶" });

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
  await expect(radiusGroup(page).getByRole("radio", { name: /中 · 16px/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(scaleGroup(page).getByRole("radio", { name: /标准 100%/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
}

test.describe("外观两档 @critical", () => {
  test("圆角改档会真的传导到卡片与按钮，且刷新后仍在", async ({ page }) => {
    await openAppearance(page);

    const card = page.locator('[data-slot="card"]').first();
    await expect(card).toBeVisible();
    const before = await card.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);

    await radiusGroup(page).getByRole("radio", { name: /特大/ }).click();
    const after = await card.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    expect(after).not.toBe(before);
    /* 同一个总闸派生：按钮圆角也必须跟着变，否则说明有两份圆角来源。 */
    const buttonRadius = await radiusGroup(page)
      .getByRole("radio", { name: /特大/ })
      .evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    expect(Number.parseFloat(buttonRadius)).toBeGreaterThan(12);

    await page.reload();
    await page.getByRole("button", { name: "外观", exact: true }).first().click();
    await expect(radiusGroup(page).getByRole("radio", { name: /特大/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    const reloaded = await page
      .locator('[data-slot="card"]')
      .first()
      .evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    expect(reloaded).toBe(after);
  });

  test("字阶只作用于标题，正文不跟着变（界面就是这么承诺的）", async ({ page }) => {
    await openAppearance(page);

    const title = page.getByRole("heading", { name: "设置" });
    const bodyText = page.getByText("适合低光环境");

    const titleBefore = await title.evaluate((el) => getComputedStyle(el).fontSize);
    const bodyBefore = await bodyText.evaluate((el) => getComputedStyle(el).fontSize);

    await scaleGroup(page).getByRole("radio", { name: /宽松/ }).click();

    const titleAfter = await title.evaluate((el) => getComputedStyle(el).fontSize);
    expect(Number.parseFloat(titleAfter)).toBeGreaterThan(Number.parseFloat(titleBefore));
    /* 正文锚定：这一档的作用范围必须与设置页那句说明一致。 */
    const bodyAfter = await bodyText.evaluate((el) => getComputedStyle(el).fontSize);
    expect(bodyAfter).toBe(bodyBefore);
  });
});

test.describe("外观字体自定义 #3513 @critical", () => {
  const fontInput = (page: Page, name: string) => page.getByRole("textbox", { name });

  test("三个字体输入框可见，填值写进 --font-sans 并跨刷新保留", async ({ page }) => {
    await openAppearance(page);

    await expect(fontInput(page, "界面字体")).toBeVisible();
    await expect(fontInput(page, "代码字体")).toBeVisible();
    await expect(fontInput(page, "终端字体")).toBeVisible();

    /* 默认值非空：说明默认值与 globals.css 的原字体栈一致（未退化成浏览器默认）。 */
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim(),
        ),
      )
      .not.toBe("");

    /* 填入自定义字体名 —— 判据落在 CSS 变量值而非实际渲染字形（不要求本机真装该字体）。 */
    await fontInput(page, "界面字体").fill("Inter");
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim(),
        ),
      )
      .toBe("Inter");

    /* 刷新后仍生效：偏好挂在根布局，跨路由 / 刷新都成立（与 #1434 同一根）。 */
    await page.reload();
    await page.getByRole("button", { name: "外观", exact: true }).first().click();
    await expect(fontInput(page, "界面字体")).toHaveValue("Inter");
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim(),
        ),
      )
      .toBe("Inter");
  });

  test("「恢复默认」把该档回落到项目原字体栈（含 CJK 回退）", async ({ page }) => {
    await openAppearance(page);
    await fontInput(page, "界面字体").fill("Inter");

    await page.getByRole("button", { name: "界面字体恢复默认" }).click();
    /* 默认栈逐字等于 globals.css 的 --font-sans：必须含 CJK 回退，否则恢复回去的
       是退化字体。 */
    const value = await fontInput(page, "界面字体").inputValue();
    expect(value).toContain("Sarasa UI SC");
    expect(value).toContain("PingFang SC");
  });

  test("三档字体相互独立：代码字体档只写 --font-code，不污染 --font-sans", async ({ page }) => {
    await openAppearance(page);
    const sansBefore = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim(),
    );

    await fontInput(page, "代码字体").fill("IBM Plex Mono");
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue("--font-code").trim(),
        ),
      )
      .toBe("IBM Plex Mono");

    /* 改代码字体不动界面字体（两档各写各的变量）。 */
    const sansAfter = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim(),
    );
    expect(sansAfter).toBe(sansBefore);
  });
});
