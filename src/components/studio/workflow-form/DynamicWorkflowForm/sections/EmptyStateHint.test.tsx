// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EmptyStateHint } from "./EmptyStateHint";

// vitest globals: false 下 RTL 不会自动 cleanup,需手动注册
afterEach(cleanup);

describe("EmptyStateHint", () => {
  it("未传 emptyHint 时渲染默认引导文案", () => {
    render(<EmptyStateHint />);
    expect(screen.getByText(/该工作流尚未标记对外参数/)).toBeInTheDocument();
    expect(
      screen.getByText(/打开工作流编辑器 → 顶栏「IO 编辑」/),
    ).toBeInTheDocument();
  });

  it("传入 emptyHint 时渲染自定义内容(支持 ReactNode)", () => {
    render(
      <EmptyStateHint
        emptyHint={
          <span>
            自定义提示 <b>加粗部分</b>
          </span>
        }
      />,
    );
    expect(screen.getByText(/自定义提示/)).toBeInTheDocument();
    expect(screen.getByText("加粗部分")).toBeInTheDocument();
    // 默认文案不再出现
    expect(
      screen.queryByText(/该工作流尚未标记对外参数/),
    ).not.toBeInTheDocument();
  });
});
