import { describe, expect, it } from "vitest";

import {
  FULL_SCREEN_LAYER_CLASS,
  TITLE_BAR_HEIGHT_CLASS,
  TITLE_BAR_HEIGHT_REM,
  TITLE_BAR_HEIGHT_VAR,
  TITLE_BAR_TOP_CLASS,
  fullScreenLayerClass,
} from "./full-screen-layer";

describe("全屏视图层定位（ISSUE #310 回归）", () => {
  it("让出窗口标题行：顶部用 top-title-bar，而不是 inset-0", () => {
    // `fixed inset-0` 会把标题行里的页签整条盖住 —— 用户从此看不到、也切不回
    // 其它页签。这是本 ISSUE 的回归点，锁定为显式断言。
    expect(FULL_SCREEN_LAYER_CLASS).not.toContain("inset-0");
    expect(FULL_SCREEN_LAYER_CLASS).toContain("top-title-bar");
  });

  it("四边都锚定：铺满标题行下方的内容区（底部必须显式 bottom-0）", () => {
    // 只用 top/left/right 会靠内容高度撑开，全屏视图需要被拉伸到内容区高度。
    expect(FULL_SCREEN_LAYER_CLASS).toContain("top-title-bar");
    expect(FULL_SCREEN_LAYER_CLASS).toContain("bottom-0");
    expect(FULL_SCREEN_LAYER_CLASS).toContain("right-0");
    expect(FULL_SCREEN_LAYER_CLASS).toContain("left-0");
  });

  it("标题行高度与 CSS 变量同源（改高度时两处一起改）", () => {
    // tailwind v4 只有 `--spacing-<name>` 命名空间会生成 `top-<name>` 工具类；
    // 自定义名（如 --title-bar-height）产出 0 个类，全屏视图会静默退回 top:auto
    // 而被标题行盖住 —— 把这条约束钉在测试里，防止改回自定义名。
    expect(TITLE_BAR_HEIGHT_VAR).toBe("--spacing-title-bar");
    expect(TITLE_BAR_HEIGHT_VAR.startsWith("--spacing-")).toBe(true);
    expect(TITLE_BAR_TOP_CLASS).toBe("top-title-bar");
    expect(TITLE_BAR_HEIGHT_CLASS).toBe("h-title-bar");
    expect(TITLE_BAR_HEIGHT_REM).toBe("2.25rem");
    // 让位用的 top 类必须与标题行自身高度类同源。
    expect(FULL_SCREEN_LAYER_CLASS).toContain(TITLE_BAR_TOP_CLASS);
  });
});

describe("fullScreenLayerClass", () => {
  it("拼接定位 + z-index + 视图自身布局", () => {
    expect(fullScreenLayerClass("z-50", "flex flex-col bg-bg")).toBe(
      `${FULL_SCREEN_LAYER_CLASS} z-50 flex flex-col bg-bg`,
    );
  });

  it("zClass 与 extra 都可省，且不产生重复空格", () => {
    expect(fullScreenLayerClass("z-10020")).toBe(
      `${FULL_SCREEN_LAYER_CLASS} z-10020`,
    );
    expect(fullScreenLayerClass("z-50", "")).toBe(
      `${FULL_SCREEN_LAYER_CLASS} z-50`,
    );
  });
});
