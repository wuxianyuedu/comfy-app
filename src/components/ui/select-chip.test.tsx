import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { SelectChip } from "./select-chip";

afterEach(cleanup);

/**
 * `SelectChip` 的判据（ISSUE #1423 / 规范 16 §16.2.4）。
 *
 * 这组用例钉的是**一个只在浏览器里看得见的 bug**：`Button variant="outline"`
 * 自带 `hover:text-foreground`，而收口前各处手写的选中分支只给了
 * `border-primary text-primary bg-primary/10` —— 于是划到**已选中**的那一枚上，
 * 字色翻白、底色翻灰（用户原话「按钮的选中状态悬浮和非悬浮一个紫色，一个白色」）。
 *
 * jsdom 不算 `:hover`，所以这里**判不了像素**；判的是那个真正决定成败的形态：
 * 选中档必须**自带**与常态同值的 `hover:` 覆盖。少了它，浏览器里的悬停就会
 * 落回 `buttonVariants` 的默认悬停档。真浏览器的计算值读数见 PR 描述
 * （选中·悬浮 = 选中·非悬浮）。
 */
function classesOf(el: HTMLElement): string {
  return el.className;
}

/**
 * 按**类名 token** 拆，不按子串包含判 —— 这是本仓库记过多次的一个坑
 * （见 `LogPanel.test.tsx` 的同一段注释）：`aria-checked:hover:bg-primary-soft`
 * 里**包含** `hover:bg-primary-soft` 这串字符，子串判据分不出「裸类」与
 * 「带变体前缀的类」，会把带前缀的当成裸类。 */
function tokensOf(el: HTMLElement): Set<string> {
  return new Set(el.className.split(/\s+/));
}

describe("SelectChip", () => {
  it("选中档把悬停值钉回常态（否则会被 Button 的默认悬停档吃掉）", () => {
    render(
      <SelectChip selected data-testid="chip">
        文生图
      </SelectChip>,
    );
    const cls = classesOf(screen.getByTestId("chip"));

    /* 选中态的四层：底色 / 字色 / 描边 / 字重 —— 任意一层失效仍读得出「选中」。 */
    expect(cls).toContain("aria-checked:bg-primary-soft");
    expect(cls).toContain("aria-checked:text-primary-strong");
    expect(cls).toContain("aria-checked:border-primary");
    expect(cls).toContain("aria-checked:font-semibold");

    /* 关键的那一条：选中档自己带 hover 覆盖。
     * 它是**未选中档** `hover:bg-subtle hover:text-ink` 的选中版 —— 若少了它，
     * `outline` 变体的 `hover:*` 会在悬停时胜出。 */
    expect(cls).toContain("aria-checked:hover:bg-primary-soft");
    expect(cls).toContain("aria-checked:hover:text-primary-strong");
  });

  it("未选中档给出与选中档**不同**的悬停值（悬停不能长得像选中）", () => {
    render(<SelectChip data-testid="chip">文生图</SelectChip>);

    const tokens = tokensOf(screen.getByTestId("chip"));
    expect(tokens.has("hover:bg-subtle")).toBe(true);
    expect(tokens.has("hover:text-ink")).toBe(true);
    /* 悬停底色**裸类**不是选中底色 —— 否则「划过一项」与「选中一项」在同屏里
     * 没有区别（`ui/toggle-group` 记过同一件事，见 §16.8 台账）。
     * 注意判的是裸 token：`aria-checked:hover:*` 是选中档自己的悬停、
     * 正是本次要的那一条，不能被这一断言误伤。 */
    expect(tokens.has("hover:bg-primary-soft")).toBe(false);
  });

  it("选中语义落到 aria-checked 上，且视觉与语义由同一个入参驱动", () => {
    const { rerender } = render(
      <SelectChip selected={false} data-testid="chip">
        甲
      </SelectChip>,
    );
    const chip = screen.getByTestId("chip");
    expect(chip).toHaveAttribute("role", "radio");
    expect(chip).toHaveAttribute("aria-checked", "false");

    rerender(
      <SelectChip selected data-testid="chip">
        甲
      </SelectChip>,
    );
    expect(screen.getByTestId("chip")).toHaveAttribute("aria-checked", "true");
  });

  it("四种形态各自带自己的形状档（圆形胶囊 / 方角分段 / 紧凑 / 虚线动作）", () => {
    const shapes = [
      {
        shape: /* SAFETY: 类型断言已复核 */ "pill" as const,
        expect: "rounded-full",
      },
      {
        shape: /* SAFETY: 类型断言已复核 */ "segment" as const,
        expect: "rounded-lg",
      },
      {
        shape: /* SAFETY: 类型断言已复核 */ "compact" as const,
        expect: "rounded",
      },
      {
        shape: /* SAFETY: 类型断言已复核 */ "dashed" as const,
        expect: "border-dashed",
      },
    ];
    for (const { shape, expect: token } of shapes) {
      const { unmount } = render(
        <SelectChip shape={shape} data-testid="chip">
          x
        </SelectChip>,
      );
      expect(classesOf(screen.getByTestId("chip"))).toContain(token);
      unmount();
    }
  });

  it("虚线档是「动作」不是「选中」：底色透明、不参与选中态配色", () => {
    render(
      <SelectChip shape="dashed" data-testid="chip">
        ＋ 添加
      </SelectChip>,
    );
    const cls = classesOf(screen.getByTestId("chip"));
    expect(cls).toContain("bg-transparent");
    expect(cls).not.toContain("aria-checked:bg-primary-soft");
  });

  it("调用处的 className 压得过形态档（cn 让调用处取胜）", () => {
    render(
      <SelectChip shape="pill" className="text-sm" data-testid="chip">
        x
      </SelectChip>,
    );
    /* 同族属性（font-size）由调用处的值胜出；`cn` 会摘掉同组的前一个。 */
    const cls = classesOf(screen.getByTestId("chip"));
    expect(cls).toContain("text-sm");
    expect(cls).not.toContain("text-xs");
  });
});
