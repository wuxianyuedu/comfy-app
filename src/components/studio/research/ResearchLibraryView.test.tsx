/**
 * 调研页共用视图的行为契约（规范 11 §11.2）：只判用户可见结果 —— 搜索 / 多选 /
 * 复制 / 批量生图都把动作交给 controller；结果卡能把本地与远端成品送进入库弹窗。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const cancelOne = vi.fn();
  const clearAll = vi.fn();
  const copy = vi.fn();
  const generate = vi.fn();
  const selectAll = vi.fn();
  const setQuery = vi.fn();
  const togglePreset = vi.fn();
  const presets = [
    {
      description: "第一件服饰",
      id: "first",
      local: true,
      name: "甲服饰",
      prompt: "first prompt",
      tags: ["甲"],
    },
    {
      description: "第二件服饰",
      id: "second",
      local: false,
      name: "乙服饰",
      prompt: "second prompt",
      tags: ["乙"],
    },
  ];
  const controller = {
    cancelOne,
    catalog: { resolveCandidate: () => null },
    clearAll,
    copy,
    filtered: presets,
    generate,
    generating: false,
    modelSelection: { mode: "T2I", model: "wf::1" },
    notice: "",
    prompt: "prefix, first prompt",
    query: "",
    results: {} as Record<
      string,
      {
        prompt?: string;
        status: "pending" | "cancelling" | "cancelled" | "done" | "failed";
        taskId?: string;
        url?: string;
      }
    >,
    selectAll,
    selectedIds: ["first", "second"],
    selectedPresets: presets,
    setModelSelection: vi.fn(),
    setQuery,
    togglePreset,
  };
  return {
    cancelOne,
    clearAll,
    controller,
    copy,
    generate,
    presets,
    selectAll,
    setQuery,
    togglePreset,
  };
});

vi.mock("~/components/workshop/ModelCascadeSelect", () => ({
  ModelCascadeSelect: () => <div data-testid="model-select" />,
}));
vi.mock("~/components/ui/image-viewer", () => ({
  ViewableImage: ({ alt }: { alt: string }) => <img alt={alt} src="x" />,
}));
vi.mock("~/components/studio/assets/AddToAssetLibraryDialog", () => ({
  AddToAssetLibraryDialog: ({
    candidate,
    taskId,
  }: {
    candidate: { sourceUrl: string } | null;
    taskId: string | null;
  }) => (
    <div
      data-candidate={candidate?.sourceUrl ?? ""}
      data-task-id={taskId ?? ""}
      data-testid="add-to-library"
    />
  ),
}));

const { ResearchLibraryView } = await import("./ResearchLibraryView");

const config = {
  buildPrompt: (preset: { prompt: string }) => `prefix, ${preset.prompt}`,
  category: "character" as const,
  emptyHint: "先选一件",
  footnote: "测试说明",
  itemLabel: "服饰",
  negative: () => "负向词",
  presets: mocks.presets,
  searchPlaceholder: "搜索服饰",
  view: "costumes" as const,
};

afterEach(() => {
  cleanup();
  mocks.controller.results = {};
  mocks.controller.selectedIds = mocks.presets.map((preset) => preset.id);
  mocks.controller.selectedPresets = mocks.presets;
});

describe("调研页共用视图（ISSUE #5125 / #5126）", () => {
  it("列出预设，搜索 / 全选 / 清空 / 复制 / 批量生图都交给 controller", () => {
    render(<ResearchLibraryView config={config} controller={mocks.controller} />);

    expect(screen.getByRole("button", { name: "复制提示词" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("搜索服饰提示词"), { target: { value: "旗袍" } });
    expect(mocks.setQuery).toHaveBeenCalledWith("旗袍");

    fireEvent.click(screen.getByRole("button", { name: "全选" }));
    expect(mocks.selectAll).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "清空" }));
    expect(mocks.clearAll).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "复制提示词" }));
    expect(mocks.copy).toHaveBeenCalledWith("prefix, first prompt");
    fireEvent.click(screen.getByRole("button", { name: "批量生图（2）" }));
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });

  it("本地通道结果把 taskId 送进入库弹窗", () => {
    mocks.controller.results = {
      first: { status: "done", taskId: "task-local", url: "https://example.test/a.png" },
    };
    render(<ResearchLibraryView config={config} controller={mocks.controller} />);
    fireEvent.click(screen.getByRole("button", { name: "把「甲服饰」加入资产库" }));
    const dialog = screen.getByTestId("add-to-library");
    expect(dialog.dataset.taskId).toBe("task-local");
    expect(dialog.dataset.candidate).toBe("");
  });

  it("远端通道结果把 URL 作为候选送进入库弹窗", () => {
    mocks.controller.results = {
      second: { prompt: "second prompt", status: "done", url: "https://example.test/b.png" },
    };
    render(<ResearchLibraryView config={config} controller={mocks.controller} />);
    fireEvent.click(screen.getByRole("button", { name: "把「乙服饰」加入资产库" }));
    const dialog = screen.getByTestId("add-to-library");
    expect(dialog.dataset.candidate).toBe("https://example.test/b.png");
    expect(dialog.dataset.taskId).toBe("");
  });
});
