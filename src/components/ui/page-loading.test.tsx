// @vitest-environment jsdom
/**
 * 加载态基元的形态契约。
 *
 * 本件自 PR-2 起把内部实现下沉到官方 shadcn `~/components/ui/spinner`
 * （`Loader2Icon` + `animate-spin` + `role="status"` + `aria-label`），
 * 由 `~/components/ui/page-loading` 薄 re-export 保持既有 `Spinner`
 * 消费点不破。
 *
 * **历史 ISSUE #720 的现场**：旧 `Spinner` 是自绘 `<span class="border-2
 * animate-spin rounded-full">`，`<span>` 默认 `display: inline`、`size-*`
 * 对行内盒不生效；`EmptyState` 的图标位是 `<span class="block">`（非
 * flex），画出来成「2px 上下边框叠在一个行内盒上」——约 4px 宽、20px 高的
 * 竖线。当时的解法是给 `<span>` 自带 `inline-block`。
 *
 * 换成 lucide `Loader2Icon`（`<svg>`）之后**这条坑天然不存在**——`<svg>`
 * 是 replaced element、`width` / `height` 直接生效、不依赖调用处的
 * `display`。所以旧的 `inline-block` 断言删掉，改成断言**新契约**：
 *   · `data-slot="spinner"` / `role="status"` / `aria-label="Loading"`
 *     ——a11y 三件套由基元给出；
 *   · `size-6` 在调用处生效（jsdom 无布局、只能验类名）；
 *   · `animate-spin` 走基元而非调用处自写（P3 判据的合规方向）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { Spinner } from "./page-loading";

afterEach(cleanup);

describe("Spinner 契约（shadcn 基元薄 re-export）", () => {
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
