// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  Field,
  NodeChip,
  StatusBadge,
  StatusDot,
} from "./CanvasNodePrimitives";
import type { CanvasNodeData } from "@/lib/project-canvas/canvas-types";

// vitest globals: false 下 RTL 不会自动 cleanup,需手动注册
afterEach(cleanup);

type Status = CanvasNodeData["status"];

const STATUSES = ["idle", "running", "done", "error"] as const;

/* 与源码 PORT 语义一致:每种 status 对应固定渐变 + 发光色。
 * jsdom 会把渐变里的 hex 规范化为 rgb,但 toHaveStyle 会对期望值做同样的
 * cssstyle 规范化,因此可以直接写源码里的原始字符串。 */
const DOT_STYLES: Record<Status, { background: string; boxShadow: string }> = {
  running: {
    background: "linear-gradient(135deg, #FFD571 0%, #FF9C5B 100%)",
    boxShadow: "0 0 8px rgba(255,213,113,0.6)",
  },
  done: {
    background: "linear-gradient(135deg, #5BE3C4 0%, #67E89D 100%)",
    boxShadow: "0 0 8px rgba(91,227,196,0.6)",
  },
  error: {
    background: "linear-gradient(135deg, #FF8FB0 0%, #FF7AC0 100%)",
    boxShadow: "0 0 8px rgba(255,122,192,0.6)",
  },
  idle: {
    background: "linear-gradient(135deg, #7891FF 0%, #A584FF 100%)",
    boxShadow: "0 0 8px rgba(165,132,255,0.6)",
  },
};

describe("Field", () => {
  it("渲染 label 与 children", () => {
    render(
      <Field label="提示词">
        <div>正文输入区</div>
      </Field>,
    );
    expect(screen.getByText("提示词")).toBeInTheDocument();
    expect(screen.getByText("正文输入区")).toBeInTheDocument();
  });
});

describe("StatusDot", () => {
  it.each(STATUSES)("status=%s 渲染对应渐变与发光", (status) => {
    const { container } = render(<StatusDot status={status} />);
    const dot = container.firstElementChild as HTMLElement;
    expect(dot.tagName).toBe("SPAN");
    expect(dot).toHaveClass("rounded-full", "h-2.5", "w-2.5");
    expect(dot).toHaveStyle(DOT_STYLES[status]);
  });
});

describe("StatusBadge", () => {
  it.each([
    ["idle", "待开始", ["bg-subtle", "text-ink-soft"]],
    ["running", "生成中…", ["bg-amber-400/10", "text-amber-700"]],
    ["done", "运行后生成", ["bg-emerald-400/10", "text-emerald-700"]],
    ["error", "生成失败", ["bg-rose-400/10", "text-rose-700"]],
  ] as const)("status=%s 显示「%s」及对应配色", (status, label, classes) => {
    render(<StatusBadge status={status} />);
    const badge = screen.getByText(label);
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass(...classes);
  });
});

describe("NodeChip", () => {
  it("渲染类型字符与名称(image → I)", () => {
    render(<NodeChip kind="image" name="主视觉" />);
    expect(screen.getByText("主视觉")).toBeInTheDocument();
    expect(screen.getByText("I")).toBeInTheDocument();
    expect(screen.getByLabelText("类型 生图")).toBeInTheDocument();
    // 默认 md 尺寸
    expect(screen.getByText("I")).toHaveClass("h-6", "w-6");
  });

  it("movie → V,sm 尺寸使用小号圆标", () => {
    render(<NodeChip kind="movie" name="参考视频" size="sm" />);
    expect(screen.getByText("参考视频")).toBeInTheDocument();
    expect(screen.getByLabelText("类型 视频")).toBeInTheDocument();
    expect(screen.getByText("V")).toHaveClass("h-5", "w-5");
  });
});
