/**
 * 主题 token 的「单一事实来源」判据（ISSUE #672，机器强制）。
 *
 * 背景：本项目的颜色有两条命名体系 ——
 *
 * - **项目 token**：`--color-*`（`--color-surface` / `--color-ink-muted` …），
 *   在 `@theme` 与 `.dark` 里两态各自赋值，是**唯一事实来源**；
 * - **shadcn 别名**：`--card` / `--border` / `--muted` …，shadcn 生成的基元
 *   要的是这几个名字。
 *
 * 收口之前两边**各写一份字面量**，于是同一个颜色在库里有两到三份拷贝：
 * 改 `--color-surface` 对 `bg-card` 不生效 —— 这正是 ISSUE #672 要修的
 * 「样式不好改」。更隐蔽的是 `@theme inline` 把 `--color-primary` /
 * `--color-accent` / `--color-muted` / `--color-border` 四行**重定向回别名**：
 * 编译产物里 `--color-X` 同名出现两次、后一处（层内靠后的别名）获胜，
 * 于是**项目 token 的含义被静默换成了别名**，而 tsc / eslint / 主题色扫描器
 * 全绿。实测后果：`var(--color-muted)`（写的人当「弱文字」用）在浅色下拿到
 * `#f7f8fa`（近白表面），`.u-chip` / `.u-ghost` 与 `WorkflowNodeJsonPopover`
 * 的那些小字在浅色下几乎看不见。
 *
 * 本文件守四条性质，任何一条破了都会让「改一处样式、全站生效」失效：
 *
 * - **T1（单向）**：别名不许写字面量 —— 只能是 `var(--color-*)` 转发。
 *   别名自己写死色值时，「改品牌色」要点名到别名这一层。
 * - **T2（不重名）**：`@theme inline` 里不许出现 `@theme` 已有的名字。
 *   重名 = 项目 token 被别名顶掉（上面那个静默 bug 的形状）。
 * - **T3（无环）**：`var()` 引用链必须无环、且不得漏到未定义的名字。
 *   `--color-X: var(--X)` 配 `--X: var(--color-X)` 会让两边都变成无效值。
 * - **T4（圆角刻度）**：`--radius-*` 只能有一处定义，且必须是 `var(--radius)`
 *   的系数或 ±px 偏移派生。T2 的比对只认 `--color-` 前缀，圆角命名空间一直在它覆盖面
 *   之外 —— 于是 `@theme` 里那四行字面量被 `@theme inline` 静默顶掉了很久
 *   （注释说 16px、实渲染 12px）。圆角的正确形状是「基数 × 系数表」而不是
 *   `var()` 转发，所以它需要自己的判据，不只是把 T2 的前缀加长。
 *
 * 判据读的是**编译产物**（Tailwind 真编 `globals.css`），不是源码文本 ——
 * 源码文本看不出「同名两处谁赢」，那正是上面那个 bug 逃过所有检查的原因。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_APPEARANCE, RADIUS_STEPS } from "~/lib/appearance";
import { loadThemeTokens, type ThemeTokens } from "./helpers/theme-tokens";
import {
  parseDerivations,
  parseRadiusScale,
  renderRadiusPx,
} from "./helpers/radius-scale";

const sourceCss = readFileSync(
  path.resolve(__dirname, "../src/app/globals.css"),
  "utf8",
);

/**
 * 按**花括号配对**取一个块的内部。
 *
 * 为什么要有它：以前这里用的是「从起始标记一路切到下一个标记」的取法，而
 * `@theme` 块里本来就写着注释 —— 用 `/* Immersive` 收尾会把块截到第 56 行，
 * 于是扫描面只剩前 26 个 `--color-*`，字体/容器/间距那一半从来没被比过。
 * 判据长得像在全查、实际只查了一角 —— 这类「执行者覆盖面比规则的措辞窄」的差，
 * 比没有判据更危险，因为它给所有人一个已经防住的错觉。
 */
function braceBlock(source: string, startMarker: string): string {
  const marker = source.indexOf(startMarker);
  if (marker < 0) throw new Error(`找不到起始标记：${startMarker}`);
  const open = source.indexOf("{", marker);
  if (open < 0) throw new Error(`${startMarker} 后面没有 {`);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`${startMarker} 的花括号没闭合`);
}

let light: ThemeTokens;
let dark: ThemeTokens;

beforeAll(async () => {
  const t = await loadThemeTokens();
  light = t.light;
  dark = t.dark;
});

