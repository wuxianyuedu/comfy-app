// 页面树的视图行为（ISSUE #4952）：用途 / 模式 / 模型在左栏就地成树，
// 布局切换、叶子选中回填三态、选中态与生成中徽标、布局偏好本地持久化。
// 树构建的纯函数口径另见 model-test-tree.test.ts；本文件判交互，不判取数。
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModelTestTree } from "./ModelTestTree";
import type { ModelTreeEntry } from "./model-test-tree";

const entries: Array<ModelTreeEntry> = [
  {
    kind: "image",
    label: "z-image · 工作流A",
    local: true,
    mode: "T2I",
    modelName: "z-image",
    value: "wf::1",
  },
  {
    kind: "image",
    label: "z-image · 工作流B",
    local: true,
    mode: "I2I",
    modelName: "z-image",
    value: "wf::2",
  },
  {
    kind: "image",
    label: "agnes-image",
    local: false,
    mode: "T2I",
    modelName: "agnes-image",
    value: "agnes",
  },
  {
    kind: "image",
    label: "dual-model",
    local: false,
    mode: "T2I",
    modelName: "dual-model",
    value: "dual",
  },
  {
    kind: "image",
    label: "dual-model",
    local: false,
    mode: "I2I",
    modelName: "dual-model",
    value: "dual",
  },
  {
    kind: "video",
    label: "nova-video",
    local: false,
    mode: "T2V",
    modelName: "nova-video",
    value: "nova",
  },
  {
    kind: "chat",
    label: "minimax_h3",
    local: true,
    mode: "",
    modelName: "minimax_h3",
    value: "minimax_h3",
  },
];

