import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * 首页在浏览器与 Tauri 桌面壳里的**顶部几何**（ISSUE #3807 摆位、#4770 退役页签）。
 *
 * 壳把标题行（`TitleBar`：拖拽区 + 窗口按钮）画在**内容列顶部**，侧栏不让位；
 * 顶部页签栏已退役 —— 已打开的页签改在侧栏「临时页签」组列出（ISSUE #4770），
 * 标题行上不再有 `role="tab"` 的页签。浏览器 / dev 没有这条 chrome，内容列直接
 * 从 TopBar 起。
 *
 * 这里量的是**几何**不是像素截图：两形态在同一个浏览器里各开一个 context，
 * 壳态靠 `__TAURI_INTERNALS__` 摆形态（与 `overlay-boundary.spec.ts` 同一手法）。
 * 判据刻意不写死 36 / 37 这类高度数字，只判「同位、同宽、内容起点一致」。
 */
const VIEWPORT = { width: 1440, height: 900 };

async function openWorkspace(browser: Browser, inShell: boolean): Promise<Page> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  if (inShell) {
    await context.addInitScript(() => {
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        configurable: true,
        value: { invoke: () => null, transformCallback: () => 0 },
      });
    });
  }
  const page = await context.newPage();
  await page.goto("/workspace", { waitUntil: "load" });
  /* 壳标题行是水合后按 `isDesktopShell()` 才挂上的，等它真到位再量。 */
  if (inShell) {
    await expect(page.locator('[data-slot="title-bar"]')).toBeVisible();
  } else {
    await expect(page.locator("header")).toBeVisible();
  }
  /* 侧栏容器也要等到真挂上（ISSUE #4946）：标题行先可见 ≠ 整个壳树都已就位，
   * 立刻量几何会读到「侧栏还不存在」的中间态（本地实测 sidebar.top = undefined）。 */
  await expect(page.locator('[data-slot="sidebar-container"]')).toBeVisible();
  return page;
}

type Rect = { height: number; left: number; top: number; width: number };

async function geometry(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string): Rect | null => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        height: Math.round(r.height),
        left: Math.round(r.left),
        top: Math.round(r.top),
        width: Math.round(r.width),
      };
    };
    return {
      shellMark: document.querySelector("[data-shell]") !== null,
      sidebar: rect('[data-slot="sidebar-container"]'),
      inset: rect('[data-slot="sidebar-inset"]'),
      titleBar: rect('[data-slot="title-bar"]'),
      topBar: rect("header"),
      home: rect('[data-view="home"]'),
    };
  });
}

test.describe("两形态顶部几何 @critical", () => {
  test("浏览器与 Tauri 壳：侧栏、内容列都从 y=0 起；标题行只在壳态、贴内容列（ISSUE #3807/#4770）", async ({
    browser,
  }) => {
    const browserPage = await openWorkspace(browser, false);
    const shellPage = await openWorkspace(browser, true);
    try {
      const web = await geometry(browserPage);
      const shell = await geometry(shellPage);

      /* ① 侧栏贴顶：这一格收口前壳态是 36px（[data-shell] 让位）。 */
      expect(web.sidebar?.top, "浏览器态侧栏应贴视口顶").toBe(0);
      expect(shell.sidebar?.top, "壳态侧栏不该再为标题行让位").toBe(0);
      expect(shell.inset?.top, "壳态内容列应贴视口顶").toBe(0);
      expect(shell.shellMark, "主窗口不该再打 data-shell").toBe(false);

      /* ② 标题行只在壳态：贴内容列顶（top=0、左缘 = 侧栏右缘），且**没有页签**
         —— 页签栏已退役到侧栏「临时页签」组（ISSUE #4770）。 */
      expect(web.titleBar).toBeNull();
      expect(shell.titleBar).not.toBeNull();
      expect(shell.titleBar?.top).toBe(0);
      expect(shell.titleBar?.left, "标题行左缘应等于内容列左缘（侧栏右缘）").toBe(
        shell.inset?.left,
      );
      expect(shell.titleBar?.width, "标题行宽度应等于内容列").toBe(shell.inset?.width);
      expect(
        await shellPage.locator('[data-slot="title-bar"] [role="tab"]').count(),
        "标题行上不应再有页签",
      ).toBe(0);

      /* ③ 首页内容起点：两形态都从「标题行（壳态才有）+ TopBar」之后开始，
         差值应恰好是一条标题行的高度，不允许再长出别的层。 */
      expect(web.home).not.toBeNull();
      expect(shell.home).not.toBeNull();
      expect((shell.home?.top ?? 0) - (web.home?.top ?? 0)).toBe(shell.titleBar?.height ?? 0);

      /* ④ 窗口功能没被「退役」掉：无边框窗口的三颗按钮仍在标题行上。 */
      expect(
        await shellPage.locator('[data-slot="title-bar"] button[data-no-drag]').count(),
      ).toBeGreaterThanOrEqual(3);
    } finally {
      await browserPage.context().close();
      await shellPage.context().close();
    }
  });

  test("侧栏折叠成图标轨时，壳态标题行的左缘跟着收窄（不留在 160px）", async ({ browser }) => {
    const shellPage = await openWorkspace(browser, true);
    try {
      const expanded = (await geometry(shellPage)).titleBar?.left ?? 0;
      await shellPage.setViewportSize({ width: 1100, height: 800 });
      await expect(shellPage.locator('[data-slot="sidebar"]')).toHaveAttribute(
        "data-state",
        "collapsed",
      );
      /* 侧栏宽度走 200ms transition（ISSUE #4946）：`data-state` 翻转 ≠ 几何到位，
       * 立刻量会读到展开态的 160（CI 实测恰好 160）。等左缘真的收进去再断言
       * —— 等动画收敛，不是抬断言超时。 */
      await expect
        .poll(async () => (await geometry(shellPage)).titleBar?.left ?? 999, { timeout: 5000 })
        .toBeLessThan(160);
      const collapsed = (await geometry(shellPage)).titleBar?.left ?? 0;
      expect(collapsed, "折叠后标题行仍钉在展开态的左缘 = 又退回按整窗算偏移").toBeLessThan(
        expanded,
      );
      expect(collapsed).toBeLessThan(160);
    } finally {
      await shellPage.context().close();
    }
  });
});
