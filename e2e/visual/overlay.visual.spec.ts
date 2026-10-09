import { expect, test, type Locator, type Page } from "@playwright/test";

import { settle, unstableChromeMasks } from "./support/page-baseline";

/**
 * 弹窗 / 浮层尺寸像素基线 —— §11.8 的「弹窗/浮层尺寸」那一档。
 *
 * ## 为什么这一档要**量宽度**而不只是截一张图
 *
 * 浮层的尺寸踩过一次静默失效（ISSUE #720）：`DialogContent` 的 Popup 带一条
 * `max-w-[calc(100%-2rem)]`，调用处传 `popupClassName="max-w-[96vw]"` 想加宽时，
 * 两个 `max-w-*` 属同一族、谁赢由 Tailwind 的**输出顺序**决定 —— 真实 Chromium
 * 实测宽度**一个字都没变**，界面上「加宽」按钮点下去像是生效了（按钮态变了、
 * 面板没动）。修法是把档位写成跨族的 `w-*`（见 `~/components/ui/dialog-width` 的
 * 文件头）。
 *
 * 所以这一档除了截图，还用 `boundingBox()` 把两档宽度量出来断言。只截图不量的话，
 * 两个档画出同一张图也能被像素 diff 拦下 —— 但话术只会说「图不一样」，指不出
 * 是尺寸这件事。
 *
 * ## 为什么把日志内容钉成「空来源」而不让它带真行
 *
 * 日志面板的行是**逐帧在长**的（时间戳、跑 id、tRPC 错误数）—— 拿它当基线对象
 * 就是 §11.8 明令禁止的「随机/时变内容」，录出来的 PNG 明天必红，而且红得没有
 * 信息量。而**这一档的被测对象是浮层的尺寸**，不是日志内容。所以：
 *
 *   · 打开后把来源切到 **`壳侧编排`**：那一档在本环境里**恒定 0 行**
 *     （它读的是双击启动留下的 `log/launcher/shell-launch.log`，容器里没有），
 *     于是标题计数是 0/0/0/0、正文是稳定的空态文案 —— 一块确定的画布；
 *   · 页脚那颗 `服务 <bootId>` 徽标**逐次启动都不同**（它是应用服务进程标识），
 *     用它的 `title` 遮掉（与状态栏 FPS 同一族：不是被测界面、却逐帧在变）。
 *
 * ## 走的是用户真会走的那条路
 *
 * 底部状态栏那颗「日志面板」按钮（`aria-label` 由 `Hint` 的 `accessibleName`
 * 给出，文案含「日志面板」）。加宽偏好会跨会话记忆（`~/components/ui/wide-panel`），
 * 所以**每个用例进页面前先清掉那批键** —— 不清的话「默认档」用例可能开在加宽档上。
 */

/** 加宽偏好的存储键前缀（`wide-panel.ts` 的 `wideKey()`，逐字同源）。 */
const WIDE_KEY_PREFIX = "comfyapp:wide-panel:";

/** 恒定 0 行的来源（容器里没有双击启动留下的那份日志）。 */
const EMPTY_ORIGIN = "壳侧编排";

/** 默认档宽度：`modalWidth("w-6xl")` 的 base（Tailwind `w-6xl` = 72rem = 1152px）。 */
const DEFAULT_WIDTH = 1152;

/**
 * 加宽档的下限：`MODAL_WIDE_WIDTH` 是 `calc(100vw-16px)`，1440 视口下远大于它。
 *
 * 判「明显变宽了」而不是「恰好等于某个 px」：这条断言要拦的是 ISSUE #720 那种
 * 「按了没反应、宽度一个字没变」，不是「宽度微调了」——后者会随 `MODAL_WIDE_WIDTH`
 * 的修订而红，而那不是退化。
 */
const WIDE_MIN_WIDTH = DEFAULT_WIDTH + 128;