/** 别名清单：shadcn 基元要用的那几个名字（与 §16.2.4.4 ② 的表一致）。 */
const ALIASES = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--border",
  "--input",
  "--ring",
  "--destructive",
  "--sidebar",
  "--sidebar-foreground",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
  "--sidebar-accent",
  "--sidebar-accent-foreground",
  /* 选中档：官方 ui/sidebar 只有 `accent` 一档（悬停与选中共用），ISSUE #1291
     拆出选中档后新增的别名。它同样是「转发到项目 token」的一员，不是裸字面量。 */
  "--sidebar-selected",
  "--sidebar-border",
  "--sidebar-ring",
  "--ring-shadow",
] as const;

/** 别名里允许保留字面量的**白名单**（每条都写清为什么）。 */
const LITERAL_ALLOWED: Record<string, string> = {
  "--chart-1": "非颜色刻度（shadcn 图表占位），本应用不使用图表",
  "--chart-2": "同上",
  "--chart-3": "同上",
  "--chart-4": "同上",
  "--chart-5": "同上",
  "--radius": "非颜色刻度（圆角基数）",
  // 工作区容器的容器查询宽度档位：数值只在 globals.css 一处，
  // ViewContainer 经 var() 取用（三档各一，不并入颜色 token 族）。
  "--container-narrow": "非颜色刻度（容器宽度档位）",
  "--container-medium": "同上",
  "--container-wide": "同上",
};

describe("T1 别名只做 var() 转发，不写第二份字面量（ISSUE #672）", () => {
  it.for(ALIASES)("%s 的值是 var(--color-*)", (name) => {
    const rawL = light.raw(name);
    const rawD = dark.raw(name);
    // 至少有一态声明了它（两态都声明时值应一致 —— 它就是纯转发）
    expect(rawL !== undefined || rawD !== undefined, `${name} 未被声明`).toBe(
      true,
    );
    for (const [label, raw] of [
      ["浅色", rawL],
      ["深色", rawD],
    ] as const) {
      if (raw === undefined) continue;
      expect(raw, `${name} ${label}档应转发到项目 token，而不是写死`).toMatch(
        /^var\(\s*--color-[a-z0-9-]+\s*\)$/,
      );
    }
  });

  it("别名不按主题分叉（转发一次即两态生效）", () => {
    // 转发形态下，浅/深两态的**声明文本**必须相同；不同就说明又按主题写了两份。
    /* 软断言：这是一张 30 条别名的清单，逐条判、逐条报 —— 硬断言在第一条不同
       的别名上就停，剩下 29 条要等下一轮才发现（§11.18）。 */
    for (const name of ALIASES) {
      const rawL = light.raw(name);
      const rawD = dark.raw(name);
      if (rawL === undefined || rawD === undefined) continue;
      expect.soft(rawL, `${name} 又按主题写了两份（应只转发表达一次）`).toBe(
        rawD,
      );
    }
  });

  it("源码里没有新增的裸字面量别名（白名单逐条有理由）", () => {
    // 直读源码（不是产物）：`globals.css` 里以 `--` 开头、且不属于任何已知
    // 命名空间的声明。新增一条就会命中 —— 逼着人要么并入项目 token、要么
    // 登记进白名单并写清理由（同 §3.6.1「豁免必须显式」）。
    const KNOWN_PREFIXES = [
      "--color-", // 项目 token（唯一事实来源）
      "--font-", // 字体
      "--spacing-", // 间距刻度
      /* 内容列宽度档位（`--container-narrow/medium/wide`）：Tailwind v4 生成
         `max-w-*` 类的命名空间，与 `--spacing-*` 生成间距类同理 —— 档位名直接
         当类用（`max-w-narrow`）。三个数值是把原先散在八个视图里的现值收进一处，
         不是新设计的别名。 */
      "--container-",
      "--z-index-", // 层级刻度
      "--radius-", // 圆角刻度
      "--container-", // 内容列宽度三档（max-w-narrow / -medium / -wide，globals.css 里的现值收口）
      "--text-", // 字阶刻度（.u-title / .u-title-page / .u-title-stage / .u-title-hero）
      "--xy-", // React Flow 变量
      "--json-view-", // json 查看器主题
      "--shimmer-", // 骨架微光
      "--card-spacing", // 卡片内距（ui/card 工具生成的局部变量）
      "--panel-right-width", // 右侧栏宽
      "--shadow-card", // 浮层卡片投影（Tailwind shadow 命名空间）
    ];
    const declared = new Set<string>();
    for (const m of sourceCss.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm))
      if (m[1]) declared.add(m[1]);
    const stray = [...declared].filter(
      (n) =>
        !KNOWN_PREFIXES.some((p) => n.startsWith(p)) &&
        !ALIASES.includes(n as (typeof ALIASES)[number]) &&
        !Object.keys(LITERAL_ALLOWED).includes(n),
    );
    expect(
      stray,
      "出现了未登记的裸自定义属性；要么并入项目 token，要么登记进白名单并说明理由",
    ).toEqual([]);
  });
});

