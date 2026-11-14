import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * 首页在浏览器与 Tauri 桌面壳里**同一套顶部几何**（ISSUE #3807）。
 *
 * 症状原话：「浏览器中打开 首页是顶到窗口最上端的，而 tauri 壳打开的就不是」。
 * 收口前壳把 `TitleBarTabs` 画成整窗 flex 流的第一行（36px 全宽），内容区被推下
 * 36px，`[data-shell]` 又把 fixed 侧栏一并下移；浏览器态两处都没有，于是贴顶。
 * 现在标题行落在内容列顶部（与 `ViewTabStrip` 同位同款），侧栏不再让位。
 *
 * 这里量的是**几何**不是像素截图：两形态在同一个浏览器里各开一个 context，
 * 壳态靠 `__TAURI_INTERNALS__` 摆形态（与 `overlay-boundary.spec.ts` 同一手法）。
 * 判据刻意不写死 36 / 37 这类高度数字，只判「同位、同宽、同色、内容起点一致」。
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
    const strip =
      rect('[data-slot="title-bar"]') ?? rect('[data-component="workspace-view-tabstrip"]');
    const stripEl =
      document.querySelector('[data-slot="title-bar"]') ??
      document.querySelector('[data-component="workspace-view-tabstrip"]');
    return {
      shellMark: document.querySelector("[data-shell]") !== null,
      sidebar: rect('[data-slot="sidebar-container"]'),
      inset: rect('[data-slot="sidebar-inset"]'),
      strip,
      /* 同款背景是「统一用浏览器样式」的一半：不只是位置对齐，那条横条也不能
         再是标题行专属的 `bg-panel`（比画布亮一截，看着就是多出来的一条）。 */
      stripBg: stripEl ? getComputedStyle(stripEl).backgroundColor : null,
      topBar: rect("header"),
      home: rect('[data-view="home"]'),
    };
  });
}

test.describe("两形态顶部对齐 @critical", () => {
  test("浏览器与 Tauri 壳：侧栏、内容列、顶部条都从 y=0 起，首页起点一致（ISSUE #3807）", async ({
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

      /* ② 顶部那条同位同宽：浏览器是 ViewTabStrip、壳是 TitleBarTabs，
         两者都只在内容列（侧栏右缘）这一侧，不再有整窗宽的第一行。 */
      expect(web.strip).not.toBeNull();
      expect(shell.strip).not.toBeNull();
      expect(shell.strip?.top).toBe(0);
      expect(shell.strip?.left, "顶部条左缘应跟着内容列").toBe(web.strip?.left);
      expect(shell.strip?.width, "顶部条宽度应等于内容列").toBe(web.strip?.width);
      expect(shell.stripBg, "顶部条背景应与浏览器页签条同款").toBe(web.stripBg);

      /* ③ 首页内容起点：37+48=85（浏览器）/ 36+48=84（壳），1px 是两条横条
         各自的自然高度差，不允许再长出一条 36px 的标题行。 */
      expect(web.home).not.toBeNull();
      expect(shell.home).not.toBeNull();
      expect(Math.abs((shell.home?.top ?? 0) - (web.home?.top ?? 0))).toBeLessThanOrEqual(2);

      /* ④ 窗口功能没被「统一」掉：无边框窗口的三颗按钮仍在标题行上。 */
      expect(
        await shellPage.locator('[data-slot="title-bar"] button[data-no-drag]').count(),
      ).toBeGreaterThanOrEqual(3);
    } finally {
      await browserPage.context().close();
      await shellPage.context().close();
    }
  });

  test("侧栏折叠成图标轨时，壳态顶部条的左缘跟着收窄（不留在 160px）", async ({ browser }) => {
    const shellPage = await openWorkspace(browser, true);
    try {
      const expanded = (await geometry(shellPage)).strip?.left ?? 0;
      await shellPage.setViewportSize({ width: 1100, height: 800 });
      await expect(shellPage.locator('[data-slot="sidebar"]')).toHaveAttribute(
        "data-state",
        "collapsed",
      );
      const collapsed = (await geometry(shellPage)).strip?.left ?? 0;
      expect(collapsed, "折叠后顶部条仍钉在展开态的左缘 = 又退回按整窗算偏移").toBeLessThan(
        expanded,
      );
      expect(collapsed).toBeLessThan(160);
    } finally {
      await shellPage.context().close();
    }
  });
});
