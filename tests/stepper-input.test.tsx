/**
 * `StepperInput`（悬浮式数字步进输入框，ISSUE #3495）的行为判据：
 * ① 渲染的是 `type="text"` —— 原生 number spinner 不再出现（浅色下白底箭头的根因）；
 * ② 点箭头按 `step` 增减、clamp 进 [min, max]，且立刻触发 `onCommit`（改完即存）；
 * ③ 击键原样上抛（草稿直显，输入中途不做 clamp）；
 * ④ 失焦触发 `onCommit`。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StepperInput } from "../src/components/ui/stepper-input";

afterEach(cleanup);

type Props = Parameters<typeof StepperInput>[0];

function setup(overrides: Partial<Props> = {}) {
  const onValueChange = vi.fn();
  const onCommit = vi.fn();
  const props: Props = {
    value: "0.65",
    onValueChange,
    onCommit,
    min: 0,
    max: 2,
    step: 0.05,
    ariaLabel: "任务温度",
    ...overrides,
  };
  render(<StepperInput {...props} />);
  const input = screen.getByRole("textbox", { name: "任务温度" });
  return { input, onCommit, onValueChange };
}

describe("StepperInput", () => {
  it("渲染文本输入框，原生 number spinner 不再出现", () => {
    const { input } = setup();
    expect(input.getAttribute("type")).toBe("text");
    expect(document.querySelector('input[type="number"]')).toBeNull();
  });

  it("点上调箭头按 step 增减并触发提交", () => {
    const { onCommit, onValueChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "增加 0.05" }));
    expect(onValueChange).toHaveBeenCalledWith("0.7");
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("低于下限 clamp 到 min", () => {
    const { onValueChange } = setup({ value: "0.02" });
    fireEvent.click(screen.getByRole("button", { name: "减少 0.05" }));
    expect(onValueChange).toHaveBeenLastCalledWith("0");
  });

  it("超过上限 clamp 到 max", () => {
    const { onValueChange } = setup({ value: "1.98" });
    fireEvent.click(screen.getByRole("button", { name: "增加 0.05" }));
    expect(onValueChange).toHaveBeenLastCalledWith("2");
  });

  it("当前值不是数时从下限起步", () => {
    const { onValueChange } = setup({ value: "" });
    fireEvent.click(screen.getByRole("button", { name: "增加 0.05" }));
    expect(onValueChange).toHaveBeenLastCalledWith("0.05");
  });

  it("击键原样上抛（草稿直显，不做 clamp）", () => {
    const { input, onValueChange } = setup();
    fireEvent.change(input, { target: { value: "0." } });
    expect(onValueChange).toHaveBeenCalledWith("0.");
  });

  it("失焦触发提交", () => {
    const { input, onCommit } = setup();
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
