import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { Z, zClass } from "./overlay-z";

/**
 * 浮层刻度表的回归（规范 16 §16.2.5）。
 *
 * 刻度写在**两处**（本模块供行内 `zIndex`，`globals.css` 的 `@theme` 供
 * `z-modal` / `z-popup` 这类工具类）。两处各写一遍数值就是「同一个事实有两个
 * 来源」，改一处忘一处会得到「类名 100、行内 9999」这种谁也说不清的层级。
 * 这里把两处钉在一起，并把**档与档之间的关系**断言成契约 —— 关系才是使用方
 * 真正依赖的东西（「模态要压过画布 chrome」「挂在 body 的下拉要压过模态」）。
 */
const GLOBALS = join(process.cwd(), "src", "app", "globals.css");

function readToken(name: string): number {
  const css = readFileSync(GLOBALS, "utf8");
  const m = new RegExp(`--z-index-${name}:\\s*(\\d+)`).exec(css);
  if (!m) throw new Error(`globals.css 里找不到 --z-index-${name}`);
  return Number(m[1]);
}

describe("浮层刻度表（规范 16 §16.2.5）", () => {
  it.for([
    ["base", Z.base],
    ["canvas-ui", Z.canvasUi],
    ["canvas-max", Z.canvasMax],
    ["modal", Z.modal],
    ["popup", Z.popup],
    ["overlay", Z.overlay],
    ["toast", Z.toast],
    ["chrome", Z.chrome],
  ] as const)("globals.css 的 --z-index-%s 与 Z 常量一致", ([token, value]) => {
    expect(readToken(token)).toBe(value);
  });

  it("档与档之间严格递增（相邻相等 = 层叠顺序由 DOM 决定，即『时灵时不灵』）", () => {
    const scale: number[] = [
      Z.base,
      Z.canvasUi,
      Z.canvasMax,
      Z.modal,
      Z.popup,
      Z.toast,
      Z.chrome,
    ];
    for (let i = 1; i < scale.length; i += 1) {
      const lo = scale[i - 1] ?? Number.NaN;
      const hi = scale[i] ?? Number.NaN;
      expect(hi).toBeGreaterThan(lo);
    }
  });

  it("overlay 是 modal 的旧名（同值别名，不是第二档）", () => {
    expect(Z.overlay).toBe(Z.modal);
  });

  it("modal 不进 1000~1200 —— 那是 React Flow 节点选中态(约 1010)与悬浮态(1180)的位置", () => {
    expect(Z.modal).toBeLessThan(1000);
    expect(Z.modal).toBeGreaterThan(0);
  });

  it("popup 高于 modal —— 挂在 body 的下拉由模态内的控件打开，低于模态就点不中", () => {
    expect(Z.popup).toBeGreaterThan(Z.modal);
  });

  it("toast 高于所有浮层", () => {
    expect(Z.toast).toBeGreaterThan(Z.modal);
    expect(Z.toast).toBeGreaterThan(Z.popup);
  });

  it("chrome 严格高于其余每一档 —— 标题行的可点性由层级保证（ISSUE #310 第三次回归）", () => {
    /* 几何让位（top-title-bar）只保证标题行「不被盖住 / 压暗」，挡不住第三方
     * 往 body 注入的整视口遮罩（base-ui 的 InternalBackdrop 是 fixed inset-0 +
     * z-index auto + pointer-events auto）。标题行若与任何一档相等或更低，
     * 「设置页启动日志全屏后窗口按钮点不动」就会原样复现。 */
    const others: Array<[string, number]> = [
      ["base", Z.base],
      ["canvasUi", Z.canvasUi],
      ["canvasMax", Z.canvasMax],
      ["modal", Z.modal],
      ["overlay", Z.overlay],
      ["popup", Z.popup],
      ["toast", Z.toast],
    ];
    for (const [name, value] of others) {
      expect(Z.chrome, `chrome 必须高于 ${name}`).toBeGreaterThan(value);
    }
  });

  it("zClass 把驼峰档名转成 kebab 工具类名", () => {
    /* 工具类名由档名派生 —— 手抄一份 `z-*` 字符串表等于第二个真源。 */
    expect(zClass("base")).toBe("z-base");
    expect(zClass("canvasUi")).toBe("z-canvas-ui");
    expect(zClass("canvasMax")).toBe("z-canvas-max");
    expect(zClass("popup")).toBe("z-popup");
    expect(zClass("modal")).toBe("z-modal");
    expect(zClass("toast")).toBe("z-toast");
    expect(zClass("chrome")).toBe("z-chrome");
  });
});
