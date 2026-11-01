import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FileText, Loader2, TriangleAlert } from "lucide-react";

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
        action={<button type="button">重试</button>}
        description="点右上角导入"
        title="还没有工作流"
      />,
    );
    expect(screen.getByText("还没有工作流")).toBeInTheDocument();
    expect(screen.getByText("点右上角导入")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    const root = screen.getByText("还没有工作流").closest("div.grid");
    expect(root?.className).toContain("border-dashed");
  });

  it("page：icon 传 lucide 组件按统一尺寸渲染（原 studio/ui 形态）", () => {
    const { container } = render(<EmptyState icon={TriangleAlert} title="列表还没返回" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("width")).toBe("32");
  });

  it("page：icon 传已渲染节点原样使用（原 ui/empty-state 形态）", () => {
    render(<EmptyState icon={<Loader2 data-testid="spin-icon" size={20} />} title="正在加载…" />);
    expect(screen.getByTestId("spin-icon")).toBeInTheDocument();
  });

  it("error：走破坏色而非品牌色，形态与 page 一致", () => {
    render(<EmptyState icon={TriangleAlert} title="失败了" variant="error" />);
    const title = screen.getByText("失败了");
    expect(title.className).toContain("text-destructive");
    const root = title.closest("div.grid");
    expect(root?.className).toContain("border-destructive/30");
  });

  it("hint：行内提示条形态，只有一段文案（原 EmptyStateHint 形态）", () => {
    render(<EmptyState description="该工作流尚未标记对外参数。" variant="hint" />);
    expect(screen.getByText("该工作流尚未标记对外参数。")).toBeInTheDocument();
    // 行内形态刻意不带标题位与虚线卡片的居中骨架
    expect(document.querySelector("div.grid.place-items-center")).toBeNull();
  });

  it("hint：只给 title 时也能出文案（description 优先）", () => {
    render(<EmptyState title="没有匹配项" variant="hint" />);
    expect(screen.getByText("没有匹配项")).toBeInTheDocument();
  });

  it("minHeightClass 可覆盖（原 studio/ui 的列表区矮态）", () => {
    const { container } = render(<EmptyState minHeightClass="min-h-40" title="空" />);
    expect(container.firstElementChild?.className).toContain("min-h-40");
  });

  /* ── panel：面板里铺满居中的轻量占位 ──────────────────────────────
   * 这三条是「只许有一个出处」判据的另一半：判据保证调用点不再手抄，而这里
   * 保证**被抄进去的那串形状本身**还在（基元一旦被人改掉，判据会因为
   * 「标记只命中实现文件」而继续全绿，外观却已经换了）。 */

  it("panel：铺满父级的无框形状（不带 page 那档的虚线卡片骨架）", () => {
    const { container } = render(
      <EmptyState icon={FileText} title="暂无匹配的日志" variant="panel" />,
    );
    const root = /* SAFETY: 类型断言已复核 */ container.firstElementChild as HTMLElement;
    for (const cls of [
      "flex",
      "h-full",
      "flex-col",
      "items-center",
      "justify-center",
      "gap-2",
      "text-sm",
      "text-ink-fainter",
    ]) {
      expect(root.className, cls).toContain(cls);
    }
    // 刻意不是虚线卡片：`Empty` 骨架带来的 `border-dashed` 不该出现在这一档
    expect(root.className).not.toContain("border-dashed");
    expect(screen.getByText("暂无匹配的日志")).toBeInTheDocument();
  });

  it("panel：icon 传 lucide 组件按弱化档渲染（32 / 1.5 / opacity-30）", () => {
    const { container } = render(<EmptyState icon={FileText} variant="panel" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("32");
    expect(svg?.getAttribute("stroke-width")).toBe("1.5");
    // lucide 把 className 落在 `<svg>` 自己身上（没有额外包一层），所以查它
    expect(svg?.getAttribute("class")).toContain("opacity-30");
    // 纯装饰：占位图标不进无障碍树（文案已经说明状态）
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("panel：className 与已渲染图标节点都听调用点的（差异不必抄整串类名）", () => {
    render(
      <EmptyState
        className="gap-3"
        icon={<Loader2 data-testid="big-icon" size={44} strokeWidth={1.2} />}
        title="暂无系统消息"
        variant="panel"
      />,
    );
    /* 文案是根 div 的直接子节点，所以 `getByText` 拿到的就是那枚根 —— 判「同组
     * 后者取胜」要落在它身上。实测 `cn("… gap-2 …", "gap-3")` 把 `gap-2` 摘掉：
     * 调用点覆写是**取胜**而不是靠产物里两条规则的先后（口径见 docs/DESIGN.md
     * §Components 那条「分机制」的订正）。 */
    const root = screen.getByText("暂无系统消息");
    expect(root.className).toContain("gap-3");
    expect(root.className).not.toContain("gap-2");
    expect(screen.getByTestId("big-icon").getAttribute("width")).toBe("44");
  });
});
