/**
 * `SidebarTabSection` 的视图判据（ISSUE #3623 / #3798 / #3948）。
 *
 * 这一节要判的是**这一格界面长什么样**：配置面里的每一项都给出两档选择、当前
 * 生效值落在选中态上、**没有「保存」那个按钮**（改一档即存本机）、「还原默认」
 * 只在真有本机覆盖时出现。
 *
 * 断言对齐可见行为（选中态 / 按钮显隐 / 点了之后调了哪个动作），不锁样式类。
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { projectSidebarTabConfig } from "~/lib/shell/sidebar-tab-behavior";
import type { SidebarTabMode } from "~/lib/shell/sidebar-tab-behavior";

const controller = vi.hoisted(() => ({
  section: {
    customized: false,
    draft: null as Record<string, "independent" | "shared"> | null,
    resetToDefault: vi.fn(() => Promise.resolve()),
    resetBusy: false,
    saving: false,
    setMode: vi.fn(),
    status: null as string | null,
  },
}));

vi.mock("../hooks/use-sidebar-tab-section", () => ({
  useSidebarTabSection: () => controller.section,
}));

import { SidebarTabSection } from "./SidebarTabSection";

/* 本仓不在 setup 里注册 testing-library 的自动 cleanup（`globals: false`），
   每份用例自己收尾 —— 与同目录其它用例同款。 */
afterEach(cleanup);

/** 把控制器摆成「没有本机覆盖」的样子（草稿 = 项目默认那份）。 */
function seedController(options?: { customized?: boolean }) {
  controller.section.draft = { ...projectSidebarTabConfig() };
  controller.section.customized = options?.customized ?? false;
  controller.section.status = null;
}

/** 某一项的那一组单选（可访问名 = 「<项名>的页签行为」）。 */
function groupOf(label: string): HTMLElement {
  const group = screen
    .getAllByRole("radiogroup")
    .find((g) => g.getAttribute("aria-label") === `${label}的页签行为`);
  if (!group) {
    throw new Error(`找不到「${label}的页签行为」radiogroup`);
  }
  return group;
}

/** 组内选中的是哪一档（按选项顺序：独立 / 共享）。 */
function checkedMode(label: string): string | null {
  const checked = within(groupOf(label))
    .getAllByRole("radio")
    .find((radio) => radio.getAttribute("aria-checked") === "true");
  return checked?.textContent ?? null;
}

describe("SidebarTabSection 的配置面", () => {
  it("配置面里的每一项都给出两档选择，且当前生效值落在选中态上", () => {
    seedController();
    render(<SidebarTabSection />);
    // 十五项全局视图（首页是固定页签，不在配置面内）；设置与 UI 控件总览也算在内
    expect(screen.getAllByRole("radiogroup")).toHaveLength(15);
    expect(checkedMode("模型适配")).toBe("独立标签页");
    expect(checkedMode("模型")).toBe("共享标签页");
    /* ISSUE #3798：非侧栏的两屏出现在配置面里；出厂默认两屏都是共享档。 */
    expect(checkedMode("设置")).toBe("共享标签页");
    expect(checkedMode("UI 控件总览")).toBe("共享标签页");
    /* ISSUE #4868：资产库转正后同走一份配置，默认独立标签页。 */
    expect(checkedMode("资产库")).toBe("独立标签页");
    /* ISSUE #5009：角色库与资产库同族，默认独立标签页。 */
    expect(checkedMode("角色库")).toBe("独立标签页");
    /* ISSUE #5069：风格库同族，默认独立标签页。 */
    expect(checkedMode("风格库")).toBe("独立标签页");
    /* ISSUE #5087：脸库同族，默认独立标签页。 */
    expect(checkedMode("脸库")).toBe("独立标签页");
  });

  it("非侧栏的「UI 控件总览」也能逐项改（ISSUE #3798）", async () => {
    const user = userEvent.setup();
    seedController();
    controller.section.setMode.mockClear();
    render(<SidebarTabSection />);

    /* 出厂默认是共享档：点另一档（独立）才是一次真改动。 */
    const independent = within(groupOf("UI 控件总览")).getAllByRole("radio")[0];
    if (!independent) {
      throw new Error("「UI 控件总览」组里没有第一个 radio");
    }
    await user.click(independent);

    expect(controller.section.setMode).toHaveBeenCalledTimes(1);
    expect(controller.section.setMode.mock.calls[0]).toEqual([
      "uiKit",
      "independent" satisfies SidebarTabMode,
    ]);
  });

  it("改一档只把那一项交出去（逐项的）", async () => {
    const user = userEvent.setup();
    seedController();
    controller.section.setMode.mockClear();
    render(<SidebarTabSection />);

    /* 出厂默认是共享档：点另一档（独立）才是一次真改动。 */
    const independent = within(groupOf("模型")).getAllByRole("radio")[0];
    if (!independent) {
      throw new Error("「模型」组里没有第一个 radio");
    }
    await user.click(independent);

    expect(controller.section.setMode).toHaveBeenCalledTimes(1);
    const call = controller.section.setMode.mock.calls[0];
    expect(call?.[0]).toBe("models");
    expect(call?.[1]).toBe("independent" satisfies SidebarTabMode);
  });

  it("没有「保存」那个按钮了（改一档即存本机，ISSUE #3948）", () => {
    seedController();
    render(<SidebarTabSection />);
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
  });

  it("没有本机覆盖时不出现「还原默认」（给一个点不动的按钮不如不给）", () => {
    seedController({ customized: false });
    render(<SidebarTabSection />);
    expect(screen.queryByRole("button", { name: "还原默认" })).toBeNull();
  });

  it("有本机覆盖时出现「还原默认」，点了就调还原那个动作", async () => {
    const user = userEvent.setup();
    seedController({ customized: true });
    controller.section.resetToDefault.mockClear();
    render(<SidebarTabSection />);

    await user.click(screen.getByRole("button", { name: "还原默认" }));
    expect(controller.section.resetToDefault).toHaveBeenCalledTimes(1);
  });

  it("上一次动作的结果念在卡片里", () => {
    seedController();
    controller.section.status = "已保存 —— 只落在这台机器上，不会跟着代码走。";
    render(<SidebarTabSection />);
    expect(screen.getByText(/已保存/)).toBeTruthy();
  });
});
