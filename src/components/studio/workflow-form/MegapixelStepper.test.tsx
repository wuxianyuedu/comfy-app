import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MEGAPIXEL_MAX,
  MEGAPIXEL_MIN,
  MEGAPIXEL_STEP,
  MegapixelStepper,
} from "./MegapixelStepper";

afterEach(cleanup);

/** 步进按钮的 title（`NumberField` 按步进量生成）—— 不在这里硬编码数字，
 *  改步进量时这几条断言跟着走。 */
const incLabel = `增加 ${MEGAPIXEL_STEP}`;
const decLabel = `减少 ${MEGAPIXEL_STEP}`;

describe("MegapixelStepper（百万像素自由值）", () => {
  it("点 + / − 按步进量上抛", () => {
    const onChange = vi.fn();
    render(<MegapixelStepper value={2} onChange={onChange} />);
    fireEvent.mouseDown(screen.getByTitle(incLabel));
    fireEvent.mouseDown(screen.getByTitle(decLabel));
    /* 0.1 步进在二进制浮点里落不到整（`19 * 0.1` = 1.9000000000000001），
     *  所以按小数位比较而不是逐位相等。 */
    const calls = onChange.mock.calls.map((call) => Number(call[0]));
    expect(calls[0]).toBeCloseTo(2 + MEGAPIXEL_STEP, 5);
    expect(calls[1]).toBeCloseTo(2 - MEGAPIXEL_STEP, 5);
  });

  it("小数在位显示（2.5 不会被抹成整数）", () => {
    render(<MegapixelStepper value={2.5} onChange={() => undefined} />);
    expect(screen.getByDisplayValue("2.5")).toBeTruthy();
  });

  it("到达上限/下限时对应的按钮置灰（不会上抛越界值）", () => {
    const onChange = vi.fn();
    const { unmount } = render(
      <MegapixelStepper value={MEGAPIXEL_MAX} onChange={onChange} />,
    );
    expect(screen.getByTitle(incLabel).hasAttribute("disabled")).toBe(true);
    fireEvent.mouseDown(screen.getByTitle(incLabel));
    expect(onChange).not.toHaveBeenCalled();
    unmount();

    render(<MegapixelStepper value={MEGAPIXEL_MIN} onChange={onChange} />);
    expect(screen.getByTitle(decLabel).hasAttribute("disabled")).toBe(true);
  });
});
