// @vitest-environment jsdom
// 左侧列表的三态区分（规范 11.2 行为测试）：用户反馈的核心是「加载没拿到
// 数据」与「真的没有工作流」长得一模一样——这里锁住两者不再可混淆。

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { WorkflowLibraryList } from "./WorkflowLibraryList";
import type { PendingRow, WorkflowRow } from "./workflow-library-config";

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

// 未载入的本地工作流：整行曾整体是 <button>，点哪儿都直接载入 —— 用户只是想
// 看看名字就会误触。行为约定改为「载入动作只挂在右侧按钮上」。
describe("未载入的本地工作流：只有右侧按钮能载入", () => {
  const pending: PendingRow = {
    id: "pending-1",
    name: "分镜剧照洗图_Qwen-Edit-2511",
    sourcePath: "D:/Comfy-Desktop/workflows/story.json",
  };

  it("点击整行（名称）不载入", () => {
    const onLoadPending = vi.fn();
    renderList({ pendingRows: [pending], onLoadPending });

    fireEvent.click(screen.getByText(pending.name));

    expect(onLoadPending).not.toHaveBeenCalled();
  });

  it("点击右侧「载入」按钮才载入该行", () => {
    const onLoadPending = vi.fn();
    renderList({ pendingRows: [pending], onLoadPending });

    fireEvent.click(screen.getByRole("button", { name: "载入" }));

    expect(onLoadPending).toHaveBeenCalledTimes(1);
    expect(onLoadPending).toHaveBeenCalledWith(pending);
  });

  it("载入中：按钮禁用并改文案，避免重复载入同一份文件", () => {
    const onLoadPending = vi.fn();
    renderList({
      pendingRows: [pending],
      onLoadPending,
      pendingLoading: { [pending.id]: true },
    });

    const button = screen.getByRole("button", { name: /载入中/ });
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(onLoadPending).not.toHaveBeenCalled();
  });
});

// 整片列表侧栏是拖入 JSON 的投放区 —— 拖动中要有「松开即可」的提示，
// 读取失败也要在这片区域给出可见原因（否则用户只会觉得「拖了没反应」）。
describe("列表侧栏的拖入导入提示", () => {
  it("拖动中：显示投放提示", () => {
    renderList({ dragActive: true });

    expect(screen.getByText("松开即可读取该工作流 JSON")).toBeInTheDocument();
  });

  it("文件读取失败：把原因显示在列表上", () => {
    renderList({ fileErr: "JSON 解析失败：不是合法的工作流 JSON" });

    expect(
      screen.getByText(/JSON 解析失败：不是合法的工作流 JSON/),
    ).toBeInTheDocument();
  });
});