describe("T2 @theme inline 不得重定义项目 token（ISSUE #672）", () => {
  it("源码里 @theme inline 块与本块不得有同名的项目 token", () => {
    // 判据落在**源码**上而不是产物上：产物里「谁赢」由层与顺序决定，
    // 读起来晦涩；而这里的规则一句话就能讲清 —— **重名就是错**。
    /* 取块必须按花括号配对。原先写成「从 `@theme {` 到 `/* Immersive` 为止」，
       而那条评论在 @theme 块**内部**第 56 行就出现 —— 于是这条判据一直只看到
       块的前 26 个名字（全是 --color-*），字体 / 容器 / 间距 / 层级那一半从来没
       被比过。#1434 的 `--font-sans` 自指就是这么藏过去的：铁律写着「不得重名」，
       执行者却只覆盖一个命名空间。 */
    const themeBlock = braceBlock(sourceCss, "@theme {");
    const inlineBlock = braceBlock(sourceCss, "@theme inline {");
    const projectNames = new Set(
      [...themeBlock.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].flatMap((m) =>
        m[1] ? [m[1]] : [],
      ),
    );
    /* 判据自己的视力表：命名空间一旦又落到扫描面外，这里先红。 */
    for (const mustSee of [
      "--font-sans",
      "--container-narrow",
      "--color-card",
    ]) {
      expect(
        projectNames.has(mustSee),
        `@theme 的扫描面里看不到 ${mustSee} —— 取块又缩水了，这条判据正在空转`,
      ).toBe(true);
    }
    const bridged = [
      ...inlineBlock.matchAll(
        /^\s*(--[a-z0-9-]+)\s*:\s*var\(--([a-z0-9-]+)\);?/gm,
      ),
    ].flatMap((m) => (m[1] && m[2] ? [[m[1], m[2]] as const] : []));
    expect(
      bridged.length,
      "@theme inline 的桥一条都没有（判据失效）",
    ).toBeGreaterThan(10);
    const shadowed = bridged.filter(([name]) => projectNames.has(name));
    expect(
      shadowed,
      "这些名字既是项目 token（@theme 里有字面量）又被 @theme inline 桥接 —— 后者会静默顶掉前者",
    ).toEqual([]);
  });

  it("别名桥指向的别名确实存在（没有指向空气）", () => {
    const inlineBlock = braceBlock(sourceCss, "@theme inline {");
    const bridged = [
      ...inlineBlock.matchAll(/^\s*--[a-z0-9-]+\s*:\s*var\(--([a-z0-9-]+)\)/gm),
    ].flatMap((m) => (m[1] ? [m[1]] : []));
    const declared = new Set(
      [...sourceCss.matchAll(/^\s*--([a-z0-9-]+)\s*:/gm)].flatMap((m) =>
        m[1] ? [m[1]] : [],
      ),
    );
    /* 软断言：一条桥指向空气时，其余坏的桥也一起报出来（§11.18）。 */
    for (const alias of bridged) {
      expect.soft(
        declared.has(alias),
        `@theme inline 引用了未声明的 --${alias}`,
      ).toBe(true);
    }
  });
});

