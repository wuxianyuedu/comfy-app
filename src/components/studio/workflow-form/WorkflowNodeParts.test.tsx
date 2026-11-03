/** 底部「▶ 用此工作流生成」—— 画布功能版/视觉稿、库内卡片预览与「实际使用」面板此前各写一份，收进这里后只许一个出处
 *（形状由 design-md-contract-sync.test.ts 第七族按标记集合钉着；本文件钉「抽取会不会改变渲染」）。
 * 四件事：基础形状（全宽渐变 + 品牌投影 + h-10.75）与 nodrag nopan 不随 corner/hint 分叉；
 * corner 只改圆角（own 自带下沿圆角、顶角收直角；clipped 四角交还卡片）；
 * hint 决定是否有 inline-flex 锚点（锚点会让内部 w-full 按内容宽定尺寸，故无文案时必须裸按钮）；disabled/onClick 落原生 button。 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { WorkflowNodeActionButton } from "./WorkflowNodeParts";

describe("WorkflowNodeActionButton", () => {
  it("基础形状恒在，且不随 corner / hint 分叉", () => {
    const { rerender } = render(<WorkflowNodeActionButton label="▶ 用此工作流生成" />);
    const own = screen.getByRole("button", { name: "▶ 用此工作流生成" });
    expect(own).toHaveClass(
      "from-primary",
      "to-accent",
      "bg-linear-to-r",
      "h-10.75",
      "w-full",
      "text-sm",
      "font-bold",
      "nodrag",
      "nopan",
    );
    expect(own.className).toContain("color-mix");

    rerender(<WorkflowNodeActionButton corner="clipped" disabled hint="稍后" label="生成中…" />);
    const clipped = screen.getByRole("button", { name: /生成中/ });
    expect(clipped).toHaveClass("from-primary", "h-10.75", "nodrag", "nopan");
    expect(clipped.className).toContain("color-mix");
  });

  it("corner 只动圆角这一段：own 自带下沿 + 直角顶，clipped 全部交还卡片", () => {
    const { rerender } = render(<WorkflowNodeActionButton label="A" />);
    expect(screen.getByRole("button", { name: "A" })).toHaveClass(
      "rounded-b-node",
      "rounded-t-none",
    );
    expect(screen.getByRole("button", { name: "A" })).not.toHaveClass("rounded-none");

    rerender(<WorkflowNodeActionButton corner="clipped" label="B" />);
    expect(screen.getByRole("button", { name: "B" })).toHaveClass("rounded-none");
    expect(screen.getByRole("button", { name: "B" })).not.toHaveClass("rounded-b-node");
  });

  it("没有 hint 时必须是裸按钮 —— 那层 inline-flex 锚点会把 w-full 收成内容宽", () => {
    const { container, rerender } = render(<WorkflowNodeActionButton label="bare" />);
    const bare = screen.getByRole("button", { name: "bare" });
    expect(bare.parentElement).toBe(container);

    rerender(<WorkflowNodeActionButton hint="必填参数未填" label="hinted" />);
    const hinted = screen.getByRole("button", { name: "hinted" });
    expect(hinted.parentElement?.className).toContain("inline-flex");
  });

  it("disabled 与 onClick 落在原生 button 上", async () => {
    const onClick = () => {
      throw new Error("不该被调用");
    };
    const { rerender } = render(<WorkflowNodeActionButton disabled label="R" onClick={onClick} />);
    expect(screen.getByRole("button", { name: "R" })).toBeDisabled();

    const clicked: Array<string> = [];
    rerender(<WorkflowNodeActionButton label="P" onClick={() => clicked.push("P")} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "P" }));
    expect(clicked).toEqual(["P"]);
  });
});
