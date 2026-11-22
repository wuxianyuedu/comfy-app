import { expect, type Page } from "@playwright/test";

/**
 * 「应用首页已经渲染出来」的唯一锚点。三份 spec（`smoke` / `critical-flows` / `project-context-refresh`）曾各自把锚点写成首页
 * 欢迎区大标题「灵感从这里开始」，ISSUE #1691 删掉后三处同时红 —— 不是首页坏了，是锚点没了（另两份 visual 用例已按 ISSUE #1620 撤掉，§11.8）。
 * 故选「新建画布」：静态（不依赖在线态 / 模型计数 / 最近项目）且是四张入口卡第一张；页面标题不可用 —— `document.title` 是根布局 metadata（`src/app/layout.tsx`），骨架 / 报错页时值也一样。
 */
export const HOME_ENTRY_CARD_LABEL = "新建画布";

/**
 * 等首页渲染完成（四张入口卡里的第一张可见即算）。
 * ⚠️ 按**文本**取而非 `getByRole("button", { name })`：无障碍名是「标签 + 描述」拼出来的（`新建画布 自由编排节点工作流`），带 `exact` 的角色查询一条都匹配不上。
 * `getByText(..., { exact: true })` 命中的是卡片里只含标签的 `<p>`，「新建画布项目」那张卡不会被误抓（实测五份用例一起红在这里）。
 */
export async function expectHomeReady(page: Page): Promise<void> {
  await expect(page.getByText(HOME_ENTRY_CARD_LABEL, { exact: true }).first()).toBeVisible();
}

/**
 * 从首页真正建出一个项目（ISSUE #4765 起「新建先命名」：点卡片只开对话框，
 * 必须填名字并点「创建项目」才会落库并进入项目页）。E2E 里凡是后面要判
 * 「已经在项目里」的，都走这里，别再只点卡片就等项目页出现。
 */
export async function createNamedProject(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "新建画布项目" }).first().click();
  const dialog = page.getByRole("dialog").filter({ hasText: "新建项目" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "项目名称（必填）" }).fill(name);
  await dialog.getByRole("button", { name: "创建项目" }).click();
  await expect(dialog).toBeHidden();
}
