/**
 * `DisplayDensityToggle` 的判据（ISSUE #1925 / 规范 16 §16.2.4.75）。
 *
 * 收口前「网格 / 列表」这一排全库有**三份逐字相同**的手搓实现
 * （画布历史抽屉 / 画布素材抽屉 / 素材库）。它们坏在同一个**看不见的接缝**：
 * 选中档只写了底色 `bg-surface-2`，**没钉字色悬停** —— `ghost` 变体自带的
 * `hover:text-foreground` 会在划过已选中那枚时把字色翻掉，看着像「未选中」；
 * 而 `bg-surface-2` 在浅色主题下与行头底色近值，本来就弱。
 *
 * 这组用例钉三件事：语义是**单选**（不是 `aria-pressed` 开关）、两枚的
 * `aria-checked` 由 `value` 一处驱动、以及**基元自己带**与常态同值的
 * 选中档悬停（少了它浏览器里的悬停会落回 `buttonVariants` 的默认档）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { DisplayDensityToggle } from "./display-density-toggle";

afterEach(cleanup);

function renderToggle(value: "grid" | "list") {
  const onChange = vi.fn();
  render(<DisplayDensityToggle onChange={onChange} value={value} />);
  return { onChange };
}

describe("DisplayDensityToggle", () => {
  it("语义是单选（radiogroup + radio + aria-checked），不是 aria-pressed 开关", () => {
    renderToggle("grid");

    const group = screen.getByRole("radiogroup", { name: "显示密度" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(2);
    for (const radio of radios) {
      expect(radio).not.toHaveAttribute("aria-pressed");
    }
    expect(screen.getByRole("radio", { name: "网格视图" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "列表视图" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("两枚的选中态由 value 一处驱动（只有一枚为真）", () => {
    const { rerender } = render(<DisplayDensityToggle onChange={() => undefined} value="list" />);
    expect(screen.getByRole("radio", { name: "列表视图" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "网格视图" })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    /* 换一档后两枚跟着对调 —— 旧实现里 `active` 与可见底色是两份各自算的，
     * 很容易只改一半。 */
    rerender(<DisplayDensityToggle onChange={() => undefined} value="grid" />);
    expect(screen.getByRole("radio", { name: "网格视图" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "列表视图" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("选中档把悬停值钉回常态（否则被 Button 的默认悬停档吃掉）", () => {
    renderToggle("grid");

    const grid = screen.getByRole("radio", { name: "网格视图" });
    /* 选中档自带与常态同值的 hover —— 悬停是瞬时的、选中是持久的，
     * 持久状态不该被瞬时状态改写。 */
    expect(grid.className).toContain("aria-checked:hover:bg-primary-soft");
    expect(grid.className).toContain("aria-checked:hover:text-primary-strong");
    /* 选中态四层俱在（底色 / 字色 / 描边 / 字重），任意一层失效仍读得出。 */
    expect(grid.className).toContain("aria-checked:bg-primary-soft");
    expect(grid.className).toContain("aria-checked:text-primary-strong");
    expect(grid.className).toContain("aria-checked:border-primary");
    expect(grid.className).toContain("aria-checked:font-semibold");
  });

  it("点另一半换档（回调带目标档位）", () => {
    const { onChange } = renderToggle("grid");
    screen.getByRole("radio", { name: "列表视图" }).click();
    expect(onChange).toHaveBeenCalledWith("list");
  });
});
