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
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
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

// 列表项的空间预算（ISSUE #716）：名称 + 徽标必须排在一行里，且每个徽标
// 都对应用户要看的那个事实。
//
// 现场是「名称太长 + 徽标带一整句中文」两件事同时发生：名称把整行撑破，
// 右侧的「对外参数未配置」「本地」被侧栏的 `overflow-hidden` 裁掉 ——
// 用户看到的是「列表内容超框」。判据因此分两条：
//   ① 名称有显式最大宽度（可截断的那块有下限，徽标一律不被压）；
//   ② 对外参数只留 1 字状态标记，完整口径在 `title` 里。
describe("列表项：名称限长 + 对外参数精简显示", () => {
  const longName = "22WorkflowsI2VSVI2_fastfidelityCAIoV88";

  it("名称有显式最大宽度，不会把右侧徽标挤出侧栏", () => {
    renderList({ workflows: [row({ name: longName })] });

    const name = screen.getByText(longName);
    expect(name.className).toContain("truncate");
    expect(name.className).toMatch(/\bmax-w-\d/);
    /* 完整名称仍可从 title 读到（截断只发生在视觉上）。 */
    expect(name.getAttribute("title")).toBe(longName);
  });

  it("对外参数收成一枚 1 字标记，完整说明在 title 里", () => {
    renderList({
      workflows: [
        row({
          name: "image_z_image_int8_t2i",
          /* T2I 模式的必备口全部有落点 = ready。两样都要：IO 给候选端口，
             paramMap 给作者画的线 —— 只给 IO 是「有候选没落点」，仍是未配置。 */
          taskType: "T2I",
          defaultMode: "T2I",
          workflowIO: {
            "1::text": {
              direction: "input",
              kind: "widget",
              nodeId: "1",
              name: "text",
              type: "STRING",
            },
            "2::text": {
              direction: "input",
              kind: "widget",
              nodeId: "2",
              name: "negative",
              type: "STRING",
            },
            "3::width": {
              direction: "input",
              kind: "widget",
              nodeId: "3",
              name: "width",
              type: "INT",
            },
            "3::height": {
              direction: "input",
              kind: "widget",
              nodeId: "3",
              name: "height",
              type: "INT",
            },
          },
          /* 按 `WorkflowParamMap` 的真实三层形状构造 —— 断言不再需要放宽类型：
             声明的就是这个形状，夹具写得出就编译得过。 */
          paramMap: {
            source: {
              "mode:T2I": {
                prompt: "1::text",
                negative: "2::text",
                "size-width": "3::width",
                "size-height": "3::height",
              },
            },
          },
        }),
      ],
    });

    /* 不再出现整句「对外参数已配置 / 未配置」——它曾与名称争夺同一行宽度。 */
    expect(screen.queryByText("对外参数未配置")).toBeNull();
    expect(screen.queryByText("对外参数已配置")).toBeNull();

    /* 标记本身带得动信息：✅ 表示配好了，title 里给出口径。 */
    const mark = screen.getByTitle(/对外参数已配置/);
    expect(mark.textContent).toBe("✓");
  });

  it("没配对外参数时标记是 ！，title 说清缺哪些口", () => {
    renderList({
      workflows: [row({ name: "image_SenseNova-U1.5_edit", taskType: "T2I" })],
    });

    const mark = screen.getByTitle(/对外参数未配置/);
    expect(mark.textContent).toBe("！");
  });

  it("不可执行的工作流仍显示「无可执行内容」（这条是闸门，不是元信息）", () => {
    renderList({
      workflows: [row({ name: "坏掉的", hasRaw: false })],
    });

    expect(screen.getByText("无可执行内容")).toBeInTheDocument();
  });
});
