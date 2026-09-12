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

  it.each(allTones)("tone=%s 在任何密度下都禁止换行", (tone) => {
    for (const density of ["regular", "compact"] as const) {
      expect(tokens(topBarButtonClass(tone, density))).toContain(
        "whitespace-nowrap",
      );
    }
  });

  it.each(allTones)("tone=%s 在任何密度下都禁止被 flex 压扁", (tone) => {
    for (const density of ["regular", "compact"] as const) {
      expect(tokens(topBarButtonClass(tone, density))).toContain("shrink-0");
    }
  });

  it.each(allTones)("tone=%s 图标与中文同一基线", (tone) => {
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
      'className="mt-0.5 truncate text-[11px] font-medium text-gray-400"',
    );
  });

  it("面包屑区给得出可读下限，否则永远挤在一行", () => {
    /* 名字带 truncate，min-content 极小——没有下限时 flex 会一直「再压一点」，
     * 按钮组永远等不到换行、只能与面包屑重叠。 */
    expect(tokens(TOP_BAR_BREADCRUMB_CLASS)).toContain(
      TOP_BAR_BREADCRUMB_MIN_WIDTH_CLASS,
    );
    expect(tokens(TOP_BAR_BREADCRUMB_MIN_WIDTH_CLASS)).toContain(
      "min-w-[170px]",
    );
  });
});

/* ── 顶栏只通过 store 动作开关 IO 编辑 / 预览 ──────────────────────────────
 * 「关编辑模式 ⇒ 关预览」这层耦合写在 store 的 `setIoEditMode` 里。顶栏若绕过
 * 动作、直接 `setState({ ioEditMode })`，耦合就被短路掉：编辑模式退出、预览面
 * 板留在画布上，而面板里每一行都来自已经不存在的勾选项。
 * 这里做源码级守卫 —— 断言的是「有没有留后门」，不是某个按钮的字面实现。 */
describe("IO 编辑 / 预览开关必须走 store 动作", () => {
  const source = readFileSync(path.resolve(__dirname, "WorkflowEditorTopbar.tsx"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("顶栏不直接 setState 写 ioEditMode / ioPreviewOpen", () => {
    expect(code).not.toMatch(/setState\([\s\S]{0,120}?ioEditMode/);
    expect(code).not.toMatch(/setState\([\s\S]{0,120}?ioPreviewOpen/);
  });

  it("开关动作确实调到了 store", () => {
    expect(code).toContain("setIoEditMode(");
    expect(code).toContain("setIoPreviewOpen(");
  });
});
