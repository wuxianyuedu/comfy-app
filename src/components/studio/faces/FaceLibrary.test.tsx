/**
 * 脸库视图的行为契约（规范 11 §11.2）：只判用户可见结果 —— 搜索过滤、多选、
 * 复制、批量生图与单条取消都把动作交给 controller（逻辑层另有自己的口径）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  const cancelOne = vi.fn();
  const clearAll = vi.fn();
  const copy = vi.fn();
  const generate = vi.fn();
  const selectAll = vi.fn();
  const setQuery = vi.fn();
  const toggleFace = vi.fn();
  const presets = [
    {
      description: "银发蓝瞳的清新少女",
      id: "silver-mage",
      local: true,
      name: "银发清新少女",
      prompt: "anime girl, blue iris, silver hair",
      tags: ["蓝瞳", "银发"],
    },
    {
      description: "黑发剑士",
      id: "black-swordsman",
      local: true,
      name: "黑发剑士",
      prompt: "anime swordsman, black hair",
      tags: ["黑瞳", "黑发"],
    },
  ];
  const controller = {
    cancelOne,
    catalog: {
      allCandidates: [],
      candidates: [],
      defaultMode: "T2I",
      loading: false,
      modeTabs: [],
      resolveCandidate: () => null,
    },
    clearAll,
    copy,
    filtered: presets,
    generate,
    generating: false,
    isFacePreset: () => true,
    modelSelection: { mode: "T2I", model: "wf::1" },
    notice: "",
    prompt: "anime girl, blue iris, silver hair\nanime swordsman, black hair",
    query: "",
    results: {} as Record<string, { status: string; taskId?: string }>,
    selectAll,
    selectedIds: ["silver-mage", "black-swordsman"],
    selectedPresets: presets,
    setModelSelection: vi.fn(),
    setQuery,
    toggleFace,
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
    toggleFace,
  };
});

vi.mock("./hooks/use-face-library", () => ({ useFaceLibrary: () => mocks.controller }));
vi.mock("~/components/workshop/ModelCascadeSelect", () => ({
  ModelCascadeSelect: () => <div data-testid="model-select" />,
}));
vi.mock("~/components/ui/image-viewer", () => ({
  ViewableImage: ({ alt }: { alt: string }) => <img alt={alt} src="x" />,
}));

const { FaceLibrary } = await import("./FaceLibrary");

afterEach(() => {
  cleanup();
  mocks.controller.results = {};
  mocks.controller.selectedIds = mocks.presets.map((preset) => preset.id);
  mocks.controller.selectedPresets = mocks.presets;
});

describe("角色脸库视图（ISSUE #5087 / #5098）", () => {
  it("列出可搜索的脸部预设，复制 / 多选 / 批量生图都交给 controller", () => {
    render(<FaceLibrary />);

    expect(screen.getByRole("button", { name: "复制提示词" })).toBeTruthy();
    expect(screen.getByLabelText("选择脸部形象：银发清新少女")).toBeTruthy();
    expect(screen.getByLabelText("选择脸部形象：黑发剑士")).toBeTruthy();
    expect(screen.getByRole("button", { name: "批量生图（2）" })).toBeTruthy();

    fireEvent.click(screen.getByLabelText("选择脸部形象：黑发剑士"));
    expect(mocks.toggleFace).toHaveBeenCalledWith("black-swordsman");
    fireEvent.click(screen.getByRole("button", { name: "全选" }));
    expect(mocks.selectAll).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "清空" }));
    expect(mocks.clearAll).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("搜索脸部形象提示词"), { target: { value: "蓝瞳" } });
    expect(mocks.setQuery).toHaveBeenCalledWith("蓝瞳");

    fireEvent.click(screen.getByRole("button", { name: "复制提示词" }));
    expect(mocks.copy).toHaveBeenCalledWith(mocks.controller.prompt);

    fireEvent.click(screen.getByRole("button", { name: "批量生图（2）" }));
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });

  it("本地通道的生成中格子可单条取消，远端通道禁用并说明原因", () => {
    mocks.controller.results = {
      "silver-mage": { status: "pending", taskId: "task-1" },
      "black-swordsman": { status: "pending" },
    };
    render(<FaceLibrary />);

    fireEvent.click(screen.getByLabelText("取消生成：银发清新少女"));
    expect(mocks.cancelOne).toHaveBeenCalledWith("silver-mage");

    const remote = screen.getByLabelText("取消生成：黑发剑士");
    expect(remote.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("远端通道不可取消")).toBeTruthy();
  });
});
