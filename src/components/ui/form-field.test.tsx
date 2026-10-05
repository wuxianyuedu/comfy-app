/**
 * `FormField` —— 「标签 + 控件 + 校验错误」这一行的唯一实现
 * （规范 16 §16.2.4.26）。
 *
 * 这条账的实质不是字号不一致，而是三件事在**不同落点被漏掉**：
 *  `htmlFor` 关联（15 处表单行**没有一处**做过）、`aria-invalid` +
 *  `aria-describedby`（只有 1/15 处写了 `aria-invalid`、**没有一处**关联
 *  错误文案）、错误行的位置。所以用例逐条钉这三件，而不是钉 class。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FormField } from "./form-field";

/* 本仓库的 vitest setup 不做全局 cleanup（各文件自管），多 DOM 用例的文件
 * 必须自己清 —— 否则上一个用例的节点会留在 `document` 里。 */
afterEach(cleanup);

describe("FormField", () => {
  it("标签与控件用 htmlFor/id 关联（点标签即聚焦控件）", () => {
    render(
      <FormField label="模型名称" id="m">
        {(a11y) => <input {...a11y} />}
      </FormField>,
    );
    const input = screen.getByLabelText("模型名称");
    expect(input.id).toBe("m");
  });

  it("不给 id 时用 useId 兜一份（仍可关联）", () => {
    render(<FormField label="地址">{(a11y) => <input {...a11y} />}</FormField>);
    expect(screen.getByLabelText("地址").id).toBeTruthy();
  });

  it("有错误时自动上 aria-invalid 与 aria-describedby（调用处不可能只写一个）", () => {
    render(
      <FormField label="名称" id="n" error="请填写名称">
        {(a11y) => <input {...a11y} />}
      </FormField>,
    );
    const input = screen.getByLabelText("名称");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const descId = input.getAttribute("aria-describedby");
    expect(descId).toBe("n-error");
    expect(document.getElementById(descId!)?.textContent).toBe("请填写名称");
  });

  it("无错误时不上 ARIA 无效标记（错误行也不渲染）", () => {
    render(
      <FormField label="名称" id="n">
        {(a11y) => <input {...a11y} />}
      </FormField>,
    );
    const input = screen.getByLabelText("名称");
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(input.hasAttribute("aria-describedby")).toBe(false);
    expect(document.getElementById("n-error")).toBeNull();
  });

  it('空串错误按「没有错误」处理（`error=""` 不应渲染空错误行）', () => {
    render(
      <FormField label="名称" id="n" error="">
        {(a11y) => <input {...a11y} />}
      </FormField>,
    );
    expect(screen.getByLabelText("名称").hasAttribute("aria-invalid")).toBe(
      false,
    );
  });

  it("hint 挂在控件下方、错误行在 hint 之下（先解释、再报错）", () => {
    const { container } = render(
      <FormField label="地址" id="a" hint="留空则跟随全局" error="地址不合法">
        {(a11y) => <input {...a11y} />}
      </FormField>,
    );
    const text = container.textContent ?? "";
    expect(text.indexOf("留空则跟随全局")).toBeLessThan(
      text.indexOf("地址不合法"),
    );
  });

  it("children 可以是普通节点（非 render-prop 的落点）", () => {
    render(
      <FormField label="用途" id="k">
        <div data-testid="ctl" />
      </FormField>,
    );
    expect(screen.getByTestId("ctl")).toBeTruthy();
  });

  it("可省略 children：标签行 + hint 的小标题形态（行编辑器落点）", () => {
    render(<FormField label="请求体额外字段" hint="值可为文本 / 数字" />);
    expect(screen.getByText("请求体额外字段")).toBeTruthy();
    expect(screen.getByText("值可为文本 / 数字")).toBeTruthy();
  });

  it("required 只加一个装饰星号，不改 aria-required（必填语义由调用处给）", () => {
    const { container } = render(
      <FormField label="名称" id="n" required>
        {(a11y) => <input {...a11y} />}
      </FormField>,
    );
    expect(container.textContent).toContain("*");
    expect(screen.getByLabelText("名称*").hasAttribute("required")).toBe(false);
  });
});
