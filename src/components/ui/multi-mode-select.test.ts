/** 「选择模式」弹层底部按钮被裁的回归判据（ISSUE #4073 复审第 1 条）。
 * happy-dom 不做布局，base-ui Positioner 的 `--available-height` 不会算出来，
 * 因此判据取**契约**而非像素：弹层高度必须跟着定位器给出的可用空间收缩，
 * 候选列表是唯一可滚区，页头 / 页签 / 底栏不许一起被压扁。
 * 同 `dialog-width.test.ts` 的口径：源码先剥注释再判，注释里提到旧写法不算复活。 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "../../../tests/helpers/strip-comments";

const source = stripComments(
  readFileSync(path.resolve(__dirname, "multi-mode-select.tsx"), "utf8"),
);

describe("选择模式弹层的可用高度", () => {
  it("弹层按定位器的 --available-height 限高，不再写死 85vh", () => {
    expect(source).toContain("max-h-(--available-height)");
    expect(source).not.toContain("OVERLAY_MAX_HEIGHT");
    expect(source).not.toContain("max-h-[85vh]");
  });

  it("候选列表是唯一滚动区，搜索 / 页签 / 底栏都不可压缩", () => {
    expect(source).toContain("min-h-0 flex-1 overflow-y-auto");
    expect(source.match(/shrink-0/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
