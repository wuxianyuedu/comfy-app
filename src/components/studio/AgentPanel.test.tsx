// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentPanel } from "./AgentPanel";
import type { AgentTask } from "./AgentPanel";

// vitest globals: false 下 RTL 不会自动 cleanup,需手动注册
afterEach(cleanup);

const TASKS: AgentTask[] = [
  { id: "t1", status: "pending", label: "生成脚本" },
  { id: "t2", status: "running", label: "生成分镜" },
  { id: "t3", status: "done", label: "生成图片" },
  { id: "t4", status: "error", label: "生成视频" },
];

describe("AgentPanel", () => {
  it("无任务时渲染空态文案", () => {
    render(<AgentPanel />);
    expect(screen.getByText("添加技能给我任务")).toBeInTheDocument();
    expect(screen.getByText(":: 无任务")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /生成/ })).not.toBeInTheDocument();
  });

  it("渲染全部任务及其状态标签", () => {
    render(<AgentPanel tasks={TASKS} />);
    for (const task of TASKS) {
      expect(screen.getByText(task.label)).toBeInTheDocument();
    }
    expect(screen.getByText("待开始")).toBeInTheDocument();
    expect(screen.getByText("运行中")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.getByText("错误")).toBeInTheDocument();
  });

  it("运行中状态使用 STATUS_MAP 的脉冲圆点样式", () => {
    render(<AgentPanel tasks={TASKS} />);
    const button = screen.getByRole("button", { name: /生成分镜/ });
    expect(button.firstElementChild).toHaveClass("animate-pulse", "bg-amber-400");
  });

  it("点击任务触发 onTaskClick 并回传任务对象", async () => {
    const onTaskClick = vi.fn();
    render(<AgentPanel tasks={TASKS} onTaskClick={onTaskClick} />);
    await userEvent.click(screen.getByText("生成分镜"));
    expect(onTaskClick).toHaveBeenCalledOnce();
    expect(onTaskClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: "t2", status: "running" }),
    );
  });

  it("未传 onTaskClick 时任务按钮为禁用态", () => {
    render(<AgentPanel tasks={TASKS} />);
    expect(screen.getByRole("button", { name: /生成分镜/ })).toBeDisabled();
  });

  it("传入 onAddTask 时渲染添加按钮且点击触发回调", async () => {
    const onAddTask = vi.fn();
    render(<AgentPanel tasks={TASKS} onAddTask={onAddTask} />);
    await userEvent.click(screen.getByRole("button", { name: "添加任务" }));
    expect(onAddTask).toHaveBeenCalledOnce();
  });

  it("未传 onAddTask 时不渲染添加按钮", () => {
    render(<AgentPanel tasks={TASKS} />);
    expect(screen.queryByRole("button", { name: "添加任务" })).not.toBeInTheDocument();
  });

  it("头像取名称首字符(大写),空名称兜底为 A", () => {
    const { rerender } = render(<AgentPanel name="claude" tasks={TASKS} />);
    expect(screen.getByText("C")).toBeInTheDocument();
    rerender(<AgentPanel name="  " tasks={TASKS} />);
    expect(screen.getByText("A")).toBeInTheDocument();
  });
});
