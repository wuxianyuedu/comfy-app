import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 页面级像素基线的公共前置（§11.8）。
 *
 * 「页面级视觉」这一档归 Playwright；组件级形态归 Storybook
 * （两组分工与「不互相替代」的口径见规范 11 §11.8 / `docs/guide-storybook.md`）。
 * 每份 `*.visual.spec.ts` 都逃不掉同样三件事，所以收在这里 —— 三份 spec 各抄一遍
 * 就是 §12.12 的孪生对，而它们必然会在「加了一个新 chrome」时漂。
 */

/**
 * 与被测界面无关、却会逐帧变化的全局 chrome。
 *
 * 根布局给每个页面挂着全局 `BrowserStatusBar`（含**实时帧率与系统时钟**），
 * Next 的 dev 指示器也在左下角 —— 两者都不是被测界面却逐帧在变，
 * 桌面端 fullPage 因此永远取不到两张稳定截图（`Failed to take two consecutive
 * stable screenshots`）。像素层守的是布局 / 配色 / 尺寸，不是时钟读数。
 *
 * ⚠️ **dev 指示器这条按存在与否决定，但它其实遮不住**：角标挂在 `nextjs-portal`
 * 的 shadow root 里、宿主元素不占位（`boundingBox()` 实测 0×0），而 Playwright 的
 * mask 按 bounding box 画。所以屏掉 dev chrome 目前靠**不在 dev 口径下录基线**，
 * 不是靠这条；留着它是为了树状对齐（将来它能被遮住时不必再改）与「dev 口径下少
 * 一条 mask 报错」。详见规范 11 §11.8。
 */
export async function unstableChromeMasks(page: Page): Promise<Locator[]> {
  const masks = [page.locator('[aria-label="底部状态栏"]')];
  const devIndicator = page.locator("nextjs-portal");
  if ((await devIndicator.count()) > 0) masks.push(devIndicator);
  return masks;
}

/** 主题档：默认是 `dark`（`ThemeProvider` 的 `defaultTheme`），显式切要落 localStorage。 */
export const THEME_STORAGE_KEY = "theme";

/**
 * 在**首帧之前**把主题偏好写进 localStorage。
 *
 * 为什么不用 `document.documentElement.classList.add("dark")`：那是绕过
 * `next-themes` 直接改 DOM，水合时会被 Provider 的偏好覆盖，而且它只表达得出
 * 「暗」——浅色档（`light`）根本写不出来。写入 `theme` 键走的是用户真会走的那条路
 * （`ThemeProvider` 的 `storageKey` 就是它），两档都能表达。
 *
 * 必须在 `goto` 之前调（`addInitScript` 在每次导航前执行）。
 */
export async function setTheme(
  page: Page,
  theme: "light" | "dark",
): Promise<void> {
  await page.addInitScript(
    ([k, v]) => localStorage.setItem(k, v),
    [THEME_STORAGE_KEY, theme] as const,
  );
}

/**
 * 等页面「静下来」再截图：关键文案可见 + 字体就绪。
 *
 * 两件都要。只等文案：字体还在换，字形像素会漂；只等字体：内容可能还没挂上。
 * 视觉用例的 flake 大半出在「截图那一刻页面还在变」。
 */
export async function settle(page: Page, readyText: string): Promise<void> {
  await expect(page.getByText(readyText).first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

/**
 * 清掉 `canvas-store` 的项目索引（localStorage）。
 *
 * 首页「最近项目」区渲染**空态占位卡**还是**真项目卡**，取决于这份索引 ——
 * 而它按浏览器上下文隔离、还可能被服务端对账（`hydrateFromServer`）改写。
 * 同一次上下文里跑过别的用例就会带上项目，于是基线随「上下文里有没有项目」变。
 *
 * 按**前缀**清而不是写死键名：`INDEX_KEY = "comfyapp.canvas.projects.v1"` 里的
 * `v1` 正是会随数据结构升级而漂的那一段，写死它等于给基线埋一颗定时炸弹
 * （版本号一升，清理静默失效、基线开始随上下文变，而没人知道为什么）。
 */
export async function clearProjectIndex(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("comfyapp.canvas.")) localStorage.removeItem(key);
    }
  });
}
