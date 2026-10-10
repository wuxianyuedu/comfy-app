import { expect, test } from "@playwright/test";

import {
  clearProjectIndex,
  freezeComfyStats,
  freezeModelOverview,
  hideDevChrome,
  watchRecordingInputs,
  setTheme,
  settle,
  unstableChromeMasks,
} from "./support/page-baseline";

/**
 * 首页（`/workspace`）像素基线 —— 应用主界面（§11.8）。
 *
 * 它是用户进应用看到的第一屏，承载侧栏 / 顶栏 / 视图页签 / 首页卡片栅格 /
 * 「最近项目」数块，是**布局与配色退化最贵**的一页：这里塌了，用户第一眼就知道。
 *
 * 两档主题都录：卡片层级（`bg-surface` / `border-subtle` / 阴影）与空态文案在各档
 * 下取的是不同 token，只录一档等于把另一档的退化敞着。
 *
 * ⚠️ **钉的是「无项目」的形态**，而「最近项目」区渲染空态占位卡还是真项目卡，
 * 取决于 `canvas-store`（localStorage + 服务端对账 hydration）：同一次浏览器上下文
 * 里跑过别的用例就会带上项目。所以进页面前**显式清掉项目索引**，否则基线会随
 * 「这次上下文里有没有项目」变 —— 那不是像素退化，是基线不成立。
 *
 * ⚠️ **同样钉死的还有「后端不在」**：「本机算力」卡的显存 / 内存数字来自
 * `/api/comfy/stats`（服务端代理 ComfyUI `/system_stats`），而 8188 上是不是真
 * ComfyUI 取决于**这台机器当时在不在跑图**（`reuseExistingServer` 只看有没有人应答）。
 * 不钉它，这张 PNG 记的是「录基线那台机器的实时资源占用」，换个人跑就红。
 *
 * ⚠️ **第三样：模型概览卡的目录计数**（`freezeModelOverview`）。它的判据
 * `model.configList` 读本机 ComfyUI 的 `models` 目录，于是「列几类、各有几个」
 * 以及那句「另有 N 个目录为空」的 `N` 都随机器变。不钉的后果实测过两次：一台装过
 * 模型的开发机与一个什么都没有的容器录出两张不同的卡；以及**录到骨架态**
 * （`useModelOverview` 的 `isLoading`，三行 `Skeleton`）—— 骨架与空态**卡高不同**，
 * 首页自那一行往下整段位移，而这次截图取到哪一态取决于那一拍请求回来了没有
 * （#1593 实测「录完立刻串行复跑仍差 4652 像素」，差异区间
 * `bbox=(407,480)-(1289,876)` 正对这一段）。
 *
 * 三件同性质：都是「基线成立的前提」，不是「被测界面的一种状态」。
 *
 * **不在这一档、但也被清点过的两条**（免得下一个人重复怀疑）：
 *   · `project.list` 的 `hydrateFromServer()` **只由 `ProjectCanvas` 挂载时调用**，
 *     首页不调 —— 所以「最近项目」只读 localStorage，`clearProjectIndex` 就够了；
 *   · 底部状态栏那一格 `schema` 同步状态会随容器里有没有建表变，但它整条被
 *     `unstableChromeMasks` 遮着，不进像素。
 */

const READY_TEXT = "灵感从这里开始";

test.describe("首页视觉基线", () => {
  test("暗色档（默认外观）全页基线", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setTheme(page, "dark");
    await clearProjectIndex(page);
    await watchRecordingInputs(page);
    await hideDevChrome(page);
    await freezeComfyStats(page);
    await freezeModelOverview(page);
    await page.goto("/workspace");
    await settle(page, READY_TEXT);
    await expect(page).toHaveScreenshot("workspace-desktop-dark.png", {
      fullPage: true,
      mask: await unstableChromeMasks(page),
    });
  });

  test("浅色档全页基线（深浅两态对比）", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setTheme(page, "light");
    await clearProjectIndex(page);
    await watchRecordingInputs(page);
    await hideDevChrome(page);
    await freezeComfyStats(page);
    await freezeModelOverview(page);
    await page.goto("/workspace");
    await settle(page, READY_TEXT);
    await expect(page).toHaveScreenshot("workspace-desktop-light.png", {
      fullPage: true,
      mask: await unstableChromeMasks(page),
    });
  });
});
