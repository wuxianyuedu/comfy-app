import { expect, test, type Page } from "@playwright/test";

/**
 * 「模型适配」「模式契约」作为**视图**的端到端判据（此前是侧栏点开的弹窗）。相比 `settings-view.spec.ts`
 * 多两件事：① 同一件事有**两个**入口（侧栏 / 工作流库页头），必须落在同一页面；② 两页各自拉 tRPC，须读到
 * 页面自己的文案、不能只数页签。`f72a55ee`（PR #1786，ISSUE #1784）改成**瞬时页签：切走即关**，本文件当时没同批改；定位按**位序 + 文本**。
 */

function stripOf(page: Page) {
  return page.getByRole("tablist", { name: "已打开的视图" });
}

/**
 * 从**侧栏**开一屏（这两项的侧栏入口仍在 —— 被 `sidebarHidden` 撤掉的只有「设置」）。先 `toBeVisible`
 * 再点：`getByRole(...).first().click()` 在入口不存在时会等到超时，而超时话术（`element(s) not found`）
 * 看不出「入口撤了」与「这屏坏了」的区别，指不到病灶。
 */
async function openFromSidebar(page: Page, label: string): Promise<void> {
  const strip = stripOf(page);
  await expect(strip).toBeVisible({ timeout: 30_000 });
  const entry = page.getByRole("button", { name: label, exact: true }).first();
  await expect(entry, `侧栏里找不到「${label}」入口`).toBeVisible();
  await entry.click();
}

/** 当前页签条上**选中**的那一条（瞬时页签的契约全在这一条上，见文件头）。 */
function currentTab(page: Page) {
  return stripOf(page).getByRole("tab", { selected: true });
}

/** 把某一屏开出来并断言它**真的渲染了内容**（不是只有页签）。 */
async function expectViewRendered(page: Page, entryLabel: string, contentAnchors: Array<string>) {
  await openFromSidebar(page, entryLabel);

  const tab = currentTab(page);
  await expect(tab).toContainText(entryLabel);
  /* 反空转：不先确认「当前这一条就是它」，下面那几条内容断言可能是在看首页。 */
  await expect(stripOf(page).getByRole("tab")).toHaveCount(2);

  /* 光有页签不算数：内容区必须真接上视图。取该页**独有**且无条件渲染的文案。这两屏的区块小标题在重排
   * （ISSUE #1423 / #1711）里改成 `SectionLabel`「短名 + 同义说明」：原句「选择远端模型（生图 / 视频）」
   * 拆成 `<h4>远端模型</h4>` 与 `hint`。判据锚**短名**，别锚被拆掉的长句 —— 否则会红在无关的文案调整上。 */
  for (const anchor of contentAnchors) {
    await expect(
      page.getByText(anchor).first(),
      `${entryLabel} 视图里缺「${anchor}」`,
    ).toBeVisible();
  }

  /* 反向判据：它不该再是对话框。旧形态下这一句必红，所以它是「改成视图」这件事
     的正面证据，而不是装饰 —— 只判「内容可见」时，弹窗也满足。 */
  await expect(page.getByRole("dialog")).toHaveCount(0);

  /* **瞬时页签**的契约（`NavItem.transient` / `withTransientPruned`）：这两屏切走即关。
     切回首页之后页签数应当落回 1、且当前那一条是首页 —— 这一句把「它是瞬时页签」
     与「它只是恰好没常驻」分开：后者在切走时会留下一条残页。 */
  await stripOf(page).getByRole("tab").first().click();
  await expect(stripOf(page).getByRole("tab")).toHaveCount(1);
  await expect(currentTab(page)).toContainText("首页");
}

test.describe("模型适配 / 模式契约作为视图 @critical", () => {
  test("开「模型适配」开出一页页签，内容真的渲染，且不在对话框里", async ({ page }) => {
    await page.goto("/workspace");
    await expectViewRendered(page, "模型适配", ["远端模型"]);
  });

  test("开「模式契约」开出一页页签，内容真的渲染，且不在对话框里", async ({ page }) => {
    await page.goto("/workspace");
    await expectViewRendered(page, "模式契约", ["选择要配置的模式"]);
  });

  test("两个入口落在**同一页**：先后开过之后只有一条页签、也不叠弹窗", async ({ page }) => {
    /* 旧写法是「开两屏、页签数涨到 3、两页并存」—— 那判的是「常驻」，而
       `f72a55ee` 之后它们是**瞬时页签**（切走即关）。新写法判的是瞬时语义的真契约：
       从 A 切到 B 时 A 那条**必须消失**、B 那条必须在，且**始终只有一条**。
       这比数总数强：数总数会在「瞬时」与「常驻」之间来回变，而「一条」不会。 */
    await page.goto("/workspace");
    const strip = stripOf(page);
    await expect(strip).toBeVisible({ timeout: 30_000 });

    await openFromSidebar(page, "模型适配");
    await expect(strip.getByRole("tab")).toHaveCount(2);
    await expect(currentTab(page)).toContainText("模型适配");

    await openFromSidebar(page, "模式契约");
    /* 关键：**没有第三条** —— 瞬时页签切走即关。 */
    await expect(strip.getByRole("tab")).toHaveCount(2);
    await expect(currentTab(page)).toContainText("模式契约");
    const labels = await strip.getByRole("tab").allTextContents();
    expect(
      labels.some((t) => t.includes("模型适配")),
      "切走之后「模型适配」那条瞬时页签应当已经关掉",
    ).toBe(false);
    expect(labels.some((t) => t.includes("模式契约"))).toBe(true);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("工作流库页头那枚「模式契约」也切到同一页，不再自己开第二层弹窗", async ({ page }) => {
    /* 这一条管的是**第二个入口**：旧形态下侧栏与工作流库各开各的弹窗（一处是外壳的
       `overlay` 状态，一处是 `ModeContractSettings` 自己的 `useState`），于是「契约
       开没开」有两份真相而页签上完全看不出来。现在两处都只能落到同一个视图页。
       `f72a55ee` 把**侧栏**那条入口撤了，所以此刻同名按钮只剩工作流库页头那一枚 ——
       这一条因此比收口前更准：唯一的那一枚必然是页头那枚。 */
    await page.goto("/workspace");
    const strip = stripOf(page);
    await expect(strip).toBeVisible({ timeout: 30_000 });

    /* 先进工作流库（侧栏那一项就叫「工作流库」）。 */
    await page.getByRole("button", { name: "工作流库", exact: true }).first().click();
    await expect(strip.getByRole("tab")).toHaveCount(2);

    /* **前置断言**：同名按钮此刻恰好两枚 —— 侧栏那一项 + 工作流库页头那一枚。它治两种失败形态：
       ① 少了它，`.nth(1)` 在工作流库那枚没渲染时会退化成点侧栏那枚 —— 判据照样绿，而它从头到尾
          没碰过被测组件（本用例第一版正是这样：反向验证把工作流库那枚退回「自己开一层弹窗」全绿）；
       ② 只数不点也不够 —— 数到 2 但取错索引，等于判了侧栏那条已经判过的路。 */
    const entryButtons = page.getByRole("button", {
      name: "模式契约",
      exact: true,
    });
    await expect(entryButtons).toHaveCount(2);
    /* DOM 顺序：侧栏在内容区之前 ⇒ 第二枚是工作流库页头那一枚。 */
    await entryButtons.nth(1).click();

    await expect(currentTab(page)).toContainText("模式契约");
    await expect(
      page.getByText("选择要配置的模式").first(),
      "从工作流库进来时，模式契约的内容区没接上视图",
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
