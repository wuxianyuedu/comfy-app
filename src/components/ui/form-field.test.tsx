/** `FormField` —— 「标签 + 控件 + 校验错误」这一行的唯一实现（规范 16 §16.2.4.26）。
 * 这条账的实质不是字号不一致，而是三件事在不同落点被漏掉：`htmlFor` 关联（15 处表单行没有一处做过）、`aria-invalid` + `aria-describedby`（只有 1/15 处写了 `aria-invalid`、没有一处关联错误文案）、错误行的位置。
 * 所以用例逐条钉这三件，而不是钉 class。 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FormField } from "./form-field";

/* 本仓库的 vitest setup 不做全局 cleanup（各文件自管），多 DOM 用例的文件
 * 必须自己清 —— 否则上一个用例的节点会留在 `document` 里。 */
afterEach(cleanup);

describe("FormField", () => {
  it("标签与控件用 htmlFor/id 关联（点标签即聚焦控件）", () => {
    render(
      <FormField id="m" label="模型名称">
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
      <FormField error="请填写名称" id="n" label="名称">
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
      <FormField id="n" label="名称">
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
      <FormField error="" id="n" label="名称">
        {(a11y) => <input {...a11y} />}
      </FormField>,
    );
    expect(screen.getByLabelText("名称").hasAttribute("aria-invalid")).toBe(false);
  });

  it("hint 挂在控件下方、错误行在 hint 之下（先解释、再报错）", () => {
    const { container } = render(
      <FormField error="地址不合法" hint="留空则跟随全局" id="a" label="地址">
        {(a11y) => <input {...a11y} />}
      </FormField>,
    );
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- DOM textContent 运行期是 string|null（lib.dom 声明），规则未建模，保留空值兜底
    const text = container.textContent ?? "";
    expect(text.indexOf("留空则跟随全局")).toBeLessThan(text.indexOf("地址不合法"));
  });

  /* 「小标题」形态：控件在别处（或多个控件，如按钮组），没有一个能被
   * `htmlFor` 指到。这一档下**不许**给 `htmlFor` —— 给了就是一个指向
   * DOM 里不存在的 id 的悬空箭头，比不给更坏（读屏器读出孤立标签文本）。
   * 判据 `scripts/check-form-field-wiring.cjs` 把这一档记在基线里。 */
  it("children 是普通节点时不给 htmlFor（箭头会悬空）", () => {
    render(
      <FormField id="k" label="用途">
        <div data-testid="ctl" />
      </FormField>,
    );
    expect(screen.getByTestId("ctl")).toBeTruthy();
    // 标签渲染出来了，但没有 `htmlFor` —— 它指不到任何控件。
    expect(screen.getByText("用途").getAttribute("for")).toBeNull();
  });

  it("可省略 children：标签行 + hint 的小标题形态不给 htmlFor", () => {
    render(<FormField hint="值可为文本 / 数字" label="请求体额外字段" />);
    expect(screen.getByText("请求体额外字段")).toBeTruthy();
    expect(screen.getByText("值可为文本 / 数字")).toBeTruthy();
    expect(screen.getByText("请求体额外字段").getAttribute("for")).toBeNull();
  });

  it("render-prop 形态下**必须**给 htmlFor（箭头真的指得着）", () => {
    render(
      <FormField id="wired" label="用途">
        {(field) => <input {...field} />}
      </FormField>,
    );
    expect(screen.getByText("用途").getAttribute("for")).toBe("wired");
  });

  it("required 只加一个装饰星号，不改 aria-required（必填语义由调用处给）", () => {
    const { container } = render(
      <FormField id="n" label="名称" required>
        {(a11y) => <input {...a11y} />}
      </FormField>,
    );
    expect(container.textContent).toContain("*");
    expect(screen.getByLabelText("名称*").hasAttribute("required")).toBe(false);
  });
});