function renderTree(over: Partial<Parameters<typeof ModelTestTree>[0]> = {}) {
  const onSelect = vi.fn();
  render(
    <ModelTestTree
      currentKind="image"
      currentMode="T2I"
      entries={entries}
      generatingModels={new Set<string>()}
      loading={false}
      onSelect={onSelect}
      selectedValue=""
      {...over}
    />,
  );
  return { onSelect };
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(cleanup);

describe("ModelTestTree", () => {
  it("默认是页面上的树：用途 → 模式 → 模型就地可见，点叶子回填三态", async () => {
    const { onSelect } = renderTree();
    /* 三个用途组 + 图片下的模式组（对话没有模式层，叶直接挂）。 */
    expect(document.querySelector('[data-tree-key="kind:image"]')).not.toBeNull();
    expect(document.querySelector('[data-tree-key="kind:video"]')).not.toBeNull();
    expect(document.querySelector('[data-tree-key="kind:chat"]')).not.toBeNull();
    expect(screen.getByText("文生图")).toBeInTheDocument();
    expect(screen.getByText("图生图")).toBeInTheDocument();
    /* 不再有「选择要测试的模型…」下拉触发器：树就在页面上。 */
    expect(screen.queryByRole("button", { name: "选择要测试的模型" })).toBeNull();

    await userEvent.setup().click(screen.getByRole("radio", { name: /z-image · 工作流A/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("image", "T2I", "wf::1");
    /* 点完叶子树仍在页面上，不会像浮层那样收起。 */
    expect(screen.getByRole("radio", { name: /z-image · 工作流A/ })).toBeInTheDocument();
  });

  it("按来源布局：本地 / 远端两组，多模式候选只列一次，选中按当前模式解析", async () => {
    const { onSelect } = renderTree({ currentMode: "I2I" });
    await userEvent.setup().click(screen.getByRole("radio", { name: "按来源" }));

    expect(screen.getByText("本地模型")).toBeInTheDocument();
    expect(screen.getByText("远端模型")).toBeInTheDocument();
    /* dual 在 T2I / I2I 各有一条目，来源布局只列一次。 */
    expect(screen.getAllByRole("radio", { name: /dual-model/ })).toHaveLength(1);

    /* 当前模式是 I2I：来源布局选中 dual 落 I2I 格，不落第一条（T2I）。 */
    await userEvent.setup().click(screen.getAllByRole("radio", { name: /dual-model/ })[0]!);
    expect(onSelect).toHaveBeenCalledWith("image", "I2I", "dual");
  });

  it("按模型布局：模型名 → 模式 → 条目，同一模型的多个工作流分开列", async () => {
    const { onSelect } = renderTree();
    await userEvent.setup().click(screen.getByRole("radio", { name: "按模型" }));

    /* 模型组与其下的两个模式组都在（data-tree-key 是稳定锚，不随文案变）。 */
    expect(document.querySelector('[data-tree-key="model:l::z-image"]')).not.toBeNull();
    expect(document.querySelector('[data-tree-key="model:l::z-image:T2I"]')).not.toBeNull();
    expect(document.querySelector('[data-tree-key="model:l::z-image:I2I"]')).not.toBeNull();

    await userEvent.setup().click(screen.getByRole("radio", { name: /z-image · 工作流B/ }));
    expect(onSelect).toHaveBeenCalledWith("image", "I2I", "wf::2");
  });

  it("跨用途选中：图片页里点对话模型，整条切到对话", async () => {
    const { onSelect } = renderTree({ currentKind: "image", currentMode: "T2I" });
    await userEvent.setup().click(screen.getByRole("radio", { name: /minimax_h3/ }));
    expect(onSelect).toHaveBeenCalledWith("chat", "", "minimax_h3");
  });

  it("选中态与生成中徽标：叶子亮 aria-checked，用途 / 模式组带不同取值计数徽标", () => {
    renderTree({
      currentKind: "image",
      currentMode: "T2I",
      generatingModels: new Set(["agnes"]),
      selectedValue: "agnes",
    });
    const agnesLeaf = screen.getByRole("radio", { name: /agnes-image/ });
    expect(agnesLeaf.getAttribute("aria-checked")).toBe("true");
    const otherLeaf = screen.getByRole("radio", { name: /z-image · 工作流A/ });
    expect(otherLeaf.getAttribute("aria-checked")).toBe("false");

    /* 「用途」组和它下面的「文生图」组各有一枚「1 生成中」（同一取值按组去重）。 */
    expect(screen.getAllByText("1 生成中")).toHaveLength(2);
  });

  it("布局偏好写入本地存储，重挂后恢复", async () => {
    renderTree();
    await userEvent.setup().click(screen.getByRole("radio", { name: "按来源" }));
    expect(window.localStorage.getItem("comfyapp:model-test:tree-layout")).toBe("source");

    cleanup();
    renderTree();
    expect(screen.getByText("本地模型")).toBeInTheDocument();
    expect(screen.queryByText("文生图")).toBeNull();
  });

  it("取数中显示骨架屏", () => {
    renderTree({ loading: true });
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("没有候选时给可读空态", () => {
    renderTree({ entries: [] });
    expect(screen.getByText(/还没有可测的模型/)).toBeInTheDocument();
  });
});

/* ISSUE #4978（取代 #4983 的「随内容走」档——两者口径相反，按派发者对 #4978 的
 * 明确口径执行）：左栏卡片占满窗口可用高度，树形容器填满卡片剩余高度并独立
 * 滚动——min-h-0 flex-1 打底、overflow-y-auto 收滚动、不设固定 max-h 上限。
 * 谁把内部滚动摘掉或把固定 max-h 加回来就红。 */
describe("树形容器的高度契约（ISSUE #4978）", () => {
  it("容器填满卡片剩余高度并独立滚动：min-h-0 flex-1 + overflow-y-auto，无固定 max-h", () => {
    renderTree();
    const container = document.querySelector('[aria-label="用途 / 模式 / 模型树"]');
    expect(container).not.toBeNull();
    const cls = container?.className ?? "";
    expect(cls).toContain("min-h-0");
    expect(cls).toContain("flex-1");
    expect(cls).toContain("overflow-y-auto");
    expect(cls).not.toContain("max-h-");
  });
});
