// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Loader2, TriangleAlert } from "lucide-react";

import { EmptyState } from "./empty-state";

// vitest globals: false 下 RTL 不会自动 cleanup，需手动注册
afterEach(cleanup);

/**
 * 空态三合一（规范 16 §16.2.4）的回归：合并前的三份实现各有自己的 props
 * （`icon: ReactNode` / `icon: LucideIcon` / 无 props 的纯提示条），
 * 这里逐条钉住「取并集」后每个入口仍然可用 —— 否则合并就是一次静默的能力回退。
 */
describe("EmptyState（三合一）", () => {
  it("page：标题 / 说明 / 操作区都渲染，骨架居中带虚线框", () => {
    render(
      <EmptyState
        title="还没有工作流"
        description="点右上角导入"
        action={<button type="button">重试</button>}
      />,
    );
    expect(screen.getByText("还没有工作流")).toBeInTheDocument();
    expect(screen.getByText("点右上角导入")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    const root = screen.getByText("还没有工作流").closest("div.grid");
    expect(root?.className).toContain("border-dashed");
  });

  it("page：icon 传 lucide 组件按统一尺寸渲染（原 studio/ui 形态）", () => {
    const { container } = render(
      <EmptyState icon={TriangleAlert} title="列表还没返回" />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("width")).toBe("32");
  });

  it("page：icon 传已渲染节点原样使用（原 ui/empty-state 形态）", () => {
    render(
      <EmptyState
        icon={<Loader2 data-testid="spin-icon" size={20} />}
        title="正在加载…"
      />,
    );
    expect(screen.getByTestId("spin-icon")).toBeInTheDocument();
  });

  it("error：走破坏色而非品牌色，形态与 page 一致", () => {
    render(<EmptyState variant="error" icon={TriangleAlert} title="失败了" />);
    const title = screen.getByText("失败了");
    expect(title.className).toContain("text-destructive");
    const root = title.closest("div.grid");
    expect(root?.className).toContain("border-destructive/30");
  });

  it("hint：行内提示条形态，只有一段文案（原 EmptyStateHint 形态）", () => {
    render(
      <EmptyState variant="hint" description="该工作流尚未标记对外参数。" />,
    );
    expect(screen.getByText("该工作流尚未标记对外参数。")).toBeInTheDocument();
    // 行内形态刻意不带标题位与虚线卡片的居中骨架
    expect(document.querySelector("div.grid.place-items-center")).toBeNull();
  });

  it("hint：只给 title 时也能出文案（description 优先）", () => {
    render(<EmptyState variant="hint" title="没有匹配项" />);
    expect(screen.getByText("没有匹配项")).toBeInTheDocument();
  });

  it("minHeightClass 可覆盖（原 studio/ui 的列表区矮态）", () => {
    const { container } = render(
      <EmptyState title="空" minHeightClass="min-h-[160px]" />,
    );
    expect(container.firstElementChild?.className).toContain("min-h-[160px]");
  });
});
