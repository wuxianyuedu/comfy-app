import { expect, type Page } from "@playwright/test";

/**
 * 「应用首页已经渲染出来」的**唯一锚点**。
 *
 * ## 为什么必须有一个收口处
 *
 * 三份 spec（`smoke` / `critical-flows` / `project-context-refresh`）此前各自把锚点
 * 写成首页那块欢迎区大标题「灵感从这里开始」。ISSUE #1691 把欢迎区整个删掉之后，
 * 三处**同一时刻一起变红**，而它们红的原因不是「首页坏了」，是「锚点没了」——
 * 锚点散在三处时，这类改动每次都要逐份追。
 *
 * 篇幅更早的一次（同一处收编的来源）：当时**五份** spec 共用这枚锚点，另两份是
 * `e2e/visual/*.visual.spec.ts` 里的越屏用例 —— 那条像素回归线已按 ISSUE #1620
 * 整档撤掉（见规范 §11.8），本节只列还活着的消费者。
 *
 * ## 为什么锚点选「新建画布」这一枚
 *
 * 判据要的是「首页这一屏渲染完了」，所以锚点必须满足两条：
 *   · **静态**：不依赖任何异步数据（「本机算力」卡的在线态、模型概览的计数、
 *     「最近项目」有没有项目—— 那三块都随机器 / 随上下文变，拿它们当锚点会让
 *     「等一下就好」退化成「等一个可能永远不来的东西」）；
 *   · **用户可见**：是首页四张入口卡里的第一张，正是用户进首页第一眼要看的东西。
 *
 * 页面标题那一类不可用：`next dev` 与桌面壳的窗口标题都不稳定（前者是
 * `Create T3 App` 的默认值），而 `document.title` 也表达不了「某一块渲染完了」。
 */
export const HOME_ENTRY_CARD_LABEL = "新建画布";

/**
 * 等首页渲染完成（四张入口卡里的第一张可见即算）。
 *
 * ⚠️ 按**文本**取而不是按 `getByRole("button", { name })`：那枚按钮的无障碍名是
 * 「标签 + 描述」拼起来的（`新建画布 自由编排节点工作流`），带 `exact` 的角色查询
 * 一条都匹配不上 —— 实测五份用例一起红在这里。`getByText(..., { exact: true })`
 * 命中的是卡片里那个只含标签的 `<p>`，而「新建画布项目」那张卡是另一个元素，
 * 不会被误抓。
 */
export async function expectHomeReady(page: Page): Promise<void> {
  await expect(
    page.getByText(HOME_ENTRY_CARD_LABEL, { exact: true }).first(),
  ).toBeVisible();
}
