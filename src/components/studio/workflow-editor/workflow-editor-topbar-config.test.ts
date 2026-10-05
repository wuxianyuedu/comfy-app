import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  TOP_BAR_BREADCRUMB_CLASS,
  TOP_BAR_BREADCRUMB_MIN_WIDTH_CLASS,
  TOP_BAR_BUTTON_BASE,
  TOP_BAR_DENSITY_BREAKPOINT,
  TOP_BAR_ROOT_CLASS,
  topBarButtonClass,
  topBarGroupClass,
} from "./workflow-editor-topbar-config";

/** class 串按空格切词，便于断言「含有某个工具类」而不受顺序影响。 */
function tokens(cls: string): string[] {
  return cls.split(/\s+/).filter(Boolean);
}

describe("顶栏按钮：不许变形的三条硬规则（ISSUE #404）", () => {
  const allTones = [
    "outline",
    "solid",
    "ghost",
    "ioOn",
    "ioPreviewOn",
  ] as const;

  it.for(allTones)("tone=%s 在任何密度下都禁止换行", (tone) => {
    for (const density of ["regular", "compact"] as const) {
      expect(tokens(topBarButtonClass(tone, density))).toContain(
        "whitespace-nowrap",
      );
    }
  });

  it.for(allTones)("tone=%s 在任何密度下都禁止被 flex 压扁", (tone) => {
    for (const density of ["regular", "compact"] as const) {
      expect(tokens(topBarButtonClass(tone, density))).toContain("shrink-0");
    }
  });

  it.for(allTones)("tone=%s 图标与中文同一基线", (tone) => {
    expect(tokens(topBarButtonClass(tone, "regular"))).toContain(
      "leading-none",
    );
  });

  it("基础类本身就把三条规则带全（漏传 tone 也不会退化）", () => {
    for (const rule of ["shrink-0", "whitespace-nowrap", "leading-none"]) {
      expect(tokens(TOP_BAR_BUTTON_BASE)).toContain(rule);
    }
  });
});

describe("顶栏按钮：紧凑态收窄但可读（「较小尺寸按钮可适当缩小」）", () => {
  it("紧凑态的横向内边距小于常规态", () => {
    const compact = tokens(topBarButtonClass("outline", "compact"));
    const regular = tokens(topBarButtonClass("outline", "regular"));
    expect(compact).toContain("px-2.5");
    expect(regular).toContain("px-4");
  });

  it("紧凑态在断点处回升到常规字号，字号不会永久变小", () => {
    const compact = topBarButtonClass("outline", "compact");
    for (const rule of [
      `${TOP_BAR_DENSITY_BREAKPOINT}:px-4`,
      `${TOP_BAR_DENSITY_BREAKPOINT}:py-2`,
      `${TOP_BAR_DENSITY_BREAKPOINT}:text-sm`,
    ]) {
      expect(tokens(compact)).toContain(rule);
    }
  });

  it("紧凑态字号不低于 12px（正文可读下限）", () => {
    expect(tokens(topBarButtonClass("outline", "compact"))).toContain(
      "text-xs",
    );
  });
});

/* ── 顶栏按钮已换成 ui/button 基元（ISSUE #672 P1）────────────────────────
 * 顶栏按钮的尺寸/底盘仍由本模块决定（退化顺序是专门设计过的，见文件头），
 * 因此 `topBarButtonClass` 必须把基元的 `h-8` / `rounded-lg` / `px-2.5` 与
 * `ghost` 的 hover 底色**覆盖掉** —— 否则基元默认值会在调用处排在后面胜出，
 * 顶栏的窄窗退化整条失效（规范 16 §16.2.4.2 的 `h-auto` 是同一件事）。 */
describe("顶栏按钮：必须覆盖 ui/button 基元的默认外观（ISSUE #672 P1）", () => {
  const allTones = [
    "outline",
    "solid",
    "ghost",
    "ioOn",
    "ioPreviewOn",
  ] as const;

  it.for(allTones)("tone=%s 归还高度与圆角给调用处", (tone) => {
    const cls = tokens(topBarButtonClass(tone, "regular"));
    expect(cls).toContain("h-auto");
    expect(cls).toContain("rounded-none");
    expect(cls).toContain("px-0");
  });

  it.for(allTones)(
    "tone=%s 的圆角与内边距必须排在覆盖串之后（否则 rounded-none 吃掉 tone）",
    (tone) => {
      /* `cn()` 走 tailwind-merge，同一属性**后面的类赢**。覆盖串里的
       * `rounded-none` / `px-0` 是「先声明要归位」，真正生效的必须是 tone 的
       * `rounded-md|lg` 与密度的 `px-*`。顺序写反时顶栏按钮会全部变直角、
       * 内边距归零 —— 而源码里两串都「在」，只有合并结果能证明。 */
      const cls = topBarButtonClass(tone, "compact");
      const iOverride = cls.indexOf("rounded-none");
      const iToneRadius = cls.search(/rounded-(?:md|lg)\b/);
      expect(iOverride).toBeGreaterThanOrEqual(0);
      expect(iToneRadius).toBeGreaterThan(iOverride);

      const iPx0 = cls.indexOf("px-0");
      /* 密度的实值 `px-2.5`（不是 `px-0` 自己）：它必须排在覆盖串之后才生效。 */
      const iPx = cls.indexOf("px-2.5");
      expect(iPx0).toBeGreaterThanOrEqual(0);
      expect(iPx).toBeGreaterThan(iPx0);

      /* `h-auto` 与基元 `h-8` 不是同一串里的冲突 —— 基元高度在
       * `buttonVariants` 里，排在调用处 className 之前，因此恒被覆盖；
       * 这里只需确认覆盖串确实带上了它。 */
      expect(cls).toContain("h-auto");
    },
  );

  it("紧凑态的 px/py 覆盖不会丢（px-0 只做归位，不压掉密度的实值）", () => {
    const cls = topBarButtonClass("outline", "compact");
    expect(cls).toContain("px-2.5");
    expect(cls).toContain(`${TOP_BAR_DENSITY_BREAKPOINT}:px-4`);
    expect(cls).toContain(`${TOP_BAR_DENSITY_BREAKPOINT}:py-2`);
  });

  it("每个 tone 都不含 Tailwind 原生调色板字面量（颜色只有单一事实来源）", () => {
    /* 规范 03 §3.6.2：颜色一律走语义 token / 语义类名，换品牌色时调用处不用改。
     * `violet-*` / `amber-*` / `sky-*` 这类在顶栏出现过（保存钮的实心紫、
     * 「编辑 IO」的琥珀高亮），治理后一律改 `primary-*` / `warning-*` / `info-*`。 */
    const native =
      /(?:^|:)(?:bg|text|border|ring|from|to|via)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/;
    for (const tone of allTones) {
      for (const density of ["regular", "compact"] as const) {
        const cls = topBarButtonClass(tone, density);
        expect(cls).not.toMatch(native);
      }
    }
  });
});

