/**
 * `SizePresetSection` 的视图判据（ISSUE #3788 / #3948）。
 *
 * 这一节要判的是**这一格界面长什么样**：分区标题旁挂着两枚存放位置徽标、
 * 面板照旧渲染，而「保存为项目默认（跟代码走）」那个入口**只在开发检出出现**
 * （正式包没有源码可写，给一个点不动的按钮不如不给）。
 *
 * 断言对齐可见行为（徽标在不在 / 按钮显隐 / 点了之后调了哪个动作），不锁样式类。
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/* 桩里的默认表要在 **hoisted 块内**取（hoisted 代码跑在 import 之前，直接引用
   模块顶层常量会撞 "Cannot access before initialization"）。 */
const controller = await vi.hoisted(async () => {
  const { DEFAULT_SIZE_PRESET_TABLE } = await import("~/lib/media/size-presets");
  return {
    section: {
      defaults: DEFAULT_SIZE_PRESET_TABLE,
      isModified: vi.fn(() => false),
      projectDefaultEditable: false,
      resetScene: vi.fn(),
      saveAsProjectDefaults: vi.fn(() => Promise.resolve("")),
      savingProjectDefaults: false,
      setDims: vi.fn(),
      status: null as string | null,
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
  it("正式包不给「保存为项目默认」这个出口（没有源码可写）", () => {
    controller.section.projectDefaultEditable = false;
    render(<SizePresetSection />);
    expect(screen.queryByRole("button", { name: /保存为项目默认/ })).toBeNull();
  });

  it("开发检出给出「保存为项目默认」这个出口，点了就调那个动作", async () => {
    const user = userEvent.setup();
    controller.section.projectDefaultEditable = true;
    controller.section.saveAsProjectDefaults.mockClear();
    render(<SizePresetSection />);

    const button = screen.getByRole("button", { name: /保存为项目默认/ });
    await user.click(button);

    expect(controller.section.saveAsProjectDefaults).toHaveBeenCalledTimes(1);
  });

  it("两枚存放位置徽标都在（本机应用数据 + 项目代码库）", () => {
    controller.section.projectDefaultEditable = false;
    render(<SizePresetSection />);
    expect(screen.getAllByText("本机应用数据").length).toBeGreaterThan(0);
    expect(screen.getAllByText("项目代码库").length).toBeGreaterThan(0);
  });
});
