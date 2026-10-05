// @vitest-environment jsdom
/**
 * 序号圆 —— 从工坊五个界面里逐字相同的那一枚抽出来的件。
 *
 * 判三件事，都是「抽取会不会改变渲染」这一类：
 *   · 内容就是传进来的序号（不是组件自己算的 —— 调用点有 `i + 1` 也有 `shot.index`，
 *     两种编号来源必须都能原样落进圆里）；
 *   · 两档尺寸各自落在 `size-6` / `size-7` 上，且**默认是 sm**（五处里四处是 24px）；
 *   · 必须自带 `grid`：契约 §Components「基元纪律 2」——`size-*` 对 `display: inline`
 *     不生效，丢了 grid 这个圆会变成一条约 4×20px 的竖线，而五处原来都恰好嵌在
 *     flex 容器里才「碰巧」成立，看不出问题。
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IndexDot } from "./IndexDot";

describe("IndexDot", () => {
  it("渲染传进来的序号，两种编号来源都原样落进圆里", () => {
    const { rerender } = render(<IndexDot index={3} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    rerender(<IndexDot index={12} />);
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("缺省 sm = size-6；lg = size-7（两档各自只出一颗尺寸类）", () => {
    render(<IndexDot index={1} />);
    const sm = screen.getByText("1");
    expect(sm).toHaveClass("size-6");
    expect(sm).not.toHaveClass("size-7");

    const { rerender } = render(<IndexDot index={2} size="lg" />);
    const lg = screen.getByText("2");
    expect(lg).toHaveClass("size-7");
    expect(lg).not.toHaveClass("size-6");
    rerender(<IndexDot index={2} size="sm" />);
    expect(screen.getByText("2")).toHaveClass("size-6");
  });

  it("自带非行内 display（grid）与 shrink-0，且语义色类只有一份出处", () => {
    render(<IndexDot index={7} />);
    const dot = screen.getByText("7");
    expect(dot).toHaveClass("grid", "place-items-center", "shrink-0");
    expect(dot).toHaveClass("bg-primary-soft", "text-primary", "rounded-full");
  });

  it("className 追加在末尾 —— 调用点要能盖掉缺省（tailwind-merge 后面的赢）", () => {
    render(<IndexDot index={9} className="size-8" />);
    const dot = screen.getByText("9");
    expect(dot).toHaveClass("size-8");
    expect(dot).not.toHaveClass("size-6");
  });
});
