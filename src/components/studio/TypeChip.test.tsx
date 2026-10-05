// @vitest-environment jsdom
/**
 * 类型 chip —— 从 studio 六个文件里逐字抄了十份的那一枚。
 *
 * 判的四件事都是「抽取会不会改变渲染」：
 *   · 三档字号各自只出一档（`xs`/`sm` = 10px 两档内距不同、`md` = 12px），
 *     且**缺省是 sm**（四处用的那一档）；
 *   · `tone="none"` 必须一个颜色类都不加 —— 那四处靠 `portChipStyle()` 的行内
 *     样式上色，缺省的 `bg-border-strong` 漏出来就会改底色；
 *   · `style` 原样落到节点上（调用点传的是 `{fontFamily, ...chipStyle}`）；
 *   · `className` 追加在末尾，能被调用点覆盖（tailwind-merge 后面的赢）。
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TypeChip } from "./TypeChip";

describe("TypeChip", () => {
  it("三档字号互斥，缺省落在 sm（10px + px-1.5 py-0.5）", () => {
    const { rerender } = render(<TypeChip>INT</TypeChip>);
    const sm = screen.getByText("INT");
    expect(sm).toHaveClass("text-3xs", "px-1.5", "py-0.5");
    expect(sm).not.toHaveClass("text-[12px]", "px-1");

    rerender(<TypeChip size="md">FLT</TypeChip>);
    const md = screen.getByText("FLT");
    expect(md).toHaveClass("text-[12px]", "px-1.5", "py-0.5");
    expect(md).not.toHaveClass("text-3xs");

    rerender(<TypeChip size="xs">IMG</TypeChip>);
    const xs = screen.getByText("IMG");
    expect(xs).toHaveClass("text-3xs", "px-1", "py-px");
    expect(xs).not.toHaveClass("px-1.5");
  });

  it("形状类只有一份出处：inline-flex + shrink-0 + rounded-[3px] + font-semibold", () => {
    render(<TypeChip size="md">STR</TypeChip>);
    expect(screen.getByText("STR")).toHaveClass(
      "inline-flex",
      "shrink-0",
      "items-center",
      "rounded-[3px]",
      "font-semibold",
    );
  });

  it('tone="none" 一个颜色类都不加（颜色整个交给行内样式）', () => {
    render(
      <TypeChip tone="none" style={{ background: "rgb(1 2 3 / 10%)" }}>
        VEC
      </TypeChip>,
    );
    const chip = screen.getByText("VEC");
    expect(chip).not.toHaveClass("bg-border-strong", "text-ink-muted");
    expect(chip.getAttribute("style")).toContain("background");
  });

  it('tone="neutral"（缺省）给出随主题的底色与文字档', () => {
    render(<TypeChip>ANY</TypeChip>);
    const chip = screen.getByText("ANY");
    expect(chip).toHaveClass("bg-border-strong", "text-ink-muted");
    /* 颜色档与字号档必须**同时**留着：`cn()` 把不认识的 `text-<名字>` 归进颜色组，
       于是 `text-ink-muted` 会把字号类吃掉（这串类名里字号排在颜色之前，正是那个
       形状）—— 上一轮 4 条 StatusBadge 用例红就是它。`3xs` 是 t-shirt 形状、落在
       font-size 组才成立，这条就是那件事的现场凭证。 */
    expect(chip).toHaveClass("text-3xs");
  });

  it("className 追加在末尾 —— 调用点要能盖掉缺省形状", () => {
    render(<TypeChip className="rounded-[5px]">T</TypeChip>);
    const chip = screen.getByText("T");
    expect(chip).toHaveClass("rounded-[5px]");
    expect(chip).not.toHaveClass("rounded-[3px]");
  });
});
