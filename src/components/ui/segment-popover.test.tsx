/**
 * `MultiSegmentPopover` 的选中态契约：选中高亮完全由 Tailwind 属性选择器表达，而属性名由 base-ui 的 Toggle 决定。base-ui 输出的是 `data-pressed`（不是 Radix 的 `data-state=on`），写错时没有报错，只有高亮整体消失（用户实测「尺寸菜单点击选中效果丢失」）。
 * jsdom 不编译 Tailwind，只能钉名字一致：选项上带 `data-pressed`，类名用 `data-pressed:` 而不是永不匹配的 `data-[state=on]:`。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MultiSegmentPopover, type SegmentSection } from "./segment-popover";

afterEach(cleanup);

function ratioSection(onChange: (value: string) => void = vi.fn()): SegmentSection {
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
    <MultiSegmentPopover ariaLabel="尺寸" sections={[ratioSection()]} triggerContent="16:9" />,
  );
  fireEvent.click(screen.getByRole("button", { name: "尺寸" }));
  const panel = document.querySelector('[data-slot="popover-content"]');
  expect(panel, "点开后应当渲染出面板").not.toBeNull();
  return panel!;
}

/** 面板里的某个选项按钮。触发器在面板外，按文案找也不会混淆。 */
function option(panel: Element, label: string): HTMLElement {
  const el = [...panel.querySelectorAll<HTMLElement>("button")].find(
    (button) => button.textContent?.trim() === label,
  );
  expect(el, `面板里应当有「${label}」选项`).not.toBeUndefined();
  return el!;
}

describe("MultiSegmentPopover 的选中态", () => {
  it("当前值那一项带 base-ui Toggle 的 data-pressed，未选的不带", () => {
    const panel = openPanel();

    expect(option(panel, "16:9").dataset.pressed !== undefined).toBe(true);
    expect(option(panel, "1:1").dataset.pressed !== undefined).toBe(false);
  });

  it("选中态样式用 data-pressed:（不是永不匹配的 data-[state=on]:）", () => {
    const panel = openPanel();

    const selected = option(panel, "16:9").className;
    expect(selected).toContain("data-pressed:");
    expect(selected).not.toContain("data-[state=");
    /* 高亮的实际观感仍与收口前逐字一致（换的只是属性名，不是样式本身）。 */
    expect(selected).toContain("data-pressed:bg-primary/20");
  });
});
