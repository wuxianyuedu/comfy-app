import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * 锚定浮层不许被应用级标题行吃掉（ISSUE #1377）。桌面壳顶部自绘标题行（`TitleBarTabs`）按 `z-chrome`(2000) 立在最上，而气泡 `z-popup`(100) 低一个数量级：TopBar 按钮落 y≈46、气泡 `side="top"` 顶部 y≈14 仍在视口内，Base UI 的 `flip` 不翻转，于是上半截**被标题行盖掉**（画在它下面，不是被裁），实测四个入口全中招。
 * 这里只钉**结果**：每个入口悬停一遍，气泡几何整体落在标题行下沿之下、且命中测试真的打到气泡自己（不钉 `side`——翻转是定位引擎的输出，写死会锁实现）。
 * ⚠️ 壳态是打 `__TAURI_INTERNALS__` 全局标记（`isDesktopShell()` 读的那个键），`TitleBarTabs` / `data-shell` / 侧栏让位都真的生效；比手改 DOM 忠实（手改会在水合前动 DOM，React 报 #418 并丢客户端树）。
 */
async function openInShell(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: { invoke: () => null, transformCallback: () => 0 },
    });
  });
  await page.goto("/workspace", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-slot="sidebar-trigger"]');
  /* 标题行确实在（它是本用例的让位对象；不在就没得验）。 */
  await expect(page.locator('[data-slot="title-bar"]')).toBeVisible();
  /* ⚠️ **还要等测点自己到位**：上面两枚锚点在**服务端 HTML 里就有**（`data-shell` 与 `title-bar` 由
   * `useTitleBarTabsActive()` 的 SSR 首帧决定），而顶栏入口是水合后才挂上的；只等前两枚会把「导航回来了」
   * 读成「页面就绪」，并发高时读到半截水合（`header button[aria-label]` 数出 0，下面 `count > 0` 当场红，
   * 实测 8 并发 ~25%~40% 命中、平台 3 次重试全红；自愈只是水合慢）。这条等待是**测点的前提**而非判据：
   * 它不改任何断言取值，只把「还没渲染完」与「渲染出来是空的」分开 —— 后者才是本用例要拦的那件事。 */
  await expect(page.locator("header button[aria-label]").first()).toBeVisible();
}

/** 把鼠标从远处挪进来并停在目标上 —— Base UI 的 hover 要一次指针移动。传 **`Locator` 而不是标签字符串**：
 * 顶栏 `aria-label` 有**动态**的（`MessageCenterButton.tsx:27` 有未读时变「系统消息，N 条未读」），原先
 * 「先抓属性值成字符串再精确重查」在两次动作间只要落一条系统消息就失效，locator 等到 60s 超时（实测红过
 * 两条）。只认**当前打开的那一枚**气泡（`[data-open]`）：上一枚退场动画里以 `data-closed` 仍挂在 DOM，
 * 全局 `[data-slot="tooltip-content"]` 会命中两枚（strict mode violation），探针会拿到上一入口的气泡。 */
async function hoverHint(page: Page, trigger: Locator) {
  await page.mouse.move(400, 700);
  const box = await trigger.boundingBox();
  if (!box) {
    throw new Error("量不到该入口的位置");
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('[data-slot="tooltip-content"][data-open]')).toBeVisible();
}

test.describe("锚定浮层让出窗口标题行 @critical", () => {
  test("TopBar 每个入口的气泡都整体落在标题行之下，且没有被盖住", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openInShell(page);

    /* 遍历**活的 locator**，不先把 `aria-label` 抓成字符串（那串值会变，见 hoverHint）。 */
    const triggers = page.locator("header button[aria-label]");
    const count = await triggers.count();
    /* 这一排是对外可见入口，不该是空集 —— 空集会让下面的循环一次都不跑、
     * 用例「绿」得毫无意义。 */
    expect(count, "顶栏没数到任何带 aria-label 的入口").toBeGreaterThan(0);

    for (let i = 0; i < count; i += 1) {
      const trigger = triggers.nth(i);
      /* 标签逐轮重新读一次，只用于失败话术；判据本身不依赖它。 */
      // oxlint-disable-next-line no-await-in-loop -- e2e 按轮次串行取元素/断言，并行会让失败归因与截图错位
      const label = (await trigger.getAttribute("aria-label")) ?? `第 ${i + 1} 个入口`;
      // oxlint-disable-next-line no-await-in-loop -- e2e 按轮次串行取元素/断言，并行会让失败归因与截图错位
      await hoverHint(page, trigger);
      // oxlint-disable-next-line no-await-in-loop -- e2e 按轮次串行取元素/断言，并行会让失败归因与截图错位
      const probe = await page.evaluate(() => {
        /* 只认当前打开的那一枚（`[data-open]`）——上一枚退场时仍挂在 DOM 里。 */
        const popup = document.querySelector('[data-slot="tooltip-content"][data-open]');
        if (!popup) {
          return null;
        }
        const r = popup.getBoundingClientRect();
        const titleBar = document.querySelector('[data-slot="title-bar"]');
        const t = titleBar!.getBoundingClientRect();
        /* 气泡几何中心处的最顶层元素：被标题行盖住时会命中标题行。 */
        const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
        return {
          top: r.top,
          bottom: r.bottom,
          titleBarBottom: t.bottom,
          hitInsidePopup: hit ? popup === hit || popup.contains(hit) : false,
          hitIsTitleBar: hit ? titleBar!.contains(hit) : false,
          // oxlint-disable-next-line typescript/no-unnecessary-condition -- Playwright evaluate 里的 DOM 节点 textContent 运行期可为 null（lib.dom 声明 string|null），规则未建模，保留兜底
          text: popup.textContent ?? "",
        };
      });
      expect(probe, `「${label}」的提示气泡没出来`).not.toBeNull();
      expect(probe!.top, `「${label}」的气泡伸进了标题行`).toBeGreaterThanOrEqual(
        probe!.titleBarBottom,
      );
      expect(probe!.hitInsidePopup, `「${label}」的气泡被标题行盖住了`).toBe(true);
      expect(probe!.hitIsTitleBar).toBe(false);
      /* 文案也得在 —— 只剩一条白边正是本 ISSUE 的现场。 */
      expect(probe!.text.trim().length).toBeGreaterThan(0);
    }
  });

  test("窄窗（左轨自动收起）下同样让位 —— 长文案也不往标题行里摆", async ({ page }) => {
    /* 窄窗会走 `collapsedByAuto` 那条**长文案**分支（「窗口窄于 Npx 时先让位…」），
     * 气泡高度翻倍，正是用户截图里那一条。 */
    await page.setViewportSize({ width: 1100, height: 800 });
    await openInShell(page);
    await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute("data-state", "collapsed");

    await hoverHint(page, page.locator('header button[aria-label="切换深浅色"]').first());
    const probe = await page.evaluate(() => {
      const popup = document.querySelector('[data-slot="tooltip-content"][data-open]');
      const titleBar = document.querySelector('[data-slot="title-bar"]')!;
      const r = popup!.getBoundingClientRect();
      const t = titleBar.getBoundingClientRect();
      const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      return {
        top: r.top,
        titleBarBottom: t.bottom,
        hitInsidePopup: hit ? popup === hit || popup!.contains(hit) : false,
        height: r.height,
      };
    });
    expect(probe.top).toBeGreaterThanOrEqual(probe.titleBarBottom);
    expect(probe.hitInsidePopup).toBe(true);
  });
});
