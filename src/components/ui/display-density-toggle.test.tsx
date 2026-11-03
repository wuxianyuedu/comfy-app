/**
 * `DisplayDensityToggle` 的判据（ISSUE #1925 / 规范 16 §16.2.4.75）：语义是单选
 * （`role="radio"` + `aria-checked`，不是 `aria-pressed`），两枚由 `value` 一处驱动；
 * 选中档悬停必须与常态同值，否则 `ghost` 的 `hover:text-foreground` 会把已选中那枚翻色。
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
