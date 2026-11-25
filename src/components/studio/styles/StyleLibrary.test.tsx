/**
 * 风格库视图的行为契约（规范 11 §11.2）：只判用户可见的结果 —— 画风列表、
 * 勾选与「生成对比」按钮是否把动作交给 controller（逻辑层另有自己的口径）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  const toggleStyle = vi.fn();
  const generate = vi.fn();
  const setSearch = vi.fn();
  const controller = {
    catalog: {
      allCandidates: [],
      candidates: [],
      defaultMode: "T2I",
      loading: false,
      modeTabs: [],
      resolveCandidate: () => null,
    },
    characterId: "silver-mage",
    clearAll: vi.fn(),
    createError: "",
    createStyle: vi.fn(),
    creating: false,
    draft: {
      description: "",
      name: "",
      negativePrompt: "",
      promptTemplate: "",
      slug: "",
      tags: "",
    },
    draftOpen: false,
    generate,
    generating: false,
    loadError: "",
    loading: false,
    modelSelection: { mode: "T2I", model: "gpt-image" },
    notice: "",
    preview: "a girl, sakura",
    results: {},
    sceneId: "sakura-tree",
    search: "",
    selectAll: vi.fn(),
    selectedSlugs: ["anime-illustration"],
    setCharacterId: vi.fn(),
    setDraft: vi.fn(),
    setDraftOpen: vi.fn(),
    setModelSelection: vi.fn(),
    setSceneId: vi.fn(),
    setSearch,
    setUserPrompt: vi.fn(),
    styles: [
      {
        description: "日系动漫插画",
        name: "日系动漫插画",
        promptTemplate: "anime style",
        slug: "anime-illustration",
        tags: ["动漫"],
      },
      {
        description: "油画厚涂写实",
        name: "油画厚涂写实",
        promptTemplate: "oil painting",
        slug: "oil-painting",
        tags: ["油画"],
      },
    ],
    toggleStyle,
    userPrompt: "a girl",
  };
  return { controller, generate, setSearch, toggleStyle };
});

vi.mock("./hooks/use-style-library", () => ({ useStyleLibrary: () => mocks.controller }));
vi.mock("~/components/workshop/ModelCascadeSelect", () => ({
  ModelCascadeSelect: () => <div data-testid="model-select" />,
}));
vi.mock("~/components/ui/image-viewer", () => ({
  ViewableImage: ({ alt }: { alt: string }) => <img alt={alt} src="x" />,
}));
vi.mock("~/components/ui/select-menu", () => ({
  SelectMenu: ({
    "aria-label": label,
    onChange,
    value,
  }: {
    "aria-label": string;
    onChange: (value: string) => void;
    value: string;
  }) => (
    <select
      aria-label={label}
      onChange={(e) => {
        onChange(e.target.value);
      }}
      value={value}
    >
      <option value="">不选</option>
      <option value="silver-mage">银发魔法少女</option>
    </select>
  ),
}));

const { StyleLibrary } = await import("./StyleLibrary");

afterEach(cleanup);

describe("风格库视图（ISSUE #5069）", () => {
  it("列出可搜索的画风，勾选与生成都把动作交给 controller", () => {
    render(<StyleLibrary />);

    expect(screen.getAllByText("日系动漫插画").length).toBeGreaterThan(0);
    expect(screen.getAllByText("油画厚涂写实").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByLabelText("选择画风：油画厚涂写实"));
    expect(mocks.toggleStyle).toHaveBeenCalledWith("oil-painting");

    fireEvent.change(screen.getByLabelText("搜索画风提示词"), { target: { value: "动漫" } });
    expect(mocks.setSearch).toHaveBeenCalledWith("动漫");

    fireEvent.click(screen.getByRole("button", { name: "生成画风对比" }));
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });
});
