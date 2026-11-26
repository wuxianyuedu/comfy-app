/**
 * 脸库视图的行为契约（规范 11 §11.2）：只判用户可见结果 —— 搜索过滤、选中、
 * 复制与生图都把动作交给 controller（逻辑层另有自己的口径）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  const setQuery = vi.fn();
  const setSelectedId = vi.fn();
  const copy = vi.fn();
  const generate = vi.fn();
  const controller = {
    catalog: {
      allCandidates: [],
      candidates: [],
      defaultMode: "T2I",
      loading: false,
      modeTabs: [],
      resolveCandidate: () => null,
    },
    copy,
    filtered: [
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
    ],
    generate,
    generating: false,
    isFacePreset: () => true,
    modelSelection: { mode: "T2I", model: "wf::1" },
    notice: "",
    prompt: "anime character face close-up, anime girl, blue iris, silver hair",
    query: "",
    result: { status: "pending" },
    selected: {
      description: "银发蓝瞳的清新少女",
      id: "silver-mage",
      local: true,
      name: "银发清新少女",
      prompt: "anime girl, blue iris, silver hair",
      tags: ["蓝瞳", "银发"],
    },
    selectedId: "silver-mage",
    setModelSelection: vi.fn(),
    setQuery,
    setSelectedId,
  };
  return { controller, copy, generate, setQuery, setSelectedId };
});

vi.mock("./hooks/use-face-library", () => ({ useFaceLibrary: () => mocks.controller }));
vi.mock("~/components/workshop/ModelCascadeSelect", () => ({
  ModelCascadeSelect: () => <div data-testid="model-select" />,
}));
vi.mock("~/components/ui/image-viewer", () => ({
  ViewableImage: ({ alt }: { alt: string }) => <img alt={alt} src="x" />,
}));

const { FaceLibrary } = await import("./FaceLibrary");

afterEach(cleanup);

describe("角色脸库视图（ISSUE #5087）", () => {
  it("列出可搜索的脸部预设，复制 / 选中 / 生图都交给 controller", () => {
    render(<FaceLibrary />);

    expect(screen.getByRole("button", { name: "复制提示词" })).toBeTruthy();
    expect(screen.getByLabelText("选择脸部形象：银发清新少女")).toBeTruthy();
    expect(screen.getByLabelText("选择脸部形象：黑发剑士")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("选择脸部形象：黑发剑士"));
    expect(mocks.setSelectedId).toHaveBeenCalledWith("black-swordsman");

    fireEvent.change(screen.getByLabelText("搜索脸部形象提示词"), { target: { value: "蓝瞳" } });
    expect(mocks.setQuery).toHaveBeenCalledWith("蓝瞳");

    fireEvent.click(screen.getByRole("button", { name: "复制提示词" }));
    expect(mocks.copy).toHaveBeenCalledWith(mocks.controller.prompt);

    fireEvent.click(screen.getByRole("button", { name: "用这张脸生图" }));
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });
});