describe("顶栏容器：窄了换行，不压扁按钮", () => {
  it("按钮组整体不收缩", () => {
    for (const density of ["regular", "compact"] as const) {
      expect(tokens(topBarGroupClass(density))).toContain("shrink-0");
    }
  });

  it("按钮组在断点处把间距升回常规值", () => {
    const compact = tokens(topBarGroupClass("compact"));
    expect(compact).toContain("gap-1.5");
    expect(compact).toContain(`${TOP_BAR_DENSITY_BREAKPOINT}:gap-2`);
  });

  it("根容器允许换行（按钮组排不下时整排下移，而不是叠在面包屑上）", () => {
    expect(tokens(TOP_BAR_ROOT_CLASS)).toContain("flex-wrap");
  });

  it("统计行不折行（挤不下时截断，而不是把顶栏撑成两行）", () => {
    /* 同一处挤压的第二种表现：面包屑被压窄后，下面那行「N 个节点 · N 个暴露
     * IO…」会折成两行，顶栏高度跟着跳（实测 1024px 时由 66px 变 83px）。 */
    const source = readFileSync(
      new URL("./WorkflowEditorTopbar.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain(
      'className="text-ink-soft text-2xs mt-0.5 truncate font-medium"',
    );
  });

  it("面包屑区给得出可读下限，否则永远挤在一行", () => {
    /* 名字带 truncate，min-content 极小——没有下限时 flex 会一直「再压一点」，
     * 按钮组永远等不到换行、只能与面包屑重叠。 */
    expect(tokens(TOP_BAR_BREADCRUMB_CLASS)).toContain(
      TOP_BAR_BREADCRUMB_MIN_WIDTH_CLASS,
    );
    expect(tokens(TOP_BAR_BREADCRUMB_MIN_WIDTH_CLASS)).toContain("min-w-42.5");
  });
});

/* ── 顶栏只通过 store 动作开关 IO 编辑 / 预览 ──────────────────────────────
 * 两个方向的耦合都写在 store 里：关预览 ⇒ 退编辑模式，关编辑模式 ⇒ 关预览。
 * 顶栏若绕过动作、直接 `setState({ ioPreviewOpen })`，耦合就被短路掉：预览面板
 * 消失、节点卡片上的一排勾选框还留着 —— 作者看到一个关不掉的编辑态。
 * 这里做源码级守卫 —— 断言的是「有没有留后门」，不是某个按钮的字面实现。 */
describe("IO 编辑 / 预览开关必须走 store 动作（ISSUE #400）", () => {
  const source = readFileSync(
    path.resolve(__dirname, "WorkflowEditorTopbar.tsx"),
    "utf8",
  );
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  it("顶栏不直接 setState 写 ioEditMode / ioPreviewOpen", () => {
    expect(code).not.toMatch(/setState\([\s\S]{0,120}?ioEditMode/);
    expect(code).not.toMatch(/setState\([\s\S]{0,120}?ioPreviewOpen/);
  });

  it("开关动作确实调到了 store", () => {
    expect(code).toContain("setIoEditMode(");
    expect(code).toContain("setIoPreviewOpen(");
  });

  it("关预览不再手写 if (!ioEditMode) setIoEditMode(true) —— 耦合归 store", () => {
    expect(code).not.toMatch(/if\s*\(\s*!\s*ioEditMode\s*\)/);
  });
});

/* 画布侧（`WorkflowEditorInner.tsx`）的预览关闭按钮同样是「关面板」的入口，
 * 它若绕开动作，预览面板收起、勾选框照样留在画布上。 */
describe("画布侧关闭预览也走 store 动作（ISSUE #400）", () => {
  const source = readFileSync(
    path.resolve(__dirname, "WorkflowEditorInner.tsx"),
    "utf8",
  );
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  it("不直接 setState 写 ioPreviewOpen", () => {
    expect(code).not.toMatch(/setState\([\s\S]{0,120}?ioPreviewOpen/);
  });

  it("预览开关调到了 store 动作", () => {
    expect(code).toContain("setIoPreviewOpen(");
  });
});
