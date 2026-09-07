// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SubgraphHeader } from "./SubgraphHeader";
import { useIOEditContext, type IOEditContextValue } from "./IOEditContext";
import {
  WFStoresProvider,
  createIOEditStore,
  createRgthreeGroupsStore,
  createNodeJsonViewerStore,
  type WFStores,
} from "../workflow-editor/WorkflowStores";

// vitest globals: false 下 RTL 不会自动 cleanup,需手动注册
afterEach(cleanup);

/* SubgraphHeader 内部的 NodeIdChip / IoCheckbox 依赖 WFStoresProvider 下发的
 * 三个 zustand store,因此所有用例都在真实 Provider 内渲染。 */
function makeStores(): WFStores {
  return {
    io: createIOEditStore("wf-test"),
    rgthree: createRgthreeGroupsStore({ workflowId: "wf-test", detail: null }),
    viewer: createNodeJsonViewerStore({
      detail: null,
      rawMetaById: {},
      positions: null,
      subgraphRawContext: null,
      subgraphStackLength: 0,
    }),
  };
}

/** 在 Provider 内读取真实 IOEdit 上下文并注入 SubgraphHeader 的 io prop。 */
function IoHarness({ children }: { children: (io: IOEditContextValue) => ReactNode }) {
  const io = useIOEditContext();
  return <>{children(io)}</>;
}

function renderHeader(ui: ReactNode, stores: WFStores = makeStores()) {
  render(<WFStoresProvider stores={stores}>{ui}</WFStoresProvider>);
  return stores;
}

const base = {
  title: "我的子图",
  nodeId: "42",
  accent: "#8B5CF6",
  isCollapsed: false,
};

const OUTPUT_REF = { name: "IMAGE_FINAL", label: "最终图像" };

describe("SubgraphHeader", () => {
  it("渲染标题、S 徽标与 subgraph 变体的节点 ID chip", () => {
    renderHeader(<SubgraphHeader {...base} onToggle={vi.fn()} />);
    expect(screen.getByText("我的子图")).toBeInTheDocument();
    expect(screen.getByText("S")).toBeInTheDocument();
    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText("#42").closest("button")).toHaveAttribute(
      "data-variant",
      "subgraph",
    );
  });

  it("空 title 回退为「子工作流」", () => {
    renderHeader(<SubgraphHeader {...base} title="" onToggle={vi.fn()} />);
    expect(screen.getByText("子工作流")).toBeInTheDocument();
  });

  it("展开态折叠按钮 aria-label 为「折叠子图」,点击调用 onToggle", async () => {
    const onToggle = vi.fn();
    renderHeader(<SubgraphHeader {...base} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("button", { name: "折叠子图" }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("折叠态折叠按钮 aria-label 变为「展开子图」,点击仍调用 onToggle", async () => {
    const onToggle = vi.fn();
    renderHeader(<SubgraphHeader {...base} isCollapsed onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("button", { name: "展开子图" }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("标题仅为纯文本，不渲染为可点击按钮（展开只允许右上角图标触发）", () => {
    const onEnter = vi.fn();
    renderHeader(<SubgraphHeader {...base} onToggle={vi.fn()} onEnter={onEnter} />);
    // 标题不再带 role=button，因此整行只剩右上角「展开子工作流」一个 onEnter 入口
    expect(screen.queryByRole("button", { name: "我的子图" })).not.toBeInTheDocument();
    expect(screen.getByText("我的子图")).toBeInTheDocument();
  });

  it("传入 onEnter 时渲染钻入按钮,点击触发 onEnter", async () => {
    const onEnter = vi.fn();
    renderHeader(<SubgraphHeader {...base} onToggle={vi.fn()} onEnter={onEnter} />);
    await userEvent.click(screen.getByTitle("展开子工作流"));
    expect(onEnter).toHaveBeenCalledOnce();
  });

  it("未传 onEnter 时不渲染钻入按钮", () => {
    renderHeader(<SubgraphHeader {...base} onToggle={vi.fn()} />);
    expect(screen.queryByTitle("展开子工作流")).not.toBeInTheDocument();
  });

  it("io 未传时不渲染 IO checkbox(即使提供了 outputRef)", () => {
    renderHeader(
      <SubgraphHeader {...base} onToggle={vi.fn()} outputRef={OUTPUT_REF} />,
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("io 传入但 ioEditMode 关闭时不渲染 IO checkbox", () => {
    renderHeader(
      <IoHarness>
        {(io) => (
          <SubgraphHeader {...base} onToggle={vi.fn()} io={io} outputRef={OUTPUT_REF} />
        )}
      </IoHarness>,
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("ioEditMode 开启且 outputRef 为 null 时不渲染 IO checkbox", () => {
    const stores = makeStores();
    stores.io.setState({ ioEditMode: true });
    renderHeader(
      <IoHarness>
        {(io) => <SubgraphHeader {...base} onToggle={vi.fn()} io={io} outputRef={null} />}
      </IoHarness>,
      stores,
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("ioEditMode 开启且提供 outputRef 时渲染 IO checkbox,勾选写入 store 并翻转提示", async () => {
    const stores = makeStores();
    stores.io.setState({ ioEditMode: true });
    renderHeader(
      <IoHarness>
        {(io) => (
          <SubgraphHeader {...base} onToggle={vi.fn()} io={io} outputRef={OUTPUT_REF} />
        )}
      </IoHarness>,
      stores,
    );
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toHaveAttribute("title", "点击将其暴露为工作流输出");
    await userEvent.click(checkbox);
    // key = `${nodeId}::kind::name`,direction/kind 均为 output
    expect(stores.io.getState().workflowIO["42::output::IMAGE_FINAL"]).toMatchObject({
      name: "IMAGE_FINAL",
      kind: "output",
      label: "最终图像",
    });
    expect(checkbox).toHaveAttribute("title", "已暴露为工作流输出");
  });
});
