/**
 * `AppearanceSection` 的单选组键盘契约（规范 06 §6.12 的「复合控件 ⇄ 键盘契约」）。
 *
 * 本批之前这里手写 `role="radiogroup"` + `role="radio"`：读屏知道「这是个
 * 单选组」，但**组内方向键没人给**（Tab 进得来、聚焦得到、Arrow 没反应），
 * 而 ARIA 的 radiogroup 契约要求方向键在组内移动并选中、且只有选中项
 * 留在 Tab 序列里（roving tabindex）。
 *
 * 断言对齐可见行为：`role` / `aria-checked` / `tabindex` / 方向键后的选中变化，
 * 不锁样式类。
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReadySettingsPageController } from "../hooks/use-settings-page";

import { AppearanceSection } from "./AppearanceSection";

/* 本仓不在 setup 里注册 testing-library 的自动 cleanup（`globals: false`），
   每份用例自己收尾 —— 与 RuntimeLogBox.test.tsx 同款。 */
afterEach(cleanup);

/** 本分区只消费 `theme` / `setTheme` 两个字段，其余字段与本节无关。 */
function controller(
  theme: "light" | "dark",
  setTheme = vi.fn(),
): ReadySettingsPageController {
  return { theme, setTheme } as unknown as ReadySettingsPageController;
}

/** 主题外观那一组（本分区还有「圆角」「标题字阶」两组，同为 radiogroup）。 */
function themeGroup(): HTMLElement {
  const group = screen
    .getAllByRole("radiogroup")
    .find((g) => g.getAttribute("aria-label") === "主题外观");
  if (!group) throw new Error("找不到「主题外观」radiogroup");
  return group;
}

/** 组内的第 n 个 radio —— `getAllByRole` 的元素带 `undefined`，逐个取要显式收窄。 */
function radioAt(n: number): HTMLElement {
  const radio = within(themeGroup()).getAllByRole("radio")[n];
  if (!radio) throw new Error(`「主题外观」组里没有第 ${n} 个 radio`);
  return radio;
}

describe("AppearanceSection 的单选组键盘契约", () => {
  it("主题卡是 radio、选中态落在 aria-checked 上", () => {
    render(<AppearanceSection c={controller("dark")} />);
    expect(within(themeGroup()).getAllByRole("radio")).toHaveLength(2);
    expect(radioAt(0)).toHaveAttribute("aria-checked", "true");
    expect(radioAt(1)).toHaveAttribute("aria-checked", "false");
  });

  it("只有选中项留在 Tab 序列里（roving tabindex）", () => {
    render(<AppearanceSection c={controller("light")} />);
    expect(radioAt(0)).toHaveAttribute("tabindex", "-1");
    expect(radioAt(1)).toHaveAttribute("tabindex", "0");
  });

  it("方向键在组内移动并选中（这是本批补上的契约）", async () => {
    const user = userEvent.setup();
    const setTheme = vi.fn();
    render(<AppearanceSection c={controller("dark", setTheme)} />);
    await user.click(radioAt(0));
    await user.keyboard("{ArrowDown}");

    expect(setTheme).toHaveBeenCalledWith("light");
  });

  it("三组都带可访问名（否则读屏只念出一串 radio）", () => {
    render(<AppearanceSection c={controller("dark")} />);
    const labels = screen
      .getAllByRole("radiogroup")
      .map((g) => g.getAttribute("aria-label"));
    expect(labels).toEqual(["主题外观", "圆角", "标题字阶"]);
  });
});
