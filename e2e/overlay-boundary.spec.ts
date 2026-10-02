import { expect, test, type Page } from "@playwright/test";

/**
 * 锚定浮层不许被应用级标题行吃掉（ISSUE #1377）。
 *
 * 现场：桌面壳里窗口顶部是自绘的标题行（`TitleBarTabs`，页签 + 拖拽区 + 窗口
 * 按钮），它按 `z-chrome`(2000) 立在最上。TopBar 那排按钮落在 y≈46，气泡默认
 * 往上摆（`side="top"`）时顶部落在 y≈14 —— **视口内绰绰有余**，于是 Base UI 的
 * `flip` 不翻转；而气泡是 `z-popup`(100)，比标题行低一个数量级，于是它的上半截
 * **被标题行盖掉**（画在它下面，不是被裁）。用户看到的是「一条白边 + 一个朝下的
 * 箭头，文字全没了」。实测 TopBar 上四个入口（搜索 / 深浅色 / 消息 / 菜单）全中招。
 *
 * 这里钉的是**结果**：壳态下把 TopBar 每个入口悬停一遍，气泡的几何必须整体
 * 落在标题行下沿之下、并且命中测试真的打到气泡自己（没被任何东西盖住）。
 *
 * 为什么不钉 `side`：翻转是定位引擎的输出，写死它会锁住实现；「有没有被盖住」
 * 才是用户看到的那件事。
 *
 * ⚠️ 壳态是**打 `__TAURI_INTERNALS__` 全局标记**造出来的 —— 它就是
 * `isDesktopShell()` 读的那个键，于是 `ShellTabs` 会真的渲染 `TitleBarTabs`、
 * `data-shell` 与侧栏让位一起生效（比手改 DOM 忠实：手改会在水合前动 DOM，
 * React 直接报 #418 并丢掉客户端树）。
 */
async function openInShell(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: { invoke: async () => null, transformCallback: () => 0 },
    });
  });
  await page.goto("/workspace", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-slot="sidebar-trigger"]');
  /* 标题行确实在（它是本用例的让位对象；不在就没得验）。 */
  await expect(page.locator('[data-slot="title-bar"]')).toBeVisible();
}

/** 把鼠标从远处挪进来并停在目标上 —— Base UI 的 hover 要一次指针移动。 */
async function hoverHint(page: Page, label: string) {
  const trigger = page.locator(`header button[aria-label="${label}"]`).first();
  await page.mouse.move(400, 700);
  const box = await trigger.boundingBox();
  if (!box) throw new Error(`量不到「${label}」的位置`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(600);
  await expect(page.locator('[data-slot="tooltip-content"]')).toBeVisible();
}

test.describe("锚定浮层让出窗口标题行 @critical", () => {
  test("TopBar 每个入口的气泡都整体落在标题行之下，且没有被盖住", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openInShell(page);

    const labels = await page.evaluate(() =>
      [...document.querySelectorAll("header button")]
        .map((b) => b.getAttribute("aria-label"))
        .filter((l): l is string => Boolean(l)),
    );
    /* 这一排是对外可见入口，不该是空集 —— 空集会让下面的循环一次都不跑、
     * 用例「绿」得毫无意义。 */
    expect(labels.length).toBeGreaterThan(0);

    for (const label of labels) {
      await hoverHint(page, label);
      const probe = await page.evaluate(() => {
        const popup = document.querySelector('[data-slot="tooltip-content"]');
        if (!popup) return null;
        const r = popup.getBoundingClientRect();
        const titleBar = document.querySelector('[data-slot="title-bar"]');
        const t = titleBar!.getBoundingClientRect();
        /* 气泡几何中心处的最顶层元素：被标题行盖住时会命中标题行。 */
        const hit = document.elementFromPoint(
          (r.left + r.right) / 2,
          (r.top + r.bottom) / 2,
        );
        return {
          top: r.top,
          bottom: r.bottom,
          titleBarBottom: t.bottom,
          hitInsidePopup: hit ? popup === hit || popup.contains(hit) : false,
          hitIsTitleBar: hit ? titleBar!.contains(hit) : false,
          text: popup.textContent ?? "",
        };
      });
      expect(probe, `「${label}」的提示气泡没出来`).not.toBeNull();
      expect(
        probe!.top,
        `「${label}」的气泡伸进了标题行`,
      ).toBeGreaterThanOrEqual(probe!.titleBarBottom);
      expect(probe!.hitInsidePopup, `「${label}」的气泡被标题行盖住了`).toBe(
        true,
      );
      expect(probe!.hitIsTitleBar).toBe(false);
      /* 文案也得在 —— 只剩一条白边正是本 ISSUE 的现场。 */
      expect(probe!.text.trim().length).toBeGreaterThan(0);
    }
  });

  test("窄窗（左轨自动收起）下同样让位 —— 长文案也不往标题行里摆", async ({
    page,
  }) => {
    /* 窄窗会走 `collapsedByAuto` 那条**长文案**分支（「窗口窄于 Npx 时先让位…」），
     * 气泡高度翻倍，正是用户截图里那一条。 */
    await page.setViewportSize({ width: 1100, height: 800 });
    await openInShell(page);
    await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute(
      "data-state",
      "collapsed",
    );

    await hoverHint(page, "切换深浅色");
    const probe = await page.evaluate(() => {
      const popup = document.querySelector('[data-slot="tooltip-content"]');
      const titleBar = document.querySelector('[data-slot="title-bar"]')!;
      const r = popup!.getBoundingClientRect();
      const t = titleBar.getBoundingClientRect();
      const hit = document.elementFromPoint(
        (r.left + r.right) / 2,
        (r.top + r.bottom) / 2,
      );
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
