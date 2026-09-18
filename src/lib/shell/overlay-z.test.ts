import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { Z } from "./overlay-z";

/**
 * 浮层刻度的回归（规范 16 §16.2.3 P2）。
 *
 * 两条刻度写在**两处**（本模块供行内 `zIndex`，`globals.css` 供
 * `z-overlay` / `z-toast` 工具类）。两处各写一遍数值就是「同一个事实有两个
 * 来源」，改一处忘一处会得到「类名 100、行内 9999」这种谁也说不清的层级。
 * 这里把两条数值钉在一起。
 */
const GLOBALS = join(process.cwd(), "src", "app", "globals.css");

function readToken(name: string): number {
  const css = readFileSync(GLOBALS, "utf8");
  const m = new RegExp(`--z-index-${name}:\\s*(\\d+)`).exec(css);
  if (!m) throw new Error(`globals.css 里找不到 --z-index-${name}`);
  return Number(m[1]);
}

describe("浮层刻度（z-overlay / z-toast）", () => {
  it("globals.css 的 @theme 数值与 Z 常量一致", () => {
    expect(readToken("overlay")).toBe(Z.overlay);
    expect(readToken("toast")).toBe(Z.toast);
  });

  it("toast 恒在 overlay 之上", () => {
    expect(Z.toast).toBeGreaterThan(Z.overlay);
  });

  it("overlay 不进 1000~1200 —— 那是 React Flow 节点选中态(约 1010)与悬浮态(1180)的位置", () => {
    expect(Z.overlay).toBeLessThan(1000);
    expect(Z.overlay).toBeGreaterThan(0);
  });
});
