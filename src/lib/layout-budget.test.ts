/**
 * 这笔账本身的判据（node 环境，无 DOM）。
 *
 * 两类断言各守一件事：
 *   · 算式与推导 —— 阈值确实等于各列宽度之和 + 内容区下限，`resolveRailCollapsed`
 *     的三档优先没有互相踩过；
 *   · **漂移** —— 这些数字必须与真实源码里的列宽一致。读源码而不是抄常量，
 *     是因为「改了一条列宽忘了改账」正是这笔账唯一会坏的方式；判据只比对字面量，
 *     改的人会在红字里直接看到该改哪一处。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  INSPECTOR_WIDTH_PX,
  NAV_AUTO_COLLAPSE_MAX_PX,
  NAV_COLLAPSE_LEAVES_VIEWPORT_PX,
  NAV_COLLAPSE_SAVED_PX,
  NAV_EXPANDED_MIN_PX,
  NAV_WIDTH_COLLAPSED_PX,
  NAV_WIDTH_EXPANDED_PX,
  resolveRailCollapsed,
  STAGE_RAIL_WIDTH_PX,
  WORKSPACE_MIN_PX,
  WORKSHOP_COLUMN_GAP_PX,
  WORKSHOP_PAGE_PADDING_PX,
} from "./layout-budget";

const REM_PX = 16;

/** 读 src 下的真实源码（相对本文件定位，不依赖 cwd）。 */
function sourceOf(relFromSrc: string): string {
  return readFileSync(
    new URL(path.join("..", relFromSrc), import.meta.url),
    "utf8",
  );
}

describe("左轨让位这笔账的算式", () => {
  it("阈值 = 展开态各列之和 + 内容区下限，且上限比它小 1", () => {
    expect(NAV_EXPANDED_MIN_PX).toBe(
      NAV_WIDTH_EXPANDED_PX +
        WORKSHOP_PAGE_PADDING_PX +
        STAGE_RAIL_WIDTH_PX +
        WORKSHOP_COLUMN_GAP_PX +
        INSPECTOR_WIDTH_PX +
        WORKSPACE_MIN_PX,
    );
    expect(NAV_AUTO_COLLAPSE_MAX_PX).toBe(NAV_EXPANDED_MIN_PX - 1);
  });

  it("收起确实换出了空间，且收起后中间列仍不低于设计下限", () => {
    expect(NAV_COLLAPSE_SAVED_PX).toBeGreaterThan(0);
    expect(NAV_WIDTH_COLLAPSED_PX).toBeLessThan(NAV_WIDTH_EXPANDED_PX);
    /* 方向不能写反：收起换出来的宽度必须够内容区站到下限之上，否则自动收起是
       「收了也白收」的抖动。取阈值那一档（最窄的允许展开宽）来验。 */
    expect(NAV_COLLAPSE_LEAVES_VIEWPORT_PX).toBeGreaterThanOrEqual(
      WORKSPACE_MIN_PX,
    );
  });
});

describe("resolveRailCollapsed 的三档优先", () => {
  it("未表态：跟随窗宽", () => {
    expect(
      resolveRailCollapsed({ narrow: true, crossings: 0, choice: null }),
    ).toBe(true);
    expect(
      resolveRailCollapsed({ narrow: false, crossings: 0, choice: null }),
    ).toBe(false);
  });

  it("窄窗里用户点开：跨越次数没变之前听用户的，不再被纪律按下去", () => {
    expect(
      resolveRailCollapsed({
        narrow: true,
        crossings: 1,
        choice: { open: true, atCrossing: 1 },
      }),
    ).toBe(false);
  });

  it("来回拖窗口（跨越两次）后豁免作废：那条表态不该永久否决纪律", () => {
    /* 用户在窄窗（第 1 次跨越后）点开了导航。窗口放大（第 2 次）、再缩回窄窗
       （第 3 次）—— 表态时的跨越次数已经不等，纪律必须重新接管。 */
    expect(
      resolveRailCollapsed({
        narrow: true,
        crossings: 3,
        choice: { open: true, atCrossing: 1 },
      }),
    ).toBe(true);
    /* 同一表态在宽窗一侧同样不该被拿出来当挡箭牌。 */
    expect(
      resolveRailCollapsed({
        narrow: false,
        crossings: 2,
        choice: { open: false, atCrossing: 1 },
      }),
    ).toBe(false);
  });

  it("宽窗档的表态在宽窗下继续有效（收起就该是收起）", () => {
    expect(
      resolveRailCollapsed({
        narrow: false,
        crossings: 0,
        choice: { open: false, atCrossing: 0 },
      }),
    ).toBe(true);
  });

  it("没有本次表态时，跨会话存下来的偏好只在宽窗生效", () => {
    expect(
      resolveRailCollapsed({
        narrow: false,
        crossings: 0,
        choice: null,
        preferredOpen: false,
      }),
    ).toBe(true);
    /* 窄窗时不能用上次的展开偏好去否决布局纪律。 */
    expect(
      resolveRailCollapsed({
        narrow: true,
        crossings: 0,
        choice: null,
        preferredOpen: true,
      }),
    ).toBe(true);
  });
});

describe("账与真实列宽一致（漂移判据）", () => {
  it("导航两条宽度只在账上出现一次，ui/sidebar 不再写字面量", () => {
    const sidebar = sourceOf(path.join("components", "ui", "sidebar.tsx"));
    expect(sidebar).toContain("`${NAV_WIDTH_EXPANDED_PX}px`");
    expect(sidebar).toContain("`${NAV_WIDTH_COLLAPSED_PX}px`");
    /* 若有人把宽度改回 `"16rem"` 这类字面量，账与屏面就会分叉 —— 阈值不再成立。 */
    expect(sidebar).not.toMatch(/SIDEBAR_WIDTH = "\d/);
    expect(sidebar).not.toMatch(/SIDEBAR_WIDTH_ICON = "\d/);
  });

  it("工坊阶段轨道列宽与 globals 的刻度同源", () => {
    const css = sourceOf(path.join("app", "globals.css"));
    const declared = /--spacing-stage-rail:\s*(\d+(?:\.\d+)?)rem/.exec(css);
    expect(
      declared,
      "globals.css 里找不到 --spacing-stage-rail 的 rem 刻度",
    ).not.toBeNull();
    expect(Number(declared?.[1]) * REM_PX).toBe(STAGE_RAIL_WIDTH_PX);
  });

  it("工坊检查器列宽、列间距与内边距与网格模板一致", () => {
    const pipeline = sourceOf(
      path.join("components", "workshop", "WorkshopPipeline.tsx"),
    );
    /* 网格模板第三列就是检查器宽。 */
    const inspector = /_([0-9.]+)px]/.exec(pipeline);
    expect(inspector, "找不到检查器列宽（网格模板第三列）").not.toBeNull();
    expect(Number(inspector?.[1])).toBe(INSPECTOR_WIDTH_PX);
    /* Tailwind `gap-5` = 1.25rem = 20px，两道列间距；`p-6` = 1.5rem = 24px，左右两侧。 */
    expect(pipeline).toContain("gap-5");
    expect(WORKSHOP_COLUMN_GAP_PX).toBe(20 * 2);
    expect(pipeline).toMatch(/p-6/);
    expect(WORKSHOP_PAGE_PADDING_PX).toBe(24 * 2);
  });
});
