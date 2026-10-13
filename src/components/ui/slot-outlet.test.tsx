/**
 * `SlotOutlet` 的形状判据（规范 §12.18：一处实现、多处复用）。
 *
 * 它守的是三条**失效时都不会报错、只会静默画错**的边界：
 *   ① 有落点时内容真的落在落点里、原地不留副本（留一份 = 同一块 UI 出现两次）；
 *   ② 没落点时走 `fallback`（不传就原地渲染）—— 不挂壳的渲染路径全靠这条；
 *   ③ 服务端首帧不传送（`createPortal` 在 SSR 里会直接抛）。
 *
 * 判的是 DOM 上的归属与去留，不判内部实现（规范 11.2）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { SlotContent, SlotOutlet, SlotOutletProvider } from "./slot-outlet";

afterEach(() => {
  cleanup();
});

describe("SlotOutlet", () => {
  it("有落点时内容落在落点里，原地不留副本", () => {
    const { container } = render(
      <SlotOutletProvider>
        <div data-testid="topbar">
          <SlotOutlet />
        </div>
        <SlotContent>
          <button>刷新</button>
        </SlotContent>
      </SlotOutletProvider>,
    );
    const outlet = container.querySelector('[data-slot="slot-outlet"]');
    if (!outlet) throw new Error("没渲染出落点");
    expect(outlet.textContent).toContain("刷新");
    /* 原地不许有第二份：有第二份就是同一块 UI 在一屏里出现两次。 */
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });

  it("没落点时按 `fallback` 走；不传 `fallback` 就原地渲染", () => {
    render(
      <SlotContent>
        <button>刷新</button>
      </SlotContent>,
    );
    expect(screen.getByRole("button", { name: "刷新" })).toBeTruthy();

    cleanup();
    render(
      <SlotContent fallback={<span>退化形态</span>}>
        <button>不该出现</button>
      </SlotContent>,
    );
    expect(screen.getByText("退化形态")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "不该出现" })).toBeNull();
  });

  it("落点的排布类由调用处给（`SlotOutlet` 只管挂载点）", () => {
    const { container } = render(
      <SlotOutletProvider>
        <SlotOutlet className="gap-1" />
      </SlotOutletProvider>,
    );
    const outlet = container.querySelector('[data-slot="slot-outlet"]');
    expect(outlet?.className).toContain("gap-1");
  });
});
