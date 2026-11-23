// 树形模型菜单的视图行为（ISSUE #4916）：布局切换、树形分组、叶子选中回填
// 「用途 / 模式 / 模型」三态、选中态与生成中徽标、布局偏好本地持久化。
// 树构建的纯函数口径另见 model-test-tree.test.ts；本文件判交互，不判取数。
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModelTreeSelect } from "./ModelTreeSelect";
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

function renderTree(over: Partial<Parameters<typeof ModelTreeSelect>[0]> = {}) {
  const onSelect = vi.fn();
  render(
    <ModelTreeSelect
      currentKind="image"
      currentMode="T2I"
      entries={entries}
      generatingModels={new Set<string>()}
      labels={Object.fromEntries(entries.map((e) => [e.value, e.label]))}
      loading={false}
      onSelect={onSelect}
      selectedValue=""
      {...over}
    />,
  );
  return { onSelect };
}

async function openMenu(): Promise<void> {
  await userEvent.setup().click(screen.getByRole("button", { name: "选择要测试的模型" }));
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(cleanup);

describe("ModelTreeSelect", () => {
  it("默认按用途布局：用途 → 模式 → 模型，点叶子回填三态并收起浮层", async () => {
    const { onSelect } = renderTree();
    await openMenu();
    /* 三个用途组 + 图片下的模式组（对话没有模式层，叶直接挂）。 */
    expect(document.querySelector('[data-tree-key="kind:image"]')).not.toBeNull();
    expect(document.querySelector('[data-tree-key="kind:video"]')).not.toBeNull();
    expect(document.querySelector('[data-tree-key="kind:chat"]')).not.toBeNull();
    expect(screen.getByText("文生图")).toBeInTheDocument();
    expect(screen.getByText("图生图")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("radio", { name: /z-image · 工作流A/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("image", "T2I", "wf::1");
    /* 选中后浮层收起：叶子不再挂在文档里。 */
    expect(screen.queryByRole("radio", { name: /z-image · 工作流A/ })).toBeNull();
  });

  it("按来源布局：本地 / 远端两组，多模式候选只列一次，选中按当前模式解析", async () => {
    const { onSelect } = renderTree({ currentMode: "I2I" });
    await openMenu();
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
    await openMenu();
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
    await openMenu();
    await userEvent.setup().click(screen.getByRole("radio", { name: /minimax_h3/ }));
    expect(onSelect).toHaveBeenCalledWith("chat", "", "minimax_h3");
  });

  it("选中态与生成中徽标：触发器显示已选模型名 + 生成中，叶子亮 aria-checked", async () => {
    renderTree({
      currentKind: "image",
      currentMode: "T2I",
      generatingModels: new Set(["agnes"]),
      selectedValue: "agnes",
    });
    /* 触发器（未打开浮层也能看到）：显示名 + 生成中徽标。 */
    expect(screen.getByText("agnes-image")).toBeInTheDocument();
    expect(screen.getByText("生成中")).toBeInTheDocument();

    await openMenu();
    const agnesLeaf = screen.getByRole("radio", { name: /agnes-image/ });
    expect(agnesLeaf.getAttribute("aria-checked")).toBe("true");
    const otherLeaf = screen.getByRole("radio", { name: /z-image · 工作流A/ });
    expect(otherLeaf.getAttribute("aria-checked")).toBe("false");
  });

  it("布局偏好写入本地存储，重挂后恢复", async () => {
    renderTree();
    await openMenu();
    await userEvent.setup().click(screen.getByRole("radio", { name: "按来源" }));
    expect(window.localStorage.getItem("comfyapp:model-test:tree-layout")).toBe("source");

    cleanup();
    renderTree();
    await openMenu();
    expect(screen.getByText("本地模型")).toBeInTheDocument();
    expect(screen.queryByText("文生图")).toBeNull();
  });

  it("取数中显示骨架屏", async () => {
    renderTree({ loading: true });
    await openMenu();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
