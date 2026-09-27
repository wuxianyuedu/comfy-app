import { expect, test, type Page } from "@playwright/test";

/**
 * 主题 token 的**产物侧**判据（规范 03 §3.6.1.1 的配套，非提交前必跑层）。
 *
 * 为什么静态判据不够：门禁「幽灵 token / 拼接 token 名」查的是 CSS **源码**里有没有
 * 声明、引用是不是字面量；而 Tailwind v4 会按「源码里出现过字面名」决定哪些 `@theme`
 * 变量**真的进产物**。声明在源码里 ≠ 运行时解析得到 —— 中间隔着 tree-shake 与
 * Next 的 `@source` 根。只有真浏览器 + 真构建管线能给出结论。
 *
 * 为什么在 e2e 层：这里断言的四件事全部依赖「算出来的样式」，jsdom 不做级联计算
 * （`getComputedStyle().getPropertyValue('--x')` 在 jsdom 里恒为空、`fill` 也不会
 * 从呈现属性解析成 `rgb()`），vitest 侧无法复现。而 e2e 本来就要起一次应用，
 * 这条用例的增量成本只是一个 goto。
 *
 * 用例本身带**负控制**：一个不存在的 token 必须读到空、且 `fill` 退成
 * `rgb(0, 0, 0)` / `stroke` 退成 `none` —— 这正是规范里写的静默失效形态。
 * 少了这半条，「十颗都读到值」可以是一次全绿的假探针。
 */

/** 全仓「被 SVG 呈现属性或 JS 取色读走」的 token（字面名在源码里出现，静态判据已保证）。 */
const CONSUMED_TOKENS = [
  "--color-seed-fixed",
  "--color-seed-step",
  "--color-seed-dice-bg",
  "--color-seed-dice-stroke",
  "--color-seed-dice-pip",
  "--color-aurora-violet",
  "--color-aurora-cyan",
  "--color-aurora-magenta",
  "--color-node-mix-base",
  "--color-note-tint-base",
];

/** 图标类 token → 它实际托在哪个表面类上（对比度按这一对算）。 */
const CONTRAST_PAIRS = [
  { token: "--color-seed-fixed", surfaceClass: "bg-node-accent" },
  { token: "--color-seed-step", surfaceClass: "bg-node-accent" },
];

/** WCAG 1.4.11「非文本对比度」：图形对象要 ≥3:1。 */
const MIN_GRAPHICAL_RATIO = 3;

async function setTheme(page: Page, dark: boolean): Promise<void> {
  await page.evaluate((d) => {
    document.documentElement.classList.toggle("dark", d);
  }, dark);
}

/** 读 token 的声明值，以及它挂到真实 SVG 呈现属性上解析出的 fill / stroke。 */
async function readToken(
  page: Page,
  name: string,
): Promise<{ raw: string; fill: string; stroke: string }> {
  return page.evaluate((n) => {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue(n)
      .trim();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", `var(${n})`);
    path.setAttribute("stroke", `var(${n})`);
    svg.appendChild(path);
    document.body.appendChild(svg);
    const cs = getComputedStyle(path);
    const out = { raw, fill: cs.fill, stroke: cs.stroke };
    svg.remove();
    return out;
  }, name);
}

/** 读一个表面类实际解析出的背景色（对比度的另一侧）。 */
async function readSurface(page: Page, cls: string): Promise<string> {
  return page.evaluate((c) => {
    const el = document.createElement("div");
    el.className = c;
    document.body.appendChild(el);
    const bg = getComputedStyle(el).backgroundColor;
    el.remove();
    return bg;
  }, cls);
}

function relativeLuminance(css: string): number {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(css);
  if (!m) throw new Error(`解析不出颜色：${css}`);
  const lin = [m[1], m[2], m[3]]
    .map((part) => Number(part) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return (
    0.2126 * (lin[0] ?? 0) + 0.7152 * (lin[1] ?? 0) + 0.0722 * (lin[2] ?? 0)
  );
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

test.describe("主题 token 在真产物里可解析（§3.6.1.1 产物侧）", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
  });

  test("两态下 CONSUMED_TOKENS 全部解析得到具体颜色", async ({ page }) => {
    for (const dark of [false, true]) {
      await setTheme(page, dark);
      const label = dark ? "暗色" : "浅色";
      const bad: string[] = [];
      for (const name of CONSUMED_TOKENS) {
        const v = await readToken(page, name);
        if (!v.raw)
          bad.push(`${label} ${name} 声明值为空（被 shake 或名字不对）`);
        if (!v.fill.startsWith("rgb"))
          bad.push(`${label} ${name} fill 未解析：${v.fill}`);
      }
      expect(bad, `${label}档有 token 解析失败`).toEqual([]);
    }
  });

  test("负控制：不存在的 token 必须读到空，且 fill 退黑 / stroke 退 none", async ({
    page,
  }) => {
    const nope = await readToken(page, "--color-nope-token");
    expect(nope.raw, "探针失效：不存在的名字竟读到了值").toBe("");
    expect(nope.fill).toBe("rgb(0, 0, 0)");
    expect(nope.stroke).toBe("none");
  });

  test("图标 token 对它实际所托的表面 ≥3:1（两态各自验）", async ({ page }) => {
    const lines: string[] = [];
    for (const dark of [false, true]) {
      await setTheme(page, dark);
      const label = dark ? "暗色" : "浅色";
      for (const { token, surfaceClass } of CONTRAST_PAIRS) {
        const fg = await readToken(page, token);
        const surface = await readSurface(page, surfaceClass);
        const ratio = contrastRatio(fg.fill, surface);
        lines.push(
          `${label} ${token} ${fg.raw} on ${surfaceClass}(${surface}) → ${ratio.toFixed(2)}:1`,
        );
        expect(
          ratio,
          `${label}档 ${token} 在它托着的 ${surfaceClass} 上只有 ${ratio.toFixed(2)}:1，` +
            "低于 WCAG 1.4.11 的 3:1（图形对象）。这正是「深色档值照抄到浅色」那一类。",
        ).toBeGreaterThanOrEqual(MIN_GRAPHICAL_RATIO);
      }
    }
    console.log(`[对比度] ${lines.join("\n         ")}`);
  });

  test("两档不是空话：同一颗 token 在两态下取值必须不同", async ({ page }) => {
    for (const { token } of CONTRAST_PAIRS) {
      await setTheme(page, false);
      const lightValue = (await readToken(page, token)).raw;
      await setTheme(page, true);
      const darkValue = (await readToken(page, token)).raw;
      expect(
        lightValue !== darkValue,
        `${token} 两态同值（${lightValue}）—— 那「做成两档」是空的，` +
          "浅色下看不清的问题并没有被解决",
      ).toBe(true);
    }
  });
});
