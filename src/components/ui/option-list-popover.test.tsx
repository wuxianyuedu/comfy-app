/**
 * `OptionListPopover` —— 「一个可滚动的浮层选项列表」的唯一实现
 * （规范 16 §16.2.4.14）。
 *
 * 收口前画布上的四个 chip 各写一份逐行同形的浮层；差别除了重复，还有
 * **「当前项」配色四份各写各的**（`violet-500/20` / `fuchsia-500/20` /
 * `primary-soft` / `bg-accent`）。所以这里既钉行为（点选即回调并收起、
 * 空态、选中项 aria-selected），也钉「选中配色走语义 token」这条口径。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { OptionListPopover } from "./option-list-popover";

afterEach(cleanup);

const TAGS = [
  { value: "all", label: "全部模型" },
  { value: "sdxl", label: "SDXL" },
  { value: "flux", label: "FLUX" },
];

describe("OptionListPopover", () => {
  it("默认收起：选项不在可见树里", () => {
    render(
      <OptionListPopover
        value="all"
        items={TAGS}
        onSelect={vi.fn()}
        trigger="全部模型"
        triggerTitle="筛选"
      />,
    );
    expect(screen.queryByRole("option", { name: /SDXL/ })).toBeNull();
  });

  it("点开后面板里出现全部选项，且是可滚动列表", () => {
    const { container } = render(
      <OptionListPopover
        value="all"
        items={TAGS}
        onSelect={vi.fn()}
        trigger="全部模型"
        triggerTitle="筛选"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /全部模型/ }));
    const panel = screen.getByLabelText("筛选");
    expect(screen.getAllByRole("option")).toHaveLength(3);
    /* 默认给滚动上限 —— 这正是「可滚动的浮层列表」这条账的核心。 */
    expect(panel.className).toContain("overflow-y-auto");
    expect(panel.className).toContain("max-h-72");
    expect(container).toBeTruthy();
  });

  it("选中项带 aria-selected=true，其余为 false", () => {
    render(
      <OptionListPopover
        value="flux"
        items={TAGS}
        onSelect={vi.fn()}
        trigger="FLUX"
        triggerTitle="筛选"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /FLUX/ }));
    expect(screen.getByRole("option", { name: /FLUX/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("option", { name: /SDXL/ })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("点一项即回调该项值并收起面板", () => {
    const onSelect = vi.fn();
    render(
      <OptionListPopover
        value="all"
        items={TAGS}
        onSelect={onSelect}
        trigger="全部模型"
        triggerTitle="筛选"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /全部模型/ }));
    fireEvent.click(screen.getByRole("option", { name: /SDXL/ }));
    expect(onSelect).toHaveBeenCalledWith("sdxl");
    expect(
      screen.queryByRole("option", { name: /SDXL/ }),
      "选中后应收起浮层",
    ).toBeNull();
  });

  it("items 为空时显示 emptyHint", () => {
    render(
      <OptionListPopover
        value="all"
        items={[]}
        onSelect={vi.fn()}
        trigger="全部模型"
        triggerTitle="筛选"
        emptyHint="标签库为空"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /全部模型/ }));
    expect(screen.getByText("标签库为空")).toBeInTheDocument();
  });

  it("选中项配色走语义 token，不落原生调色板字面量", () => {
    render(
      <OptionListPopover
        value="flux"
        items={TAGS}
        onSelect={vi.fn()}
        trigger="FLUX"
        triggerTitle="筛选"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /FLUX/ }));
    const selected = screen.getByRole("option", { name: /FLUX/ });
    /* 此前四份实现各写各的 `violet-500/20` / `fuchsia-500/20` —— 改一处漏三片，
     * 且不受主题 token 控制（规范 03 §3.6.2）。 */
    expect(selected.className).not.toMatch(
      /\b(?:violet|fuchsia|indigo|purple|emerald|amber|rose|sky)-/,
    );
    expect(selected.className).toContain("bg-primary-500/20");
  });

  it("onOpenChange 上报开合（画布变换后关闭的联动靠它）", () => {
    const seen: boolean[] = [];
    render(
      <OptionListPopover
        value="all"
        items={TAGS}
        onSelect={vi.fn()}
        onOpenChange={(open) => seen.push(open)}
        trigger="全部模型"
        triggerTitle="筛选"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /全部模型/ }));
    expect(seen).toEqual([true]);
  });

  it("disabled 时点不开", () => {
    render(
      <OptionListPopover
        value="all"
        items={TAGS}
        onSelect={vi.fn()}
        disabled
        trigger="全部模型"
        triggerTitle="筛选"
      />,
    );
    const trigger = screen.getByRole("button", { name: /全部模型/ });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole("option")).toBeNull();
  });
});
