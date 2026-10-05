import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BreadcrumbPath } from "./breadcrumb-path";

// vitest globals: false 下 RTL 不会自动 cleanup，需手动注册
afterEach(cleanup);

/**
 * 路径行的回归（规范 16 §16.2.4.72）。
 *
 * 收口前素材库抽屉与资源库页各手写一份同一段渲染 —— 两份都丢掉了
 * `ui/breadcrumb` 的语义（`ol` / `li` 层级、`aria-current="page"`）。
 * 这里逐条钉住接管后的语义与交互契约：中间段可点、末段不可点。
 */
const SEGMENTS = [
  { label: "参考素材", key: null },
  { label: "角色参考", key: "characters" },
  { label: "小夜", key: null },
];

describe("BreadcrumbPath", () => {
  it("用 nav + ol/li 的层级语义，且当前段带 aria-current", () => {
    render(<BreadcrumbPath segments={SEGMENTS} onNavigate={() => undefined} />);
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    const current = screen.getByText("小夜");
    expect(current).toHaveAttribute("aria-current", "page");
  });

  it("中间段可点并回调 key；末段是纯展示（点它不重入同一层）", async () => {
    const onNavigate = vi.fn();
    render(<BreadcrumbPath segments={SEGMENTS} onNavigate={onNavigate} />);
    await userEvent.click(screen.getByRole("button", { name: "角色参考" }));
    expect(onNavigate).toHaveBeenCalledWith("characters");
    /* 末段与首段（key=null）都不是按钮。 */
    expect(screen.queryByRole("button", { name: "小夜" })).toBeNull();
    expect(screen.queryByRole("button", { name: "参考素材" })).toBeNull();
  });

  it("navigable=false（搜索态）时全部段都不可点", () => {
    render(
      <BreadcrumbPath
        segments={SEGMENTS}
        onNavigate={() => undefined}
        navigable={false}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("空数组不渲染任何东西（调用处不必先判长度）", () => {
    const { container } = render(
      <BreadcrumbPath segments={[]} onNavigate={() => undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
