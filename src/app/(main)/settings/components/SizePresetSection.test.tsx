/**
 * `SizePresetSection` 的视图判据（ISSUE #3788 / #3948）。
 *
 * 这一节要判的是**这一格界面长什么样**：分区标题旁挂着两枚存放位置徽标、
 * 面板照旧渲染。「保存为项目默认」入口已随 ISSUE #5001 移除（项目默认运行期
 * 只读，改动落本机覆盖）。
 *
 * 断言对齐可见行为（徽标在不在），不锁样式类。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/* 桩里的默认表要在 **hoisted 块内**取（hoisted 代码跑在 import 之前，直接引用
   模块顶层常量会撞 "Cannot access before initialization"）。 */
const controller = await vi.hoisted(async () => {
  const { DEFAULT_SIZE_PRESET_TABLE } = await import("~/lib/media/size-presets");
  return {
    section: {
      defaults: DEFAULT_SIZE_PRESET_TABLE,
      isModified: vi.fn(() => false),
      resetScene: vi.fn(),
      setDims: vi.fn(),
      table: DEFAULT_SIZE_PRESET_TABLE,
    },
  };
});

vi.mock("~/components/studio/workflow-form/hooks/use-size-preset-table", () => ({
  useSizePresetTable: () => controller.section,
}));

import { SizePresetSection } from "./SizePresetSection";

/* 本仓不在 setup 里注册 testing-library 的自动 cleanup（`globals: false`），
   每份用例自己收尾 —— 与同目录其它用例同款。 */
afterEach(cleanup);

describe("SizePresetSection 的分区", () => {
  it("两枚存放位置徽标都在（本机应用数据 + 项目代码库）", () => {
    render(<SizePresetSection />);
    expect(screen.getAllByText("本机应用数据").length).toBeGreaterThan(0);
    expect(screen.getAllByText("项目代码库").length).toBeGreaterThan(0);
  });

  it("不再有「保存为项目默认」入口（项目默认运行期只读，ISSUE #5001）", () => {
    render(<SizePresetSection />);
    expect(screen.queryByRole("button", { name: /保存为项目默认/ })).toBeNull();
  });
});
