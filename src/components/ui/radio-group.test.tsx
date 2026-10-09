import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { RadioGroup, RadioGroupItem } from "./radio-group";

afterEach(cleanup);

/**
 * 「选项文字真的渲染出来」这条边界此前没有执行者。
 *
 * `RadioGroupItem` 的 JSX children 是基元自己的 indicator（同一位置），而 JSX
 * children 会整个盖掉 `props.children` —— 于是调用方写的选项文字全被吞掉，
 * 只剩一个空壳 radio：`role` / `aria-checked` / `tabindex` 全部照旧正确，
 * 只有**可访问名与可见文字**不见了。既有用例（`AppearanceSection.test.tsx`）
 * 判的正是前者，所以它一路全绿而界面是坏的。
 *
 * 判据必须落在「文字在不在、可访问名能不能取到」上 —— 只判 role 的形式在这里
 * 天然失效（它当初就是绿的）。
 */
describe("RadioGroupItem 的调用方内容", () => {
  it("选项文字渲染在 radio 节点内，并成为它的可访问名", () => {
    render(
      <RadioGroup aria-label="圆角">
        <RadioGroupItem value="md">中 · 16px</RadioGroupItem>
        <RadioGroupItem value="lg">大 · 20px</RadioGroupItem>
      </RadioGroup>,
    );

    const group = screen.getByRole("radiogroup", { name: "圆角" });
    expect(within(group).getByText("中 · 16px")).toBeTruthy();
    /* 可访问名取得到才是「用户与读屏都认得这一项」——文字渲染了但不在
       radio 节点内，`getByRole(..., { name })` 照样匹配不到。 */
    expect(
      within(group).getByRole("radio", { name: "中 · 16px" }),
    ).toBeTruthy();
    expect(
      within(group).getByRole("radio", { name: "大 · 20px" }),
    ).toBeTruthy();
  });

  it("基元自己的 indicator 与调用方内容共存（不是二选一）", () => {
    render(
      <RadioGroup aria-label="圆角" defaultValue="md">
        <RadioGroupItem value="md">中 · 16px</RadioGroupItem>
      </RadioGroup>,
    );

    const radio = screen.getByRole("radio", { name: "中 · 16px" });
    expect(
      radio.querySelector('[data-slot="radio-group-indicator"]'),
    ).toBeTruthy();
    expect(radio.textContent).toContain("中 · 16px");
  });
});