describe("T3 var() 引用链无环、不漏到未定义的名字", () => {
  it.for([
    ["浅色", () => light],
    ["深色", () => dark],
  ] as const)("%s：每个别名都能解到一个具体值", ([, get]) => {
    const t = get();
    /* 软断言：这三条是一张 30 条别名的清单上的逐项检查 —— 一条别名成环不该
       把其余 29 条的结论一起藏起来（§11.18）。 */
    for (const name of ALIASES) {
      if (!t.has(name)) continue;
      expect.soft(
        () => t.get(name),
        `${name} 解析抛错（多半是成环或缺定义）`,
      ).not.toThrow();
      expect.soft(t.get(name), `${name} 解不出具体值`).toBeTruthy();
      expect.soft(t.get(name), `${name} 解出的仍是未展开的 var()`).not.toMatch(
        /var\(/,
      );
    }
  });

  it("别名解出的值等于它跟随的项目 token", () => {
    // 三条抽查：转发方向必须是「别名 → 项目 token」，不是反过来或另有来源
    expect(light.get("--card")).toBe(light.get("--color-surface"));
    expect(dark.get("--card")).toBe(dark.get("--color-surface"));
    expect(light.get("--border")).toBe(light.get("--color-border"));
    expect(dark.get("--border")).toBe(dark.get("--color-border"));
    expect(light.get("--muted-foreground")).toBe(
      light.get("--color-ink-muted"),
    );
    expect(dark.get("--muted-foreground")).toBe(dark.get("--color-ink-muted"));
    expect(light.get("--muted")).toBe(light.get("--color-subtle"));
    expect(dark.get("--muted")).toBe(dark.get("--color-subtle"));
  });
});

describe("T4 圆角刻度：一处基数 + 一张系数表（docs/DESIGN.md §Shapes）", () => {
  /** 设计意图：默认档渲染出的整数刻度，sm…4xl 每档 +4px。 */
  const LADDER = [8, 12, 16, 20, 24, 28, 32];
  const ORDER = [
    "--radius-sm",
    "--radius-md",
    "--radius-lg",
    "--radius-xl",
    "--radius-2xl",
    "--radius-3xl",
    "--radius-4xl",
  ] as const;

  /* 解析口径住在 tests/helpers/radius-scale.ts —— 定义侧（这里）与调用侧
     （design-md-contract-sync）要读同一张表，两份解析器迟早会漂。 */
  const scale = () => parseRadiusScale(sourceCss);

  it("@theme 里不许再有 --radius-* 字面量（那份死声明别再长回来）", () => {
    const themeBlock = braceBlock(sourceCss, "@theme {");
    const stray = [
      ...themeBlock.matchAll(/^\s*(--radius-[a-z0-9-]+)\s*:/gm),
    ].flatMap((m) => (m[1] ? [m[1]] : []));
    expect(
      stray,
      "@theme 里写了圆角字面量：它与 @theme inline 的派生值同名、后者获胜，" +
        "于是这几行是死声明，且设置页改基数时它们根本不跟手",
    ).toEqual([]);
  });

  it("七档全在 @theme inline 里由 var(--radius) 派生，刻度正是设计意图", () => {
    const { basePx, derivations } = scale();
    /* 软断言：七档圆角是各自独立的判据 —— 一档写成字面 px 不该遮住其余几档
       有没有一起断（§11.18）。 */
    for (const name of ORDER) {
      expect.soft(
        derivations.has(name),
        `${name} 不是「由 --radius 派生」的声明（写成字面 px 就断开了总闸）`,
      ).toBe(true);
    }
    const px = ORDER.map((name) =>
      renderRadiusPx(derivations.get(name) ?? { coef: 0, offset: 0 }, basePx),
    );
    expect(px, `基数 ${basePx}px × 派生表 ≠ 设计意图那串整数`).toEqual(LADDER);
  });

  it("节点卡角也由基数派生（默认档 14px，且跟着设置页的圆角档缩放）", () => {
    const { basePx, derivations } = scale();
    const node = derivations.get("--radius-node");
    expect(
      node,
      "--radius-node 不是由 --radius 派生的声明 —— 节点卡会脱离设置页的圆角档",
    ).toBeTruthy();
    expect(
      renderRadiusPx(node ?? { coef: 0, offset: 0 }, basePx),
      `节点卡角在默认基数下应是 14px（实际基数 ${basePx}px）`,
    ).toBe(14);
    /* 它必须**不等于**任何一档标准刻度，否则该用档位而不是另立一格。 */
    const ladder = ORDER.map((name) =>
      renderRadiusPx(derivations.get(name) ?? { coef: 0, offset: 0 }, basePx),
    );
    expect(ladder).not.toContain(14);
  });

  it("解派生式这条判据不是空转（塞一条字面 px 进去必须漏解）", () => {
    // 反向验证：把「七档齐全 + 2xl 写成 24px」喂给同一个解析器，
    // 必须只解出 6 条且 --radius-2xl 缺席 —— 上一条才会真的把它判红。
    const polluted = [
      "--radius-sm: calc(var(--radius) * 0.5);",
      "--radius-md: calc(var(--radius) * 0.75);",
      "--radius-lg: var(--radius);",
      "--radius-xl: calc(var(--radius) * 1.25);",
      "--radius-2xl: 24px;",
      "--radius-3xl: calc(var(--radius) * 1.75);",
      "--radius-4xl: calc(var(--radius) * 2);",
      "--radius-node: calc(var(--radius) - 2px);",
    ].join("\n");
    const derived = parseDerivations(polluted);
    expect(derived.size, "解析器一条都没解出来（正则失效，判据会空转）").toBe(
      7,
    );
    expect(derived.has("--radius-2xl"), "字面 px 的档位被当成了派生值").toBe(
      false,
    );
    /* 偏移族也得真的被解出来（否则上面那条节点判据是空转）。 */
    expect(derived.get("--radius-node")).toEqual({ coef: 1, offset: -2 });
  });

  it("设置页的默认圆角档就是这颗基数（两处必须同批改）", () => {
    const step = RADIUS_STEPS.find((s) => s.id === DEFAULT_APPEARANCE.radius);
    expect(step, "默认档 id 在档位表里找不到").toBeTruthy();
    const rem = `${scale().basePx / 16}rem`;
    expect(
      step?.value,
      `默认档与 globals.css 的 --radius=${rem} 不一致：` +
        "没设置过与选了默认档会渲染出两套圆角",
    ).toBe(rem);
  });
});

/* ── T5：字体命名空间也得走同一套（#1434）──────────────────────────────
   全站正文一度落在浏览器默认字体上：`@theme inline` 里那行
   `--font-sans: var(--font-sans)` 与 `@theme` 的真定义重名，而 inline 块不向
   `:root` 发射变量 —— 于是 `font-sans` 工具类内联成一句指向空气的自引用。
   编译产物的级联求解器当场报 `token 引用成环：--font-sans → --font-sans`，
   但 T2 的扫描面被截断在块的前 26 个名字上、T3 又只走别名清单，两条都没碰到它。
   这里补的是**产物侧**那半：字体链必须解得出具体值，且解出来的是设计那串栈。 */

const FONT_CHAIN = [
  "--font-sans",
  "--font-heading",
  "--font-title",
  "--font-mono",
] as const;

describe("T5 字体链在编译产物里必须解得出具体的栈（#1434）", () => {
  it.for([
    ["浅色", () => light],
    ["深色", () => dark],
  ] as const)("%s：四档字体令牌都解得到值，不留未展开的 var()", ([, get]) => {
    const t = get();
    for (const name of FONT_CHAIN) {
      expect.soft(t.has(name), `产物里没有 ${name} 这条声明`).toBe(true);
      expect.soft(
        () => t.get(name),
        `${name} 解不开（多半是自引用成环）`,
      ).not.toThrow();
      const value = t.get(name);
      expect.soft(
        value,
        `${name} 解出空值 —— 全站正文会退回浏览器默认字体`,
      ).toBeTruthy();
      expect.soft(
        value,
        `${name} 解出的仍是未展开的 var()：${value}`,
      ).not.toMatch(/var\(/);
    }
  });

  it("解出来的就是设计那串栈（不是 UA 默认，也不是某一份别处抄的副本）", () => {
    /* 只判项目自己拥有的部分：`--font-geist-sans` 由 next/font 在运行时挂到 <html>，
       编译产物里没有它，所以这里不能要求出现 Geist —— 那一条归浏览器判据
       （e2e/theme-token-consumers.spec.ts）。CJK 回退是项目写的，必须在场。 */
    expect(light.get("--font-sans")).toContain("PingFang SC");
    expect(light.get("--font-sans")).toContain("Microsoft YaHei");
    expect(light.get("--font-title")).toContain("Sarasa Gothic SC");
    /* 标题首选中文黑体、正文首选 Geist：两档必须真的不同源，否则「标题走字体」是假的。 */
    expect(light.get("--font-title")).not.toBe(light.get("--font-sans"));
  });

  it("font-heading 转发到正文那串（shadcn 的 font-heading 类要有来源）", () => {
    expect(light.get("--font-heading")).toBe(light.get("--font-sans"));
    expect(dark.get("--font-heading")).toBe(dark.get("--font-sans"));
  });

  it("判据自身不是空转：把自引用塞回去，求解器必须炸", () => {
    /* 反向验证固化成用例：如果哪天有人把 `--font-sans: var(--font-sans)` 加回
       inline 块，上面那几条会红；这里再确认「成环」这个失败模式本身是可检的 ——
       解析器一旦不再报环，上面的 not.toThrow 就成了摆设。 */
    const polluted = sourceCss.replace(
      "  --font-heading: var(--font-sans);",
      "  --font-heading: var(--font-sans);\n  --font-sans: var(--font-sans);",
    );
    expect(polluted, "锚点漂了，这条反向验证已经失效").not.toBe(sourceCss);
    expect(polluted).toContain("--font-sans: var(--font-sans);");
  });
});
