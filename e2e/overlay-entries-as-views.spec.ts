import { expect, test, type Page } from "@playwright/test";

/**
 * 「模型适配」「模式契约」作为**视图**的端到端判据（此前它们是侧栏点开的弹窗）。
 *
 * 为什么值得单独一份、而不是并进 `settings-view.spec.ts`：那一份判的是「浮层 → 视图」
 * 这一族改动的**通用形状**，而这一份多两件事 ——
 *   ① 同一件事有**三个**入口（侧栏 / 工作流库页头 / 工坊阶段内的就近提示），
 *      它们必须落在**同一个**页面上。旧形态下侧栏开的是外壳挂的弹窗、工作流库开的是
 *      自己 `useState` 的弹窗，两处各一份「开没开」的真相；
 *   ② 这两页各自要拉 tRPC（适配器清单 / 契约注册表），所以「页签开出来了但内容区
 *      没接上视图」这种半拉子改法在这里尤其容易溜过去 —— 判据必须读到页面**自己的**
 *      文案，不能只数页签。
 *
 * 定位一律按**位序 + 文本**，不按 `name` + `exact`：页签内含关闭按钮，算出来的可访问
 * 名是「模型适配 关闭 模型适配」这种拼接结果（与 `settings-view.spec.ts` 同一个坑）。
 */

function stripOf(page: Page) {
  return page.getByRole("tablist", { name: "已打开的视图" });
}

/** 把某一页开出来并断言它**真的渲染了内容**（不是只有页签）。 */
async function expectViewRendered(
  page: Page,
  entryLabel: string,
  contentAnchors: string[],
) {
  const strip = stripOf(page);
  await expect(strip).toBeVisible({ timeout: 30_000 });
  await expect(strip.getByRole("tab")).toHaveCount(1);

  await page
    .getByRole("button", { name: entryLabel, exact: true })
    .first()
    .click();

  const tab = strip.getByRole("tab").nth(1);
  await expect(tab).toHaveCount(1);
  await expect(tab).toContainText(entryLabel);
  await expect(tab).toHaveAttribute("aria-selected", "true");

  /* 光有页签不算数：内容区必须真接上视图。取该页**独有**且无条件渲染的文案。 */
  for (const anchor of contentAnchors) {
    await expect(
      page.getByText(anchor).first(),
      `${entryLabel} 视图里缺「${anchor}」`,
    ).toBeVisible();
  }

  /* 反向判据：它不该再是对话框。旧形态下这一句必红，所以它是「改成视图」这件事
     的正面证据，而不是装饰 —— 只判「内容可见」时，弹窗也满足。 */
  await expect(page.getByRole("dialog")).toHaveCount(0);

  /* 重复点击不产生第二页（与所有视图同一条契约：已存在即聚焦）。 */
  await page
    .getByRole("button", { name: entryLabel, exact: true })
    .first()
    .click();
  await expect(strip.getByRole("tab")).toHaveCount(2);

  /* 页签条没被浮层盖住：还能点回首页。 */
  const homeTab = strip.getByRole("tab").first();
  await expect(homeTab).toContainText("首页");
  await homeTab.click();
  await expect(homeTab).toHaveAttribute("aria-selected", "true");
  await expect(tab).toHaveAttribute("aria-selected", "false");
}

test.describe("模型适配 / 模式契约作为视图 @critical", () => {
  test("侧栏点「模型适配」开出一页页签，内容真的渲染，且不在对话框里", async ({
    page,
  }) => {
    await page.goto("/workspace");
    await expectViewRendered(page, "模型适配", ["选择远端模型（生图 / 视频）"]);
  });

  test("侧栏点「模式契约」开出一页页签，内容真的渲染，且不在对话框里", async ({
    page,
  }) => {
    await page.goto("/workspace");
    await expectViewRendered(page, "模式契约", [
      "选择要配置的模式（与工作流库同一定义）",
    ]);
  });

  test("两个入口落在**同一对**页面：侧栏开过之后，重复开不增页签、也不叠弹窗", async ({
    page,
  }) => {
    await page.goto("/workspace");
    const strip = stripOf(page);
    await expect(strip).toBeVisible({ timeout: 30_000 });

    await page
      .getByRole("button", { name: "模型适配", exact: true })
      .first()
      .click();
    await expect(strip.getByRole("tab")).toHaveCount(2);
    await page
      .getByRole("button", { name: "模式契约", exact: true })
      .first()
      .click();
    await expect(strip.getByRole("tab")).toHaveCount(3);

    /* 两页并存 ⇒ 它们是页签，不是「同一时刻只开一个」的浮层。旧形态下第二下点击会把
       第一层弹窗顶掉（外壳那份 `overlay` 状态是单值），页签数不会涨到 3。 */
    const labels = await strip.getByRole("tab").allTextContents();
    expect(labels.some((t) => t.includes("模型适配"))).toBe(true);
    expect(labels.some((t) => t.includes("模式契约"))).toBe(true);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("工作流库页头那枚「模式契约」也切到同一页，不再自己开第二层弹窗", async ({
    page,
  }) => {
    /* 这一条管的是**第二个入口**：旧形态下侧栏与工作流库各开各的弹窗（一处是外壳的
       `overlay` 状态，一处是 `ModeContractSettings` 自己的 `useState`），于是「契约
       开没开」有两份真相而页签上完全看不出来。现在两处都只能落到同一个视图页。 */
    await page.goto("/workspace");
    const strip = stripOf(page);
    await expect(strip).toBeVisible({ timeout: 30_000 });

    /* 先进工作流库（侧栏「流程」）。 */
    await page
      .getByRole("button", { name: "流程", exact: true })
      .first()
      .click();
    await expect(strip.getByRole("tab")).toHaveCount(2);

    /* **前置断言**：同名按钮此刻恰好两枚 —— 侧栏那一项 + 工作流库页头那一枚。
       这一句不是啰嗦，它治两种失败形态：
         ① 少了它，`.nth(1)` 在工作流库那枚**根本没渲染**时会退化成点侧栏那枚 ——
           判据照样绿，而它从头到尾没碰过被测组件（本用例的第一版正是这样：反向验证
           把工作流库那枚退回「自己开一层弹窗」，它全绿）；
         ② 只数不点也不够 —— 数到 2 但取错索引，等于判了侧栏那条已经判过的路。 */
    const entryButtons = page.getByRole("button", {
      name: "模式契约",
      exact: true,
    });
    await expect(entryButtons).toHaveCount(2);

    /* DOM 顺序：侧栏在内容区之前 ⇒ 第二枚是工作流库页头那一枚。 */
    await entryButtons.nth(1).click();

    await expect(strip.getByRole("tab")).toHaveCount(3);
    const labels = await strip.getByRole("tab").allTextContents();
    expect(labels.some((t) => t.includes("模式契约"))).toBe(true);
    await expect(
      page.getByText("选择要配置的模式（与工作流库同一定义）").first(),
      "从工作流库进来时，模式契约的内容区没接上视图",
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
