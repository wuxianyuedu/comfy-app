// @vitest-environment jsdom
// 左侧列表的三态区分（规范 11.2 行为测试）：用户反馈的核心是「加载没拿到
// 数据」与「真的没有工作流」长得一模一样——这里锁住两者不再可混淆。

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { WorkflowLibraryList } from "./WorkflowLibraryList";
import type { WorkflowRow } from "./workflow-library-config";

afterEach(cleanup);

function row(over: Partial<WorkflowRow> = {}): WorkflowRow {
  return {
    id: "wf-1",
    name: "演示工作流",
    taskType: "t2i",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

function renderList(props: Partial<Parameters<typeof WorkflowLibraryList>[0]>) {
  return render(
    <WorkflowLibraryList
      workflows={[]}
      search=""
      onSearchChange={() => undefined}
      onSelect={() => undefined}
      {...props}
    />,
  );
}

describe("WorkflowLibraryList 三态区分", () => {
  it("仍在加载：显示加载进度，不冒充「未找到匹配的工作流」", () => {
    renderList({ loading: true });

    expect(screen.getByText("正在加载工作流…")).toBeInTheDocument();
    expect(screen.queryByText("未找到匹配的工作流")).toBeNull();
    expect(screen.queryByText("还没有工作流")).toBeNull();
  });

  it("加载超时：给出可重试出口与日志面板指引，不假装是空库", () => {
    renderList({ stalled: true, onRefresh: vi.fn() });

    expect(screen.getByText("工作流列表还没返回")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.getByText(/日志面板/)).toBeInTheDocument();
  });

  it("确实没有工作流：空态说明下一步（导入 / 配置本地目录）", () => {
    renderList({});

    expect(screen.getByText("还没有工作流")).toBeInTheDocument();
    expect(
      screen.getByText(/导入工作流|配置本地工作流目录/),
    ).toBeInTheDocument();
  });

  it("搜索无结果：空态改为「未找到匹配的工作流」，并提示清空搜索", () => {
    renderList({ search: "不存在的名字" });

    expect(screen.getByText("未找到匹配的工作流")).toBeInTheDocument();
    expect(screen.getByText(/清空搜索框/)).toBeInTheDocument();
  });

  it("有数据时不渲染任何空态", () => {
    renderList({ workflows: [row()] });

    expect(screen.getByText("演示工作流")).toBeInTheDocument();
    expect(screen.queryByText("还没有工作流")).toBeNull();
    expect(screen.queryByText("正在加载工作流…")).toBeNull();
  });
});
