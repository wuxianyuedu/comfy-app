import { describe, expect, it } from "vitest";

import {
  isDragRegionTarget,
  resolveMaximizeButtonKind,
  shouldUseTitleBarTabs,
  WINDOW_BUTTON_LABELS,
} from "./title-bar-derive";

describe("shouldUseTitleBarTabs", () => {
  it("桌面壳内: 页签搬到窗口标题行（原生标题栏已被 decorations:false 让位）", () => {
    expect(shouldUseTitleBarTabs(true)).toBe(true);
  });

  it("浏览器 / dev: 退回应用内页签栏（窗口由系统浏览器提供, 无标题行可让位）", () => {
    expect(shouldUseTitleBarTabs(false)).toBe(false);
  });
});

describe("isDragRegionTarget", () => {
  it("空白处（不含 data-no-drag 祖先）视为拖拽区", () => {
    const target = {
      closest: (s: string) => (s === "[data-no-drag]" ? null : null),
    };
    expect(isDragRegionTarget(target)).toBe(true);
  });

  it("命中 data-no-drag 祖先时不算拖拽区（页签 / 窗口按钮的点击不被拖拽吞掉）", () => {
    const marker = { tag: "div" };
    const target = {
      closest: (s: string) => (s === "[data-no-drag]" ? marker : null),
    };
    expect(isDragRegionTarget(target)).toBe(false);
  });

  it("target 为空或没有 closest 时安全返回 false", () => {
    expect(isDragRegionTarget(null)).toBe(false);
    expect(isDragRegionTarget({})).toBe(false);
  });

  it("marker 属性名可覆盖", () => {
    const target = {
      closest: (s: string) => (s === "[data-custom]" ? {} : null),
    };
    expect(isDragRegionTarget(target, "data-custom")).toBe(false);
  });
});

describe("resolveMaximizeButtonKind", () => {
  it("未最大化时按钮语义为「最大化」", () => {
    expect(resolveMaximizeButtonKind(false)).toBe("maximize");
  });

  it("已最大化时按钮语义为「还原」", () => {
    expect(resolveMaximizeButtonKind(true)).toBe("restore");
  });
});

describe("WINDOW_BUTTON_LABELS", () => {
  it("三个窗口动作都有可读的中文无障碍标签", () => {
    expect(WINDOW_BUTTON_LABELS.minimize).toBe("最小化");
    expect(WINDOW_BUTTON_LABELS.maximize).toBe("最大化");
    expect(WINDOW_BUTTON_LABELS.restore).toBe("向下还原");
    expect(WINDOW_BUTTON_LABELS.close).toBe("关闭");
  });
});
