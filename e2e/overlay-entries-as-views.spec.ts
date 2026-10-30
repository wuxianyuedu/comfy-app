import { expect, test, type Page } from "@playwright/test";

/**
 * 「模型适配」「模式契约」作为**视图**的端到端判据（此前它们是侧栏点开的弹窗）。
 *
 * 为什么值得单独一份、而不是并进 `settings-view.spec.ts`：那一份判的是「浮层 → 视图」
 * 这一族改动的**通用形状**，而这一份多两件事 ——
 *   ① 同一件事有**两个**入口（侧栏 / 工作流库页头），它们必须落在**同一个**页面上。
 *      旧形态下侧栏开的是外壳挂的弹窗、工作流库开的是自己 `useState` 的弹窗，两处各
 *      一份「开没开」的真相；
 *   ② 这两页各自要拉 tRPC（适配器清单 / 契约注册表），所以「页签开出来了但内容区
 *      没接上视图」这种半拉子改法在这里尤其容易溜过去 —— 判据必须读到页面**自己的**
 *      文案，不能只数页签。
 *
 * ## 本文件在 ISSUE #1784 之后改过一次：从「常驻页签」改到「瞬时页签」
 *
 * `f72a55ee`（PR #1786）把设置 / 模型适配 / 模式契约改成**瞬时页签：切走即关**
 * （三条入口里的「设置」另从侧栏撤到顶栏应用菜单，见 `sidebarHidden`；模型适配与
 * 模式契约**仍在侧栏**）。本文件当时**没同批改**，于是它断言的是旧世界：「开两屏
 * 页签数涨到 3 且两页并存」—— 切走即关之后数不到 3。它红在 master 上，红的原因却
 * 与它看起来在判的事（这两屏是不是视图）无关。
 *
 * 改到新世界之后，这一份**判的东西更强**了：瞬时页签的要害正是「一条页签**同时**
 * 只属于当前那一屏」—— 旧写法数「页签总数」只会随着瞬时语义来回变，而
 * `transient` 的真契约是「离开它就没了、回来又有了、且始终只有一条」。
 *
 * ## 定位一律按**位序 + 文本**，不按 `name` + `exact`
 *
 * 页签内含关闭按钮，算出来的可访问名是「模型适配 关闭 模型适配」这种拼接结果
 * （与 `settings-view.spec.ts` 同一个坑）。
 */

function stripOf(page: Page) {
  return page.getByRole("tablist", { name: "已打开的视图" });
}

/**
 * 从**侧栏**开一屏（这两项的侧栏入口仍在 —— 被 `sidebarHidden` 撤掉的只有「设置」）。
 *
 * 先 `toBeVisible` 再点，而不是直接点：`getByRole(...).first().click()` 在入口
 * 不存在时会等到超时，而超时的话术（`element(s) not found`）看不出「入口撤了」与
 * 「这屏坏了」的区别 —— 这条报错指不到病灶。
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

  /* 光有页签不算数：内容区必须真接上视图。取该页**独有**且无条件渲染的文案。
   *
   * 这两屏的区块小标题在重排（ISSUE #1423 / #1711）里改成了 `SectionLabel`
   * 「短名 + 同义说明」两段：此前那一整句「选择远端模型（生图 / 视频）」现在拆成
   * `<h4>远端模型</h4>` 与 `hint`。判据锚**短名**（它无条件渲染），别锚被拆掉的
   * 长句 —— 锚长句会红在与「页签有没有接上视图」无关的文案调整上。 */
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

    await expect(currentTab(page)).toContainText("模式契约");
    await expect(
      page.getByText("选择要配置的模式").first(),
      "从工作流库进来时，模式契约的内容区没接上视图",
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
