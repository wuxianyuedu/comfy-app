// 左侧列表的三态区分（规范 11.2 行为测试）：用户反馈的核心是「加载没拿到
// 数据」与「真的没有工作流」长得一模一样——这里锁住两者不再可混淆。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkflowLibraryList } from "./WorkflowLibraryList";
import { TooltipProvider } from "~/components/ui/tooltip";
import type { ModeContract } from "~/lib/workshop/model-mode-contract";
import type { PendingRow, WorkflowRow } from "./workflow-library-config";

/* 列表行的封装状态读「模式契约生效注册表」（本机覆盖优先，ISSUE #4113）。
 * 这里用可变桩代替真查询，逐格写入要模拟的覆盖。 */
const modeContractsStub = vi.hoisted(() => ({ contracts: [] as Array<ModeContract> }));
vi.mock("~/components/workshop/mode-contract/hooks/use-mode-contracts", () => ({
  useModeContracts: () => modeContractsStub,
}));

afterEach(cleanup);

beforeEach(() => {
  modeContractsStub.contracts = [];
});

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
  /* `Hint` 的浮层要 `TooltipProvider`（应用里挂在根布局上）；`delay={0}` 让
   * 悬停断言不必干等。 */
  return render(
    <TooltipProvider delay={0}>
      <WorkflowLibraryList
        onSearchChange={() => undefined}
        onSelect={() => undefined}
        search=""
        workflows={[]}
        {...props}
      />
    </TooltipProvider>,
  );
}

describe("WorkflowLibraryList 三态区分", () => {
  it("仍在加载：列表呈骨架行，不冒充「未找到匹配的工作流」（ISSUE #4073：转圈交给右侧详情区）", () => {
    renderList({ loading: true });

    /* 加载态收成骨架行（aria 标签念「正在加载工作流列表」——与右栏详情骨架
     * 的「正在加载工作流详情」可区分，ISSUE #4516），不再用带转圈的
     * 整块加载界面占住列表列。 */
    expect(screen.getByLabelText("正在加载工作流列表")).toBeInTheDocument();
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
    expect(screen.getByText(/导入工作流|配置本地工作流目录/)).toBeInTheDocument();
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

    expect(screen.getByText(/JSON 解析失败：不是合法的工作流 JSON/)).toBeInTheDocument();
  });
});

