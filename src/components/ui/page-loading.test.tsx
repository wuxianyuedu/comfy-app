// @vitest-environment jsdom
/**
 * 加载态基元的形态契约（ISSUE #720）。
 *
 * 现场是「工作流库加载中那块有个不知道是什么的图案」：`EmptyState` 的图标位
 * 是非 flex 的容器（`<span class="block">`），而 `Spinner` 是个 `<span>`
 * —— 默认 `display: inline`，`size-*` 出的 `width` / `height` 对**行内盒**
 * 不生效，画出来的是「2px 上下边框叠在一个行内盒上」：一条约 4px 宽、20px
 * 高的竖线。此前它唯一的落点都在 flex 容器里（flex 会把子项块化），这个前提
 * 从没被写下来，也没人发现它依赖调用处的布局。
 *
 * jsdom 不做布局，量不出像素 —— 所以判据落在**尺寸的成立条件**上：
 * 转圈必须自己给出非行内的 `display`，而不是把「尺寸生效」外包给调用处。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { Spinner } from "./page-loading";

afterEach(cleanup);

describe("Spinner 的尺寸不依赖调用处布局", () => {
  it("自带 inline-block（行内盒上 width/height 不生效）", () => {
    const { container } = render(<Spinner className="size-6" />);
    const spinner = container.querySelector('[data-slot="spinner"]');
    expect(spinner).not.toBeNull();
    const className = spinner!.className;
    expect(className).toContain("inline-block");
    expect(className).toContain("size-6");
    /* flex 行里不被压扁（按钮内联态）。 */
    expect(className).toContain("shrink-0");
  });

  it("外层容器是非 flex 时尺寸类仍在（EmptyState 图标位那一段现场）", () => {
    /* 复刻 `EmptyState` 的图标位：`<span class="block">` 里塞 Spinner。
       这里断言的是「尺寸类没有丢」——「它真的画成圆」由 e2e 量。 */
    const { container } = render(
      <span className="block">
        <Spinner className="size-6" />
      </span>,
    );
    const spinner = container.querySelector('[data-slot="spinner"]')!;
    expect(spinner.className).toContain("inline-block");
    expect(container.querySelector("span.block")).not.toBeNull();
  });
});
