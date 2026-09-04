// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WorkflowIOMap } from "@/lib/workflow-io-types";
import type { WorkflowRow } from "./workflow-library-config";
import {
  WorkflowIOThumb,
  RootGroupHeader,
  FilterTabs,
  PendingWorkflowCard,
} from "./WorkflowLibraryHelpers";

afterEach(cleanup);

describe("WorkflowIOThumb", () => {
  const io: WorkflowIOMap = {
    "10:out:0": {
      direction: "output",
      kind: "output",
      nodeId: "10",
      name: "IMAGE",
      nodeTitle: "VAE Decode",
    },
    "9:in:0": {
      direction: "input",
      kind: "param",
      nodeId: "9",
      name: "model",
      nodeTitle: "Load Checkpoint",
    },
  };

  it("渲染非空 IO 映射为输入/输出徽标", () => {
    const { container } = render(<WorkflowIOThumb io={io} />);
    expect(screen.getByText("IMAGE")).toBeInTheDocument();
    expect(screen.getByText("model")).toBeInTheDocument();
    expect(container).toMatchSnapshot();
  });

  it("空 IO 映射返回 null（不渲染）", () => {
    const { container } = render(<WorkflowIOThumb io={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("RootGroupHeader", () => {
  it("渲染路径、计数与展开态", () => {
    const { container } = render(
      <RootGroupHeader
        rawPath={"D:\\workflows\\demo"}
        count={3}
        exists
        collapsed={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText("D:\\workflows\\demo")).toBeInTheDocument();
    // 「找到 N 个文件」与前缀「只读扫描 ·」同处一个文本节点,按子串断言
    expect(container.textContent).toContain("找到 3 个文件");
    expect(container).toMatchSnapshot();
  });

  it("目录不存在时显示「目录不存在」", () => {
    render(
      <RootGroupHeader
        rawPath={"D:\\gone"}
        count={0}
        exists={false}
        collapsed
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText("目录不存在")).toBeInTheDocument();
  });
});

describe("FilterTabs", () => {
  const tabs = [
    { key: "all", label: "全部", count: 3 },
    { key: "api", label: "API", count: 1 },
  ] as const;

  it("渲染所有 tab 与计数徽标,激活项可识别", () => {
    const { container } = render(
      <FilterTabs
        tabs={tabs}
        active="all"
        onChange={vi.fn()}
        accent="violet"
      />,
    );
    expect(screen.getByText("全部")).toBeInTheDocument();
    expect(screen.getByText("API")).toBeInTheDocument();
    expect(container).toMatchSnapshot();
  });

  it("点击非激活 tab 触发 onChange", async () => {
    const onChange = vi.fn();
    render(
      <FilterTabs tabs={tabs} active="all" onChange={onChange} accent="sky" />,
    );
    await userEvent.click(screen.getByText("API"));
    expect(onChange).toHaveBeenCalledWith("api");
  });
});

describe("PendingWorkflowCard", () => {
  const w: WorkflowRow & { pendingSize?: number } = {
    id: "wf-x",
    name: "我的工作流",
    taskType: "t2i",
    createdAt: "2026-01-01T00:00:00.000Z",
    sourcePath: "D:\\x\\y.json",
    pendingSize: 2048,
  };

  it("渲染名称、大小与载入按钮", () => {
    const { container } = render(
      <PendingWorkflowCard w={w} isLoading={false} onLoad={vi.fn()} />,
    );
    expect(screen.getByText("我的工作流")).toBeInTheDocument();
    // 「2.0 KB」与前缀「未载入 ·」同处一个文本节点,按子串断言
    expect(container.textContent).toContain("2.0 KB");
    expect(screen.getByRole("button", { name: "⤓ 载入" })).toBeInTheDocument();
    expect(container).toMatchSnapshot();
  });

  it("载入中按钮 disabled", () => {
    render(<PendingWorkflowCard w={w} isLoading onLoad={vi.fn()} />);
    expect(screen.getByRole("button", { name: "载入中…" })).toBeDisabled();
  });
});
