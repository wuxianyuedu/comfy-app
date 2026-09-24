// @vitest-environment jsdom
/**
 * `MultiSegmentPopover` 的**选中态契约**：面板照常开关、点击照常有回调的
 * 前提下，选中高亮是唯一会「静默消失」的一环 —— 它完全由 Tailwind 的
 * 属性选择器表达，而属性名由 base-ui 的 Toggle 决定。
 *
 * base-ui 的 Toggle 输出的是 **`data-pressed`**（`@base-ui/react/toggle` 的
 * `ToggleDataAttributes` 里写着 `const pressed = 'data-pressed'`），不是
 * Radix 时代的 `data-state=on`。写成后者时**没有任何报错**：面板能开、能点、
 * 能回调，只有高亮整体不见（用户实测「尺寸菜单点击选中效果丢失」）。
 *
 * jsdom 不编译 Tailwind，「高亮有没有真的画出来」判不了；能钉的是这对名字
 * 是否一致 —— ① 选项上确实带 `data-pressed`（基元侧），② 选项类名用的是
 * `data-[pressed]:` 而不是永不匹配的 `data-[state=on]:`（我们这侧）。
 * 两条各自拦住一半回归：换基元、或把选择器写回 Radix 口径。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MultiSegmentPopover, type SegmentSection } from "./segment-popover";

afterEach(cleanup);

function ratioSection(
  onChange: (value: string) => void = vi.fn(),
): SegmentSection<string> {
  return {
    label: "比例",
    value: "16:9",
    options: [
      { value: "1:1", label: "1:1" },
      { value: "16:9", label: "16:9" },
    ],
    onChange,
  };
}

/** 打开浮层，并把面板（`data-slot="popover-content"`）返回。 */
function openPanel() {
  render(
    <MultiSegmentPopover
      triggerContent="16:9"
      ariaLabel="尺寸"
      sections={[ratioSection()]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "尺寸" }));
  const panel = document.querySelector('[data-slot="popover-content"]');
  expect(panel, "点开后应当渲染出面板").not.toBeNull();
  return panel!;
}

/** 面板里的某个选项按钮。触发器在面板外，按文案找也不会混淆。 */
function option(panel: Element, label: string): Element {
  const el = Array.from(panel.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === label,
  );
  expect(el, `面板里应当有「${label}」选项`).not.toBeUndefined();
  return el!;
}

describe("MultiSegmentPopover 的选中态", () => {
  it("当前值那一项带 base-ui Toggle 的 data-pressed，未选的不带", () => {
    const panel = openPanel();

    expect(option(panel, "16:9").hasAttribute("data-pressed")).toBe(true);
    expect(option(panel, "1:1").hasAttribute("data-pressed")).toBe(false);
  });

  it("选中态样式用 data-[pressed]:（不是永不匹配的 data-[state=on]:）", () => {
    const panel = openPanel();

    const selected = option(panel, "16:9").className;
    expect(selected).toContain("data-[pressed]:");
    expect(selected).not.toContain("data-[state=");
    /* 高亮的实际观感仍与收口前逐字一致（换的只是属性名，不是样式本身）。 */
    expect(selected).toContain("data-[pressed]:bg-primary/20");
  });
});
