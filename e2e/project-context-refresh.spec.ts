import { expect, test, type Page } from "@playwright/test";

import { createNamedProject, expectHomeReady } from "./support/home-anchors";

/**
 * 「新建画布项目 → 刷新」之后用户仍在项目上下文里（ISSUE #1501）。缺陷在 localStorage 与页面挂载之间：首页 `createProject()`
 * 落的「零节点零连线 + 未命名」那行正好命中空草稿哨兵，刷新时被 `reapAllEmptyDrafts()` 清掉、active-id 跟着被清。
 * jsdom 只判得到 store（canvas-store.test.ts），判不到「挂载 → 清扫 → 上下文重建」；必须同一 page 里 reload。
 *
 * ISSUE #4765/#4798 后，六个项目级视图不再是「＋」菜单里的页签，而是**项目页左侧的分区列表**
 * （`nav[aria-label="项目分区"]`）：一个项目只占一个页签，分区在同页内切换。判据等价改写为
 * 「刷新前后这份分区列表都在」，盯的仍是 active-id 是否会丢。
 */

const PROJECT_SECTION_LABELS = [
  "概览",
  "画布",
  "剧本",
  "角色卡",
  "场景分镜",
  "镜头生图",
  "视频生成",
  "成片合成",
  "资源库",
  "产出",
  "成片",
] as const;

function projectSections(page: Page) {
  return page.getByRole("navigation", { name: "项目分区" });
}

async function expectProjectContext(page: Page): Promise<void> {
  const rail = projectSections(page);
  await expect(rail).toBeVisible({ timeout: 30_000 });
  for (const label of PROJECT_SECTION_LABELS) {
    // oxlint-disable-next-line no-await-in-loop -- e2e 按轮次串行断言，并行会让失败归因与截图错位
    await expect(
      rail.getByText(label, { exact: true }).first(),
      `项目分区里缺「${label}」`,
    ).toBeVisible();
  }
}

async function stubBackend(page: Page) {
  /* 后端交互不参与本用例的判据（项目上下文全在客户端），但它**会把界面卡住**
   * —— 画布挂载要等服务端项目列表对账（hydrateFromServer）。统一快速答掉，
   * 不喂数据：本用例要判的恰恰是「没有服务端数据时，本地上下文也该活着」。 */
  await page.route("**/api/trpc/**", (route) => route.fulfill({ json: [] }));
}

test.describe("新建项目后的上下文在刷新后仍成立 @critical", () => {
  test("新建 → 刷新 → 项目分区仍在", async ({ page }) => {
    await stubBackend(page);
    await page.goto("/workspace");
    await expectHomeReady(page);

    /* 刷新前先确认还没有项目分区 —— 否则下面「刷新后还在」可能只是因为
     * 它从一开始就不依赖 active-id，判据就失去意义。 */
    await expect(projectSections(page)).toHaveCount(0);

    await createNamedProject(page, "E2E 上下文项目");
    await expect(page).toHaveURL(/\/workspace$/);

    await expectProjectContext(page);

    /* 刷新。缺陷就在这一步：active-id 被挂载时的清扫清掉，分区列表随之消失。 */
    await page.reload();
    await expectProjectContext(page);
  });

  test("刷新后 active-id 与项目索引都还在（缺陷的另一半：别只在界面上兜住）", async ({ page }) => {
    await stubBackend(page);
    await page.goto("/workspace");
    await createNamedProject(page, "E2E 上下文项目");

    /* 读客户端存储要等写入完成：createProject 跑在点击的 React 处理里，
       所以先等界面表达出「已经在项目里」再读。 */
    await expect(projectSections(page)).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("comfyapp.canvas.active.v1")))
      .not.toBeNull();

    await page.reload();
    /* reload 之后界面要先把「用户仍在项目里」表达出来，再读存储：
       缺陷态下 active 没了 ⇒ 分区列表不会出现。 */
    await expect(projectSections(page)).toBeVisible({ timeout: 30_000 });

    const stored = await page.evaluate(() => ({
      active: localStorage.getItem("comfyapp.canvas.active.v1"),
    }));
    expect(stored.active).toBeTruthy();

    /* 分区列表里要有刚建的那个项目（名字可能还是「未命名」占位）。 */
    const rail = projectSections(page);
    await expect(rail).toBeVisible();

    /* localStorage 里的项目索引也得还在，且与 active 对得上。 */
    const projects = await page.evaluate(() => {
      const raw = localStorage.getItem("comfyapp.canvas.projects.v1");
      if (raw === null) {
        return null;
      }
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
        : null;
    });
    expect(projects).not.toBeNull();
    expect(projects!.some((p) => p.id === stored.active)).toBe(true);
  });
});