/**
 * 浮层内与被测对象无关、却逐次变化的那条：**页脚**。
 *
 * 页脚右侧那颗 `服务 <bootId>` 徽标是应用服务**本次运行**的进程标识，每次启动都
 * 不同，而它是**变宽**的（里面装着随机 id）—— 用它的 `title` 只遮住徽标本身时，
 * 遮罩带的宽度会跟着那个随机串变，两张基线照样对不上（本轮实测：连续两次跑出
 * 40 像素的差异，且**只在遮罩那一条**）。
 *
 * 所以遮的是**整条页脚**：它是 `flex h-9 shrink-0` 的定高元素，遮罩带因此是定尺
 * 寸的。代价是页脚那三个数（匹配条数 / 分页 / 来源）也不进基线 —— 而这一档的被测
 * 对象本就是**浮层的尺寸**，页脚那几个数字由 `LogPanelFooter` 自己的用例判。
 * 与状态栏的 FPS/时钟同一族：不是被测界面、却逐次在变。
 */
function volatileOverlayChrome(page: Page): Locator {
  /* 页脚是日志滚动区（`.custom-scrollbar`）的**下一个兄弟**：定高、位置由 flex
   * 布局给定 —— 结构关系比给它加一个新钩子稳（不用为 e2e 改生产代码）。 */
  return page.locator('[data-slot="dialog-content"] .custom-scrollbar + div');
}

/** 打开应用日志面板，并把内容钉成确定的那一块（来源切到 0 行的档）。 */
async function openPinnedLogPanel(page: Page): Promise<Locator> {
  /* 清掉加宽偏好：它跨会话记忆，不清的话「默认档」用例可能开在加宽档上。 */
  await page.addInitScript((prefix) => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(prefix)) localStorage.removeItem(key);
    }
  }, WIDE_KEY_PREFIX);

  await page.goto("/workspace");
  await expect(
    page.getByRole("heading", { name: "灵感从这里开始" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /日志面板/ }).first().click();

  const panel = page.locator('[data-slot="dialog-content"]');
  await expect(panel).toBeVisible();

  /* 切来源：面板内的第一颗「全部来源」按钮就是来源选择器。 */
  await panel.locator('button:has-text("全部来源")').first().click();
  await page.getByRole("option", { name: new RegExp(EMPTY_ORIGIN) }).click();
  await settle(page, "暂无匹配的日志");
  return panel;
}

/** 面板本体的宽度（`boundingBox()` 量出来的那个数）。 */
async function widthOf(panel: Locator): Promise<number> {
  const box = await panel.boundingBox();
  if (!box) throw new Error("量不到浮层的位置 —— 它没渲染出来");
  return Math.round(box.width);
}

/** 截图共用选项：遮掉全局 chrome 与浮层内逐次变化的那颗徽标。 */
async function overlayShotMasks(page: Page): Promise<Locator[]> {
  return [...(await unstableChromeMasks(page)), volatileOverlayChrome(page)];
}

test.describe("弹窗 / 浮层尺寸视觉基线", () => {
  test("默认档尺寸基线（应用日志面板）", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const panel = await openPinnedLogPanel(page);

    expect(
      await widthOf(panel),
      "默认档宽度不是 `w-6xl`。若调用处的宽度写法被改回 `max-w-*`，" +
        "它会与基元的 `max-w-[calc(100%-2rem)]` 同族打架、结果由 Tailwind 产序决定" +
        "（ISSUE #720 的静默失效形态，加宽按钮会变得按了没反应）",
    ).toBe(DEFAULT_WIDTH);

    await expect(page).toHaveScreenshot("overlay-log-default.png", {
      fullPage: false,
      mask: await overlayShotMasks(page),
    });
  });

  test("加宽档尺寸基线（加宽按钮真的改变了宽度）", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const panel = await openPinnedLogPanel(page);

    await page.getByRole("button", { name: "加宽" }).first().click();
    /* 宽度是过渡出来的，等它落定再量 —— 量过渡中间值会得到一个「既不是默认档
     * 也不是加宽档」的第三个数，那种读数不可复现。 */
    await expect
      .poll(() => widthOf(panel), {
        message:
          "加宽档没有变宽 —— 这正是 ISSUE #720 的形态（按钮态变了、面板没动）",
      })
      .toBeGreaterThanOrEqual(WIDE_MIN_WIDTH);

    await expect(page).toHaveScreenshot("overlay-log-wide.png", {
      fullPage: false,
      mask: await overlayShotMasks(page),
    });
  });
});
