import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * 工坊顶栏「分段健康度条」的浏览器级断言：jsdom 无布局与样式级联，只能验类名，验不了两件事 ——
 * `bg-success` / `bg-primary` 真解析成具体颜色（非 transparent / 未声明 token）、两字段名在几十像素窄格真不溢出；不写像素基线（仅 `-linux` 一套，换机即无基线，§11.8）。
 * 空上下文 = 空草稿，不断言具体段色，只断言与自身数值一致的档位（`aria-valuenow` 100 → 成功档，否则品牌档）；选档逻辑由 `WorkshopHeader.health.test.tsx` 锁。
 */

/** 一条段的屏面事实：可访问名（全名）、可见名（缩略）、数值、填充解析出的颜色。 */
type SegmentOnScreen = {
  barWidth: number;
  fill: string;
  labelOverflow: boolean;
  name: string | null;
  value: number | null;
  visible: string;
};

async function readSegments(barRoots: Locator): Promise<Array<SegmentOnScreen>> {
  return await barRoots.evaluateAll((nodes) =>
    nodes.map((node) => {
      /* SAFETY: 类型断言已复核 */
      const root = node as HTMLElement;
      const label = root.querySelector("span");
      const fill = root.querySelector<HTMLElement>('[data-slot="progress-bar-fill"]');
      const raw = root.getAttribute("aria-valuenow");
      return {
        name: root.getAttribute("aria-label"),
        visible: label?.textContent ?? "",
        value: raw === null ? null : Number(raw),
        fill: fill === null ? "" : getComputedStyle(fill).backgroundColor,
        // 溢出 = 可见文字实际占宽超过容器可给宽（缩略要解决的就是这个）
        labelOverflow: label !== null && label.scrollWidth > label.clientWidth + 1,
        barWidth: Math.round(root.getBoundingClientRect().width),
      };
    }),
  );
}

/** 取一个类在当前主题下解析到的颜色：用一个离屏探针，不猜硬编码值。 */
async function resolveColorOf(
  page: Page,
  className: string,
): Promise<{ color: string; ok: boolean }> {
  return await page.evaluate((cls) => {
    const probe = document.createElement("div");
    probe.className = cls;
    probe.style.position = "fixed";
    probe.style.left = "-9999px";
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    // 未声明 / 拼错的 token 会以「继承来的透明」出现，那是这处要拦的形态
    const transparent = /rgba?\([^)]*[\s,]0\s*\)$/.test(color);
    return {
      color,
      ok: color !== "" && !transparent && color !== "transparent",
    };
  }, className);
}

test.describe("工坊顶栏分段健康度条 @critical", () => {
  test("六段一根条：全名给读屏、缩略给眼睛，且两档色都解析得到具体颜色", async ({ page }) => {
    await page.goto("/workshop", { waitUntil: "domcontentloaded" });

    const group = page.getByRole("group", { name: "工坊流程健康度" });
    await expect(group).toBeVisible();

    const bars = group.getByRole("progressbar");
    await expect(bars).toHaveCount(6);

    const segments = await readSegments(bars);
    for (const segment of segments) {
      // 每段有名字（不是六根匿名条），且格子里真的画出了宽度
      expect(segment.name, "分段条每段都要有可访问名").toBeTruthy();
      expect(segment.barWidth).toBeGreaterThan(0);
      // 屏面上必须是短名：空串会让下面那条 includes 白过，上限就是两字
      expect(segment.visible.length).toBeGreaterThan(0);
      expect(segment.visible.length).toBeLessThanOrEqual(2);
      // 缩略只从全名里取 —— 写错成另起一名，这条会红
      expect(segment.name?.includes(segment.visible)).toBe(true);
      // 窄槽位放得下：可见段名不许溢出自己的盒子
      expect(segment.labelOverflow, `段名溢出：${segment.visible}`).toBe(false);
    }

    // 两档各自解析成具体颜色（token 没声明 / 拼错时这里就退成透明）
    const success = await resolveColorOf(page, "bg-success");
    const primary = await resolveColorOf(page, "bg-primary");
    expect(success.ok, `成功档未解析到颜色：${success.color}`).toBe(true);
    expect(primary.ok, `品牌档未解析到颜色：${primary.color}`).toBe(true);

    // 色档与**自己那一段的数值**一致，而不是与某个写死的段序号一致
    for (const segment of segments) {
      const expected = segment.value === 100 ? success.color : primary.color;
      expect(
        segment.fill,
        `段「${segment.name}」数值 ${segment.value} 应画成 ${expected}，实际 ${segment.fill}`,
      ).toBe(expected);
    }
  });

  test("分段条只在够宽的窗口出现；窄下来仍有文字表述", async ({ browser }) => {
    // 低于 lg：整条隐藏。此时屏面上必须还剩「差哪几段」这句话，
    // 否则进度信息就只剩一个数字，颜色之外的路径断了。
    const ctx = await browser.newContext({
      viewport: { width: 900, height: 800 },
    });
    const page = await ctx.newPage();
    await page.goto("/workshop", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("group", { name: "工坊流程健康度" })).toBeHidden();
    await expect(page.getByText(/还差 \d+ 段：|流程已完成/).first()).toBeVisible();
    await ctx.close();
  });
});
