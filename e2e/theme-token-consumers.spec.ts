import { expect, test, type Page } from "@playwright/test";

import { gridLineColor } from "../src/components/studio/canvas/workflow-canvas-grid";

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
  "--color-canvas-grid-line",
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

/**
 * 计算出来的颜色有三种可能的序列化形态，必须都认：
 *  · `#rrggbb` —— `globals.css` 里的原始声明；
 *  · `rgb()` / `rgba()` —— 普通 `var()` 解析到 `stroke` / `fill` 上；
 *  · **`color(srgb 0 0 0 / 0.14)`** —— `color-mix(in srgb, …)` 的计算值，
 *    Chromium 保留 sRGB 色彩空间来序列化它，分量是 **0~1 的浮点**而不是 0~255。
 * 最后一型是实测撞出来的：拿 `/^rgba?\(/` 去断 `color-mix()` 的结果，
 * 会得到一条「没解析」的红 —— 而值其实是对的。所以断言比**分量**，不比字符串。
 */
type Color = { r: number; g: number; b: number; a: number };

function parseColor(css: string): Color {
  const t = css.trim();
  const space =
    /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/i.exec(
      t,
    );
  if (space) {
    return {
      r: Number(space[1]) * 255,
      g: Number(space[2]) * 255,
      b: Number(space[3]) * 255,
      a: space[4] === undefined ? 1 : Number(space[4]),
    };
  }
  const fn =
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/i.exec(
      t,
    );
  if (fn) {
    return {
      r: Number(fn[1]),
      g: Number(fn[2]),
      b: Number(fn[3]),
      a: fn[4] === undefined ? 1 : Number(fn[4]),
    };
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(t);
  const digits = hex?.[1];
  if (digits) {
    const full =
      digits.length === 3
        ? digits
            .split("")
            .map((c) => c + c)
            .join("")
        : digits;
    return {
      r: Number.parseInt(full.slice(0, 2), 16),
      g: Number.parseInt(full.slice(2, 4), 16),
      b: Number.parseInt(full.slice(4, 6), 16),
      a: 1,
    };
  }
  throw new Error(`解析不出颜色：${css}`);
}

/** 半透明的线叠在不透明画布底上，得到实际参与显示的合成色。 */
function blendOver(fg: string, bg: string): string {
  const f = parseColor(fg);
  const b = parseColor(bg);
  const mix = (x: number, y: number) => Math.round(x * f.a + y * (1 - f.a));
  return `rgb(${mix(f.r, b.r)}, ${mix(f.g, b.g)}, ${mix(f.b, b.b)})`;
}

function relativeLuminance(css: string): number {
  const c = parseColor(css);
  const lin = [c.r, c.g, c.b]
    .map((v) => v / 255)
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

  /**
   * 网格线（规范 03 §3.6.1.1 的 A 方案落地）。
   *
   * 这里验两件在源码层判不出来的事：
   *  ① `color-mix()` 写在 SVG 的 `stroke` 位置上**解析得了** —— React Flow 的
   *     `<Background color=…>` 把值写成自定义属性 `--xy-background-pattern-color-props`，
   *     真正的 stroke 由样式表取它，所以「送到」由 jsdom 用例钉、「解析得了」只能在这里钉；
   *  ② 改动的目的成立：**浅色画布上的网格线不该比深色下更看不见**。写死 slate-400 时
   *     浅色 1.11:1 / 深色 1.20:1（浅色反而更弱），换两档之后浅色走黑、反超深色。
   */
  test("网格线：color-mix 在 stroke 位置解析，且浅色不再比深色更弱", async ({
    page,
  }) => {
    /* 三档 α 都是真值：0.14 = 主参考线默认与库预览定值，0.22 = 细线默认，0.6 = 用户拉高。 */
    for (const alpha of [0.14, 0.22, 0.6]) {
      /* 与 `gridLineColor()` 同一套取整口径：α 换算成百分数，不丢一位小数。 */
      const percent = Math.round(alpha * 1000) / 10;
      const expr = `color-mix(in srgb, var(--color-canvas-grid-line) ${percent}%, transparent)`;
      const seen: Record<
        "light" | "dark",
        { stroke: string; color: Color; ratio: number }
      > = {} as never;

      for (const dark of [false, true]) {
        await setTheme(page, dark);
        const key = dark ? ("dark" as const) : ("light" as const);
        const got = await page.evaluate(
          ({ expr: e, token }) => {
            const svg = document.createElementNS(
              "http://www.w3.org/2000/svg",
              "svg",
            );
            const path = document.createElementNS(
              "http://www.w3.org/2000/svg",
              "path",
            );
            path.setAttribute("style", `stroke: ${e}`);
            svg.appendChild(path);
            document.body.appendChild(svg);
            const stroke = getComputedStyle(path).stroke;
            svg.remove();
            return {
              stroke,
              canvas: getComputedStyle(document.documentElement)
                .getPropertyValue(token)
                .trim(),
            };
          },
          { expr, token: "--color-canvas" },
        );
        /* 线要真画出来：解析不出颜色 / 全透明 = 幽灵 token 的静默形态。 */
        const color = parseColor(got.stroke);
        expect(
          color.a,
          `α=${alpha} ${key}档的线没画出来：stroke=${got.stroke}`,
        ).toBeGreaterThan(0);
        seen[key] = {
          stroke: got.stroke,
          color,
          ratio: contrastRatio(blendOver(got.stroke, got.canvas), got.canvas),
        };
      }

      /* 两档各取对应色相：浅=黑、深=slate-400（**就是原来写死的那个值**，
       * 所以深色主题下像素不变）。比分量不比字符串 —— 序列化形态是
       * `color(srgb …)`，字符串断言会在 Chromium 改写法那天无故变红。 */
      const expected: Record<"light" | "dark", [number, number, number]> = {
        light: [0, 0, 0],
        dark: [148, 163, 184],
      };
      for (const key of ["light", "dark"] as const) {
        const c = seen[key].color;
        const [r, g, b] = expected[key];
        const got2 = [Math.round(c.r), Math.round(c.g), Math.round(c.b)];
        expect(
          got2,
          `${key}档网格线色相应当是 [${r}, ${g}, ${b}]，实际 ${JSON.stringify(
            got2,
          )}（stroke=${seen[key].stroke}）`,
        ).toEqual([r, g, b]);
        expect(c.a, `${key}档的 α 没乘上去`).toBeCloseTo(alpha, 3);
      }
      console.log(
        `[网格线 α=${alpha}] 浅 ${seen.light.ratio.toFixed(2)}:1 / 深 ${seen.dark.ratio.toFixed(2)}:1`,
      );
      expect(
        seen.light.ratio,
        `α=${alpha} 时浅色画布的网格线（${seen.light.ratio.toFixed(2)}:1）比深色（${seen.dark.ratio.toFixed(
          2,
        )}:1）更看不见 —— 写死单一色相的老问题回来了`,
      ).toBeGreaterThanOrEqual(seen.dark.ratio);
    }
  });

  /**
   * **二次代入**这条路径（上一批留下的缝，本次补）。
   *
   * 上一条用例把 `color-mix()` 直接写进 `stroke`，那不是画布真正走的路。真实路径是：
   * React Flow 把 `<Background color=…>` 写成内联自定义属性
   * `--xy-background-pattern-color-props`，样式表里再
   * `stroke: var(--xy-background-pattern-color-props, var(--xy-background-pattern-color, 默认))`
   * 取它 —— 也就是**「一个 var() 嵌在自定义属性里、又被外层 var() 二次代入」**，
   * 而且内层那个 `var()` 自己还带着 `color-mix()`。三段各有各的失效方式，
   * 只验两头等于没验中间。
   *
   * 样式表由画布组件模块级 import，所以这里必须走 `/workspace`（`/login` 上没有这三条规则）。
   */
  test("二次代入：经 --xy-background-pattern-color-props 取到的仍是同一个色", async ({
    page,
  }) => {
    await page.goto("/workspace", { waitUntil: "domcontentloaded" });

    /* 反空转：真规则不在场就别往下断言 —— 否则「取到了默认灰」会被读成「token 生效」。 */
    const ruleCount = await page.evaluate(() => {
      let n = 0;
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList | null = null;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const r of Array.from(rules ?? []))
          if (r.cssText?.includes("--xy-background-pattern-color-props")) n++;
      }
      return n;
    });
    expect(
      ruleCount,
      "/workspace 没带上 xyflow 的 background-pattern 规则（这条用例的前提没了）",
    ).toBeGreaterThanOrEqual(3);

    const expr = gridLineColor(0.14);
    for (const dark of [false, true]) {
      await setTheme(page, dark);
      const got = await page.evaluate((e) => {
        const wrap = document.createElement("div");
        wrap.style.setProperty("--xy-background-pattern-color-props", e);
        const svg = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "svg",
        );
        const path = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        /* 类名是真实路径的关键：stroke 由样式表按这个选择器给，不是内联。 */
        path.setAttribute("class", "react-flow__background-pattern lines");
        svg.appendChild(path);
        wrap.appendChild(svg);
        document.body.appendChild(wrap);
        const stroke = getComputedStyle(path).stroke;
        wrap.remove();
        return stroke;
      }, expr);
      const key = dark ? "深色" : "浅色";
      const c = parseColor(got);
      expect(
        c.a,
        `${key}档：stroke=${got}（α 没穿过二次代入）`,
      ).toBeGreaterThan(0);
      const want = dark ? [148, 163, 184] : [0, 0, 0];
      expect(
        [Math.round(c.r), Math.round(c.g), Math.round(c.b)],
        `${key}档经自定义属性取到的不是那个色相（stroke=${got}）`,
      ).toEqual(want);
    }

    /**
     * 负控制，也是这条路径最阴的地方：内层 token 一旦不存在，`--props` 整个变成
     * guaranteed-invalid，外层 `var(--props, 默认)` **静默退回 xyflow 自己的默认灰** ——
     * 不报错、不变黑、也不留痕，比 seed 图标那次的「退成黑色」还安静。
     * 所以这里断「确实退回了别的颜色」，把这个事实钉在测试里，而不是等下一个人猜。
     */
    /**
     * 负控制，也是这条路径最阴的地方：内层 token 一旦不存在，整条 `stroke` 声明
     * **不报错**，只是静默降级。实测降级到哪儿**取决于作用域**：
     *   · 挂在 `.react-flow` 之外（xyflow 的 `…-lines-color-default` 不在作用域）→ `none`，线直接消失；
     *   · 挂在 `.react-flow` 内 → 退回 xyflow 的默认灰（不是我们的色相）。
     * 两种都无声。所以这里不赌具体值，只钉那条不变的不变量：**幽灵 token 绝不会
     * 解析成我们的色相**，并把两种作用域的实际值打印出来供排障对照 ——
     * 比 seed 图标那次「退成黑色」还安静，因为画面看着「只是没有网格线」。
     */
    const ghostExpr =
      "color-mix(in srgb, var(--color-nope-token) 14%, transparent)";
    const inBothScopes = await page.evaluate((e) => {
      const read = (hostClass: string): string => {
        const host = document.createElement("div");
        if (hostClass) host.className = hostClass;
        const svg = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "svg",
        );
        svg.setAttribute(
          "style",
          `--xy-background-pattern-color-props: ${e}; width: 40px; height: 40px`,
        );
        const path = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        path.setAttribute("class", "react-flow__background-pattern lines");
        svg.appendChild(path);
        host.appendChild(svg);
        document.body.appendChild(host);
        const stroke = getComputedStyle(path).stroke;
        host.remove();
        return stroke;
      };
      return { detached: read(""), inReactFlow: read("react-flow") };
    }, ghostExpr);
    console.log(
      `[二次代入负控制] 内层 token 缺失 → 裸作用域 stroke=${inBothScopes.detached} / .react-flow 内 stroke=${inBothScopes.inReactFlow}（两种都无声）`,
    );
    for (const [scope, stroke] of Object.entries(inBothScopes)) {
      if (stroke === "none") continue; // 线消失：同样是「没画出我们的色相」
      const c = parseColor(stroke);
      expect(
        [Math.round(c.r), Math.round(c.g), Math.round(c.b)],
        `${scope} 作用域下幽灵 token 竟解析成了黑色（stroke=${stroke}）—— 说明这条路径的行为变了，规范 §3.6.1.1 的这段要重写`,
      ).not.toEqual([0, 0, 0]);
    }
  });

  /* ── 字体链（#1434）───────────────────────────────────────────────
     全站正文一度落在浏览器默认字体上：`@theme inline` 里那行
     `--font-sans: var(--font-sans)` 与 `@theme` 的真定义重名，而 inline 块不向
     :root 发射变量 —— `font-sans` 于是内联成一句指向空气的自引用。
     实测当时的现场：`getComputedStyle(documentElement).getPropertyValue("--font-sans")`
     返回空串，body 与 h1 的计算字体是 UA 默认的 "Times New Roman"，而 tsc /
     eslint / 主题色扫描 / 那条「别名不得与项目 token 重名」的判据全都报绿
     （后者当时只覆盖块的前 26 个 --color-* 名字）。
     颜色判据在产物侧读不到这件事，字体也一样 —— 只有真浏览器能判「实际用在哪」。 */
  test("正文与标题真的用上设计那串字体栈（两态各自验）", async ({ page }) => {
    for (const dark of [false, true]) {
      await setTheme(page, dark);
      const label = dark ? "暗色" : "浅色";
      const fonts = await page.evaluate(() => {
        const rootStyle = getComputedStyle(document.documentElement);
        /* 标题档不靠「这一屏恰好有 h1」—— 挂一个用同一个工具类的探针元素，判的是
           真级联里 `font-title` 解得出什么。（字体族由 `font-title` 带，
           `.u-title-*` 只管字号/字重/字距/颜色；/login 上没有 h1，实测取到空串。） */
        const probe = document.createElement("h2");
        probe.className = "font-title";
        probe.textContent = "字体探针";
        document.body.appendChild(probe);
        const titleFamily = getComputedStyle(probe).fontFamily;
        probe.remove();
        return {
          sansToken: rootStyle.getPropertyValue("--font-sans").trim(),
          titleToken: rootStyle.getPropertyValue("--font-title").trim(),
          bodyFamily: getComputedStyle(document.body).fontFamily,
          titleFamily,
        };
      });
      /* 令牌本身在场且非空 —— 空串就是那次事故的直接形态。 */
      expect(fonts.sansToken, `${label}：--font-sans 解析为空`).toBeTruthy();
      expect(fonts.titleToken, `${label}：--font-title 解析为空`).toBeTruthy();
      /* 计算样式里必须看到项目写进栈里的名字。`Geist` 由 next/font 在运行时挂上
         <html>，是栈的首选；CJK 回退是项目自己写的，两者都得在。 */
      expect(fonts.bodyFamily, `${label}：正文没走设计字体栈`).toContain(
        "Geist",
      );
      expect(fonts.bodyFamily).toContain("PingFang SC");
      expect(
        fonts.bodyFamily.toLowerCase(),
        `${label}：正文退回浏览器默认字体`,
      ).not.toContain("times new roman");
      /* 标题档：探针元素必须解得出标题首选那颗字体，且与正文不同源
         （同源就说明「标题走另一颗 token」是假的）。 */
      expect(
        fonts.titleFamily,
        `${label}：探针元素解不出字体（font-title 类没生效）`,
      ).toBeTruthy();
      expect(
        fonts.titleFamily,
        `${label}：标题档没用到 --font-title 的首选字体`,
      ).toContain("Sarasa Gothic SC");
      expect(
        fonts.titleFamily,
        `${label}：标题字体与正文一模一样，--font-title 没生效`,
      ).not.toBe(fonts.bodyFamily);
    }
  });
});
