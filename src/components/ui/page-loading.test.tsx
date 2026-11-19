/**
 * 加载态基元的形态契约。断言对象是 `~/components/ui/spinner`（`Loader2Icon` + `animate-spin` + `role="status"` + `aria-label="Loading"`）；`page-loading` 的 re-export 已在迁移后撤除，文件名保留是历史沿革。
 * 旧自绘 `<span>` 依赖调用处 `display`，画成约 4px 宽竖线（ISSUE #720）；换成 lucide `<svg>`（replaced element）后宽度直接生效。新契约：`data-slot="spinner"` / `role` / `aria-label`，`size-6` 在调用处生效，`animate-spin` 走基元。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { Spinner } from "./spinner";

afterEach(cleanup);

describe("Spinner 契约（shadcn 基元直连）", () => {
  it("渲染为 svg 元素，带 data-slot / role / aria-label 三件 a11y 语义", () => {
    const { container } = render(<Spinner className="size-6" />);
    const spinner = container.querySelector('[data-slot="spinner"]');
    expect(spinner).not.toBeNull();
    expect(spinner!.tagName.toLowerCase()).toBe("svg");
    expect(spinner!.getAttribute("role")).toBe("status");
    expect(spinner!.getAttribute("aria-label")).toBe("Loading");
  });

  it("调用处的 `size-*` 与基元自带的 `animate-spin` 同时挂在同一元素上", () => {
    const { container } = render(<Spinner className="size-6" />);
    const spinner = container.querySelector('[data-slot="spinner"]')!;
    /* SVG 元素的 `className` 是 `SVGAnimatedString` 对象、不是字符串
       （jsdom 里 `String(x)` 得到 `[object SVGAnimatedString]`）；
       `getAttribute("class")` 才是 CSS 类串。 */
    const className = spinner.getAttribute("class") ?? "";
    expect(className).toContain("size-6");
    expect(className).toContain("animate-spin");
  });

  it("外层容器是非 flex 时仍能正常渲染（svg 是 replaced element、天然块级）", () => {
    /* 复刻 `EmptyState` 的图标位：`<span class="block">` 里塞 Spinner。
       历史 ISSUE #720 是「span 里塞 span」；换 `<svg>` 后不再依赖调用处
       display，只需断言它渲染存在即可。 */
    const { container } = render(
      <span className="block">
        <Spinner className="size-6" />
      </span>,
    );
    expect(container.querySelector("span.block")).not.toBeNull();
    expect(container.querySelector('[data-slot="spinner"]')).not.toBeNull();
  });
});
