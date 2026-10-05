import { expect, test, type Page } from "@playwright/test";

/**
 * 「新建画布项目 → 刷新」之后用户仍在项目上下文里（ISSUE #1501）。
 *
 * 这条是**真浏览器**才判得出的：缺陷全程发生在 localStorage 与页面挂载之间 ——
 * 首页点「新建画布项目」走 `createProject()`，它立刻往项目索引落一行
 *「零节点零连线 + 名字 = 未命名」的记录并设 active-id；刷新时工作区页面挂载即调
 * `reapAllEmptyDrafts()`，那一行**正好命中空草稿哨兵**，于是被当成历史遗留的
 * 空草稿清掉，active-id 跟着被清。`openableViews` 只在 active 非空时才列项目类
 * 视图，所以「＋」菜单从 11 项退回 5 项 —— 用户被踢出项目。
 *
 * jsdom 那侧只判得到 store 的判据（`canvas-store.test.ts`），判不到
 * 「页面挂载 → 清扫 → 页签条重建」这条装配链路；而这一条正是当初断掉的地方。
 *
 * 为什么必须在**同一个 page** 里 reload：这正是缺陷的复现条件 ——
 * 此前项目内那六个视图在 e2e 里只能在一个页面会话内到达。
 */

/* 项目内的六个视图 —— 与 `projectTabs()` 的标签逐字对齐。
 * 名字写死是有意的：它们就是用户看见的那六个词，改标签等于改用户可见行为。 */
const PROJECT_VIEWS = [
  "主页",
  "画布",
  "工坊",
  "资源库",
  "产出",
  "成片",
] as const;

/* 五个全局项 —— 用来证明「菜单里本来只有这些」，好让多出来的六个有对照。 */
const GLOBAL_VIEWS = ["模型", "历史", "队列", "流程"] as const;

async function stubBackend(page: Page) {
  /* 后端交互不参与本用例的判据（项目上下文全在客户端），但它**会把界面卡住**
   * —— 画布挂载要等服务端项目列表对账（`hydrateFromServer`）。统一快速答掉，
   * 不喂数据：本用例要判的恰恰是「没有服务端数据时，本地上下文也该活着」。 */
  await page.route("**/api/trpc/**", (route) => route.fulfill({ json: [] }));
}

/** 打开「＋」菜单并返回其中的菜单项文字。 */
async function openViewMenuItems(page: Page): Promise<string[]> {
  await page.getByRole("button", { name: "新页签", exact: true }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const items = await menu.getByRole("menuitem").allInnerTexts();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  return items.map((text) => text.trim());
}

test.describe("新建项目后的上下文在刷新后仍成立 @critical", () => {
  test("新建 → 刷新 → 六个项目页签仍在「＋」菜单里", async ({ page }) => {
    await stubBackend(page);
    await page.goto("/workspace");
    await expect(
      page.getByRole("heading", { name: "灵感从这里开始" }),
    ).toBeVisible();

    /* 刷新前先确认菜单里**只有全局项** —— 否则下面「刷新后还在」可能只是因为
     * 它从一开始就不依赖 active-id，判据就失去意义。 */
    const before = await openViewMenuItems(page);
    for (const label of GLOBAL_VIEWS) expect(before).toContain(label);
    for (const label of PROJECT_VIEWS) expect(before).not.toContain(label);

    /* 用户动作：新建画布项目。 */
    await page.getByRole("button", { name: "新建画布项目" }).click();
    await expect(page).toHaveURL(/\/workspace$/);

    /* 界面已经把他带进项目了 —— 六个项目页签出现在菜单里。 */
    const entered = await openViewMenuItems(page);
    for (const label of PROJECT_VIEWS) expect(entered).toContain(label);

    /* 刷新。缺陷就在这一步：active-id 被挂载时的清扫清掉，下面这六个消失。 */
    await page.reload();
    /* reload 后要等界面重新稳定（侧栏 + 「＋」都到位），否则点的是旧 DOM。 */
    await expect(
      page.getByRole("heading", { name: "灵感从这里开始" }),
    ).toBeVisible();

    const afterReload = await openViewMenuItems(page);
    for (const label of PROJECT_VIEWS) expect(afterReload).toContain(label);
  });

  test("刷新后 active-id 与项目索引都还在（缺陷的另一半：别只在界面上兜住）", async ({
    page,
  }) => {
    await stubBackend(page);
    await page.goto("/workspace");
    await page.getByRole("button", { name: "新建画布项目" }).click();

    /* 读客户端存储要等写入完成：`createProject` 是同步的，但它跑在点击事件的
     * React 处理里，所以先等界面表达出「已经在项目里」再读。 */
    await expect(page.getByRole("button", { name: "新页签" })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem("comfyapp.canvas.active.v1")),
      )
      .not.toBeNull();

    await page.reload();
    /* reload 之后仍在**项目视图**（用户没被退回首页）—— 这条本身也是判据的一半：
     * 缺陷会把人留在首页，因为 active 没了、项目类视图全部落到 ProjectGate。
     * 用「＋」菜单等界面重新装好，再读存储。 */
    await expect(page.getByRole("button", { name: "新页签" })).toBeVisible();

    const stored = await page.evaluate(() => ({
      active: localStorage.getItem("comfyapp.canvas.active.v1"),
      index: localStorage.getItem("comfyapp.canvas.projects.v1"),
    }));
    expect(stored.active).not.toBeNull();
    /* 那一行不能被当成空草稿清掉 —— 它是用户刚建的、正开着的项目。 */
    const projects = JSON.parse(stored.index ?? "[]") as Array<{ id: string }>;
    expect(projects.map((project) => project.id)).toContain(stored.active);
  });
});