// 列表项的空间预算（ISSUE #716 / #5058）：名称 + 徽标必须排在一行，且每个徽标都
// 对应用户要看的那个事实。名称过长会撑破行、徽标被侧栏 `overflow-hidden` 裁掉。
// 判据两条：① 名称吃行内剩余宽度（flex-1 + min-w-0 + truncate，徽标 shrink-0
// 不被压、也不被挤出）；② 对外参数只留 1 字状态标记，完整口径在 `title` 里。
describe("列表项：名称占满剩余宽 + 对外参数精简显示", () => {
  const longName = "22WorkflowsI2VSVI2_fastfidelityCAIoV88";

  it("名称吃行内剩余宽度并截断，不会把右侧徽标挤出侧栏", async () => {
    const user = userEvent.setup();
    renderList({ workflows: [row({ name: longName })] });

    const name = screen.getByText(longName);
    expect(name.className).toContain("truncate");
    expect(name.className).toContain("flex-1");
    expect(name.className).toContain("min-w-0");
    /* 原生 title= 撤干净：完整名称走 <Hint>，悬停出完整名。 */
    expect(name).not.toHaveAttribute("title");
    await user.hover(name);
    await waitFor(() => {
      expect(document.querySelector('[data-slot="tooltip-content"]')).toBeInTheDocument();
    });
    expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toBe(longName);
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

  it("列表行徽标按本机契约覆盖列缺口，不回落内置 6 口（ISSUE #4113）", () => {
    /* 用户把文生图契约改成 4 口（必备 = 提示词 + 尺寸）后，列表行的缺口
     * 清单必须跟着这份覆盖走——不再列出未加入契约的角色 LoRA / LoRA 强度。 */
    modeContractsStub.contracts = [
      {
        mode: "T2I",
        inputs: ["prompt", "negative", "size", "seed"],
        required: ["prompt", "size"],
      },
    ];
    renderList({
      workflows: [row({ name: "image_z_image_int8_t2i", taskType: "T2I", defaultMode: "T2I" })],
    });

    const mark = screen.getByTitle(/对外参数未配置/);
    expect(mark.getAttribute("title")).toContain("种子");
    expect(mark.getAttribute("title")).not.toContain("角色 LoRA");
    expect(mark.getAttribute("title")).not.toContain("LoRA 强度");
  });

  it("不可执行的工作流仍显示「无可执行内容」（这条是闸门，不是元信息）", () => {
    renderList({
      workflows: [row({ name: "坏掉的", hasRaw: false })],
    });

    expect(screen.getByText("无可执行内容")).toBeInTheDocument();
  });
});

/* #4464：列表查询硬失败（服务 500 等）是第四态 —— 不能落进「还没有工作流」
 * 的空态（像是工作流全没了），要给失败原因与重试入口。 */
describe("WorkflowLibraryList 查询失败态（#4464）", () => {
  it("列表为空且查询失败：显示「加载失败」+ 重试按钮，不显示「还没有工作流」", () => {
    const onRefresh = vi.fn();
    renderList({ loadError: "服务暂时不可用（500）", onRefresh });

    expect(screen.getByText("工作流列表加载失败")).toBeInTheDocument();
    expect(screen.getByText(/服务暂时不可用/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.queryByText("还没有工作流")).toBeNull();
  });

  it("点击重试触发 onRefresh", () => {
    const onRefresh = vi.fn();
    renderList({ loadError: "服务暂时不可用（500）", onRefresh });

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("查询失败但列表里还有数据（后台刷新失败）：照常显示数据行", () => {
    renderList({ loadError: "服务暂时不可用（500）", workflows: [row()], onRefresh: vi.fn() });

    expect(screen.getByText("演示工作流")).toBeInTheDocument();
    expect(screen.queryByText("工作流列表加载失败")).toBeNull();
  });
});

/* #4667：列表行只单行显示——参考图挂载徽标与模型标签不再上列表（前者意义
 * 不大，后者挤行），单行保留基本信息 = 名称 + 类型 + 状态徽标 + 来源。 */
describe("列表只单行显示（#4667）", () => {
  it("paramMap 里有挂载节点也不再显示「参考图挂载」徽标", () => {
    renderList({
      workflows: [row({ paramMap: { referenceLoaders: { mountNodeIds: ["45", "69"] } } })],
    });

    expect(screen.queryByText(/参考图挂载/)).toBeNull();
  });

  it("模型标签不再上列表行（完整信息在详情页）", () => {
    renderList({
      workflows: [row({ modelTags: ["特殊模型标签甲", "特殊模型标签乙"] })],
    });

    expect(screen.queryByText("特殊模型标签甲")).toBeNull();
    expect(screen.queryByText("特殊模型标签乙")).toBeNull();
  });

  it("任务类型徽标保留在单行上（基本信息）", () => {
    renderList({ workflows: [row({ name: "image_z_image_int8_t2i", taskType: "T2I" })] });

    expect(screen.getByText("文生图")).toBeInTheDocument();
  });
});

describe("搜索清空钮（ISSUE #5058）", () => {
  it("有输入时出现清空钮，点击回调 onSearchChange(空串)", async () => {
    const onSearchChange = vi.fn();
    const user = userEvent.setup();
    renderList({ search: "minimax", onSearchChange });

    await user.click(screen.getByRole("button", { name: "清空搜索" }));
    expect(onSearchChange).toHaveBeenCalledWith("");
  });

  it("无输入时不显示清空钮", () => {
    renderList({ search: "" });

    expect(screen.queryByRole("button", { name: "清空搜索" })).not.toBeInTheDocument();
  });
});
