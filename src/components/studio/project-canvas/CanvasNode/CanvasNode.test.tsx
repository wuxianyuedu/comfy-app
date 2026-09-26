// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NodeProps } from "@xyflow/react";
import { renderWithFlow } from "../../../../../tests/helpers/react-flow";
import { CanvasNode } from "./CanvasNode";
import {
  NODE_META,
  defaultData,
  type CanvasNodeData,
  type CanvasNodeType,
} from "~/lib/project-canvas/canvas-types";

// vitest globals: false 下 RTL 不会自动 cleanup,需手动注册
afterEach(cleanup);

/* ── 模块级 mock：~/trpc/vanilla ──
 * CanvasNode 的 use-workflow-io / use-generate / ContentAssetBody 会在挂载期
 * 触发 tRPC query（workflow.list / workflowModel.list / task.detail…）。
 * mock 返回「永不 resolve」的 pending promise：渲染冒烟不依赖列表内容，
 * 同时避免微任务里的 setState 落在 act() 外产生告警/竞态。 */
vi.mock("~/trpc/vanilla", () => {
  const pending = <T,>() =>
    // 永不 resolve:让挂载期请求保持 pending,渲染路径不依赖其结果
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- never-resolve pending 桩
    new Promise<T>(() => {});
  const query = () => vi.fn(() => pending());
  return {
    vanillaApi: {
      workflow: {
        list: { query: query() },
        detail: { query: query() },
        update: { mutate: vi.fn(() => pending()) },
      },
      workflowModel: {
        list: { query: query() },
      },
      task: {
        detail: { query: query() },
        cancel: { mutate: vi.fn(() => pending()) },
      },
    },
  };
});

/* ── NodeProps 构造：data 用 canvas-types 的 defaultData(kind) 生成 ──
 * CanvasNode 的 props 是 NodeProps<CanvasNodeType>，按 @xyflow/system 的
 * NodePropsBase 补齐必填的 flow 运行时字段（渲染冒烟只需稳定值）。 */
function makeProps(
  data: CanvasNodeData,
  id = "node-under-test",
): NodeProps<CanvasNodeType> {
  return {
    id,
    data,
    type: "canvasNode",
    selected: false,
    dragging: false,
    zIndex: 0,
    selectable: true,
    deletable: true,
    draggable: true,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  };
}

describe("CanvasNode（按 kind 渲染冒烟）", () => {
  it("kind=image：头部类型字符 I/名称「生图」+ idle 徽标 + 删除按钮 + 生成面板占位", () => {
    renderWithFlow(<CanvasNode {...makeProps(defaultData("image"))} />);
    const meta = NODE_META.image;
    expect(screen.getByText(meta.label)).toBeInTheDocument(); // 生图
    expect(screen.getByLabelText(`类型 ${meta.label}`)).toBeInTheDocument();
    expect(screen.getByText(meta.typeChar)).toBeInTheDocument(); // I
    expect(screen.getByText("待开始")).toBeInTheDocument(); // StatusBadge idle
    // 非 content-carrier 节点：头部有删除按钮
    expect(
      screen.getByRole("button", { name: "删除节点" }),
    ).toBeInTheDocument();
    // ImageGenerationPanel 三步级联：未选工作流时 CTA 为禁用占位
    expect(screen.getByText("请先选择工作流")).toBeDisabled();
    // 输出端口行（image 专属 footer）
    expect(screen.getByText("图像")).toBeInTheDocument();
  });

  it("kind=text：头部 T/「文本」+ 内容 textarea；资产节点不渲染状态徽标与删除按钮", () => {
    renderWithFlow(<CanvasNode {...makeProps(defaultData("text"))} />);
    const meta = NODE_META.text;
    expect(screen.getByText(meta.label)).toBeInTheDocument(); // 文本
    expect(screen.getByText(meta.typeChar)).toBeInTheDocument(); // T
    expect(
      screen.getByPlaceholderText("输入要喂给下游生成节点的提示词 / 参考文字…"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "编辑文本" }),
    ).toBeInTheDocument();
    // 资产节点（text/picture/movie）头部只留 NodeChip
    expect(screen.queryByText("待开始")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "删除节点" }),
    ).not.toBeInTheDocument();
  });

  it("kind=picture：头部 P/「图片」+ 拖入上传占位 + 左右两个 Handle", () => {
    const { container } = renderWithFlow(
      <CanvasNode {...makeProps(defaultData("picture"))} />,
    );
    const meta = NODE_META.picture;
    expect(screen.getByText(meta.label)).toBeInTheDocument(); // 图片
    expect(screen.getByText(meta.typeChar)).toBeInTheDocument(); // P
    expect(screen.getByText("拖入上传图片")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "上传图片" }),
    ).toBeInTheDocument();
    // 未选中时不展开 ImageGenerationPanel
    expect(screen.queryByText("请先选择工作流")).not.toBeInTheDocument();
    // 左侧 inputImage（target）+ 右侧 output（source）
    const handles = container.querySelectorAll<HTMLElement>(
      ".react-flow__handle",
    );
    expect(handles).toHaveLength(2);
  });

  it("error 状态：渲染 ErrorPanel 关键文案，展开后显示「原始错误」", async () => {
    const data: CanvasNodeData = {
      ...defaultData("image"),
      status: "error",
      error: "模拟后端崩溃：未知异常",
    };
    renderWithFlow(<CanvasNode {...makeProps(data)} />);
    // ErrorPanel 头部：errorStatus 为空 → 「未捕获异常 · client」
    expect(screen.getByText("未捕获异常")).toBeInTheDocument();
    // 折叠态 teaser 直接展示原始错误串
    expect(screen.getByText("模拟后端崩溃：未知异常")).toBeInTheDocument();
    // 展开 → 「原始错误」<details> 块出现
    await userEvent.click(screen.getByRole("button", { name: "展开错误详情" }));
    expect(screen.getByText("原始错误")).toBeInTheDocument();
  });
});
