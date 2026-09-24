// @vitest-environment jsdom
// SeedAdvancedField：高级区默认折叠，展开后有种子数字输入 + 「随机」清空。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SeedAdvancedField } from "./SeedAdvancedField";

afterEach(cleanup);

describe("SeedAdvancedField", () => {
  it("渲染「高级」触发器", () => {
    render(<SeedAdvancedField value="" onChange={() => 0} />);
    expect(screen.getByText("高级")).toBeTruthy();
  });

  it("展开后：输入回抛值、点「随机」回抛空串（回到自动随机）", () => {
    const onChange = vi.fn();
    render(<SeedAdvancedField value="123" onChange={onChange} />);
    fireEvent.click(screen.getByText("高级"));
    const input = screen.getByPlaceholderText("留空＝每次随机");
    fireEvent.change(input, { target: { value: "456" } });
    expect(onChange).toHaveBeenLastCalledWith("456");
    fireEvent.click(screen.getByRole("button", { name: /随机/ }));
    expect(onChange).toHaveBeenLastCalledWith("");
  });
});
