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
 * 本文件守三条性质，任何一条破了都会让「改一处样式、全站生效」失效：
 *
 * - **T1（单向）**：别名不许写字面量 —— 只能是 `var(--color-*)` 转发。
 *   别名自己写死色值时，「改品牌色」要点名到别名这一层。
 * - **T2（不重名）**：`@theme inline` 里不许出现 `@theme` 已有的名字。
 *   重名 = 项目 token 被别名顶掉（上面那个静默 bug 的形状）。
 * - **T3（无环）**：`var()` 引用链必须无环、且不得漏到未定义的名字。
 *   `--color-X: var(--X)` 配 `--X: var(--color-X)` 会让两边都变成无效值。
 *
 * 判据读的是**编译产物**（Tailwind 真编 `globals.css`），不是源码文本 ——
 * 源码文本看不出「同名两处谁赢」，那正是上面那个 bug 逃过所有检查的原因。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadThemeTokens, type ThemeTokens } from "./helpers/theme-tokens";

const sourceCss = readFileSync(
  path.resolve(__dirname, "../src/app/globals.css"),
  "utf8",
);

/** 截取源码里的一个块（从 start 标记到 end 标记之前）。 */
function sliceBlock(source: string, start: string, end: string): string {
  const i = source.indexOf(start);
  if (i < 0) throw new Error(`找不到起始标记：${start}`);
  const j = source.indexOf(end, i + start.length);
  return source.slice(i, j < 0 ? source.length : j);
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
};

describe("T1 别名只做 var() 转发，不写第二份字面量（ISSUE #672）", () => {
  it.each(ALIASES)("%s 的值是 var(--color-*)", (name) => {
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
    for (const name of ALIASES) {
      const rawL = light.raw(name);
      const rawD = dark.raw(name);
      if (rawL === undefined || rawD === undefined) continue;
      expect(rawL, `${name} 又按主题写了两份（应只转发表达一次）`).toBe(rawD);
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
    const themeBlock = sliceBlock(sourceCss, "@theme {", "/* Immersive");
    const inlineBlock = sliceBlock(sourceCss, "@theme inline {", "\n}");
    const projectNames = new Set(
      [...themeBlock.matchAll(/^\s*(--color-[a-z0-9-]+)\s*:/gm)].flatMap((m) =>
        m[1] ? [m[1]] : [],
      ),
    );
    const bridged = [
      ...inlineBlock.matchAll(
        /^\s*(--color-[a-z0-9-]+)\s*:\s*var\(--([a-z0-9-]+)\);?/gm,
      ),
    ].flatMap((m) => (m[1] && m[2] ? [[m[1], m[2]] as const] : []));
    expect(
      bridged.length,
      "@theme inline 的桥一条都没有（判据失效）",
    ).toBeGreaterThan(10);
    const shadowed = bridged.filter(([name]) => projectNames.has(name));
    expect(
      shadowed,
      "这些名字既是项目 token（@theme 里有字面量）又被 @theme inline 桥接到别名 —— 后者会静默顶掉前者",
    ).toEqual([]);
  });

  it("别名桥指向的别名确实存在（没有指向空气）", () => {
    const inlineBlock = sliceBlock(sourceCss, "@theme inline {", "\n}");
    const bridged = [
      ...inlineBlock.matchAll(
        /^\s*--color-[a-z0-9-]+\s*:\s*var\(--([a-z0-9-]+)\)/gm,
      ),
    ].flatMap((m) => (m[1] ? [m[1]] : []));
    const declared = new Set(
      [...sourceCss.matchAll(/^\s*--([a-z0-9-]+)\s*:/gm)].flatMap((m) =>
        m[1] ? [m[1]] : [],
      ),
    );
    for (const alias of bridged) {
      expect(
        declared.has(alias),
        `@theme inline 引用了未声明的 --${alias}`,
      ).toBe(true);
    }
  });
});

describe("T3 var() 引用链无环、不漏到未定义的名字", () => {
  it.each([
    ["浅色", () => light],
    ["深色", () => dark],
  ] as const)("%s：每个别名都能解到一个具体值", (_label, get) => {
    const t = get();
    for (const name of ALIASES) {
      if (!t.has(name)) continue;
      expect(
        () => t.get(name),
        `${name} 解析抛错（多半是成环或缺定义）`,
      ).not.toThrow();
      expect(t.get(name), `${name} 解不出具体值`).toBeTruthy();
      expect(t.get(name), `${name} 解出的仍是未展开的 var()`).not.toMatch(
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
