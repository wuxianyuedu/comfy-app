/**
 * 虚拟列表 scrollMargin 的回归守卫（#5132）：#5121 曾把它改成「ref 回调里量
 * 一次 offsetTop」，但那一刻布局未定，量到 0 后不再更新，虚拟项整体偏移，
 * 现场是「排队中」列表顶部一大块空白、只露出最后一行。
 *
 * jsdom 里 offsetTop 恒 0，行为用例抓不到；这里钉住已验证的写法。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const files = [
  "src/components/studio/queue/QueueRowVirtualList.tsx",
  "src/components/studio/history/HistoryVirtualCardGrid.tsx",
];

describe("虚拟列表 scrollMargin 取真实布局（#5132）", () => {
  for (const file of files) {
    it(`${file} 在 render 期读 offsetTop，不在 ref 回调里量一次`, () => {
      const src = fs.readFileSync(path.join(ROOT, file), "utf8");
      expect(src).toContain("listRef.current?.offsetTop ?? 0");
      expect(src).not.toContain("setScrollMargin");
    });
  }
});
