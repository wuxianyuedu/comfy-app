// 子图底部「进入子图」进入条的行为契约（ISSUE #5047）：
//  1) 渲染居中的「进入子图」文字与图标，点击触发 onEnter（下钻唯一入口）；
//  2) 点击不向外冒泡 —— 外层（React Flow 节点 / 画布）的同名事件不得被连带触发；
//  3) 未给 onEnter 时不渲染（折叠态由调用方把关，本组件只认 prop）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SubgraphEnterFooter } from "./SubgraphEnterFooter";

// vitest globals: false 下 RTL 不会自动 cleanup,需手动注册
afterEach(cleanup);

describe("SubgraphEnterFooter", () => {
  it("渲染「进入子图」文字与图标", () => {
    render(<SubgraphEnterFooter onEnter={vi.fn()} />);
    expect(screen.getByText("进入子图")).toBeInTheDocument();
    /* 图标随文字一起出现（lucide 渲染为 svg）。 */
    expect(screen.getByRole("button").querySelector("svg")).not.toBeNull();
  });

  it("点击触发 onEnter，且事件不冒泡到外层", async () => {
    const onEnter = vi.fn();
    const onOuterClick = vi.fn();
    const { container } = render(
      /* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- 测试用外层监听，非交互语义 */
      <div onClick={onOuterClick}>
        <SubgraphEnterFooter onEnter={onEnter} />
      </div>,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(onEnter).toHaveBeenCalledOnce();
    expect(onOuterClick).not.toHaveBeenCalled();
    expect(container).toBeInTheDocument();
  });

  it("未传 onEnter 时不渲染", () => {
    render(<SubgraphEnterFooter />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("进入子图")).not.toBeInTheDocument();
  });
});
