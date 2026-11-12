// 「模型适配」视图行为（ISSUE #3622）：模型清单按图像 / 视频分组、已配置的模型
// 标「已配」；同一时刻只显示一个模式的编辑卡（chip 即切换页签）；删除模式要过
// 二次确认。逻辑层（useModelAdapters）打桩 —— 本文件判的是视图行为，不是数据面。
import type { Dispatch, SetStateAction } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RemoteModeAdapter } from "~/lib/workshop/remote-model-adapter";

import { ModelAdaptersView } from "./ModelAdaptersView";
import type { ModelAdaptersController } from "./hooks/use-model-adapters";
import type { useModeContracts } from "./mode-contract/hooks/use-mode-contracts";

/** 每个用例重设的控制器（可覆盖 draft / summary 等）。声明在 vi.mock 之前：
 * 工厂闭包在调用时才读它。 */
let current: ModelAdaptersController;

vi.mock("./hooks/use-model-adapters", () => ({
  useModelAdapters: () => current,
}));

/** 模式契约钩子的替身：视图只透传它、不消费，给全字段的最小桩（无断言窄化）。 */
function stubModeContracts(): ReturnType<typeof useModeContracts> {
  return {
    configured: [],
    contracts: [],
    loading: false,
    projectDefaultEditable: false,
    refetch: vi.fn<() => Promise<never>>(),
    resetToDefault: vi.fn<() => Promise<null>>(),
    save: vi.fn(),
    saveAsProjectDefaults: vi.fn<() => Promise<null>>(),
    saving: false,
    savingProjectDefaults: false,
    resetting: false,
  };
}

/** 造一份控制器：两个图像模型 + 一个视频模型；默认选中第一个图像模型。 */
function baseController(over: Partial<ModelAdaptersController> = {}): ModelAdaptersController {
  return {
    addMode: vi.fn(),
    candidates: [
      { baseUrl: "https://a/v1", kind: "image", name: "agnes-image" },
      { baseUrl: "https://b/v1", kind: "image", name: "nova-image" },
      { baseUrl: "https://c/v1", kind: "video", name: "sora-video" },
    ],
    draft: [],
    loading: false,
    message: null,
    modeContracts: stubModeContracts(),
    save: vi.fn(() => Promise.resolve()),
    saving: false,
    summary: [],
    endpointPath: "",
    setEndpointPath: vi.fn(),
    selectedModel: "agnes-image",
    selectModel: vi.fn(),
    setDraft: vi.fn(),
    ...over,
  };
}

afterEach(() => {
  cleanup();
});

describe("模型清单：分组树与「已配」标记", () => {
  it("按 图像 / 视频 分组渲染模型行（data-model 锚身份），不再平铺 chip", () => {
    current = baseController();
    render(<ModelAdaptersView />);
    expect(document.querySelector('[data-model="agnes-image"]')).not.toBeNull();
    expect(document.querySelector('[data-model="nova-image"]')).not.toBeNull();
    expect(document.querySelector('[data-model="sora-video"]')).not.toBeNull();
    /* 分组标题由 Disclosure 的 trigger 给出。 */
    expect(screen.getByText("图像")).toBeInTheDocument();
    expect(screen.getByText("视频")).toBeInTheDocument();
  });

  it("概览里已配置适配器的模型标「已配」，没配的不标", () => {
    current = baseController({
      summary: [{ modes: ["T2I", "I2I"], name: "agnes-image" }],
    });
    render(<ModelAdaptersView />);
    /* 「已配」只出现一次（agnes-image 行内）；nova / sora 没有。 */
    expect(screen.getAllByText("已配")).toHaveLength(1);
    const agnesRow = document.querySelector('[data-model="agnes-image"]');
    expect(agnesRow?.textContent).toContain("已配");
    const novaRow = document.querySelector('[data-model="nova-image"]');
    expect(novaRow?.textContent).not.toContain("已配");
  });

  it("点一个模型行回调 selectModel", async () => {
    const user = userEvent.setup();
    const selectModel = vi.fn();
    current = baseController({ selectModel });
    render(<ModelAdaptersView />);
    /* 行按钮的可见名就是模型名（全名悬停提示走 Hint/P82，不再有原生 title）。 */
    await user.click(screen.getByText("sora-video"));
    expect(selectModel).toHaveBeenCalledWith("sora-video");
  });
});

describe("模式编辑卡：同一时刻只显示一个（chip 即页签）", () => {
  it("多模式草稿只渲染当前激活那一张卡，点 chip 切换", async () => {
    const user = userEvent.setup();
    current = baseController({
      draft: [
        {
          mode: "T2I",
          inputs: [{ type: "prompt", field: "prompt" }],
          outputField: "url",
        },
        {
          mode: "I2V",
          inputs: [{ type: "image", field: "image" }],
          outputField: "",
        },
      ],
    });
    render(<ModelAdaptersView />);
    /* 未点选时回落第一份（文生图），单图生视频的卡不在场 —— 卡标题用 heading
     * 查询（模式名同时出现在 chip 与卡头上，text 查询会撞车）。 */
    expect(screen.getByRole("heading", { name: /文生图/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /单图生视频/ })).not.toBeInTheDocument();

    /* 点「单图生视频」chip → 卡切过去。 */
    await user.click(screen.getByRole("radio", { name: /单图生视频/ }));
    expect(screen.getByRole("heading", { name: /单图生视频/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /文生图/ })).not.toBeInTheDocument();
  });

  it("端点路径是模型级一格（不在模式卡里重复出现）", () => {
    current = baseController({
      endpointPath: "/v1/images/generations",
      draft: [{ mode: "T2I", inputs: [{ type: "prompt", field: "prompt" }], outputField: "url" }],
    });
    render(<ModelAdaptersView />);
    expect(screen.getByLabelText(/端点路径/)).toBeInTheDocument();
    /* 全文件只有一处端点路径输入（模型级）；模式卡里不再有第二份。 */
    expect(screen.getAllByLabelText(/端点路径/)).toHaveLength(1);
  });
});

describe("删除模式：二次确认", () => {
  it("点 chip 的 ✕ 先弹确认，确认后才从草稿里摘掉", async () => {
    const user = userEvent.setup();
    const setDraft = vi.fn<Dispatch<SetStateAction<Array<RemoteModeAdapter>>>>();
    current = baseController({
      draft: [
        { mode: "T2I", inputs: [{ type: "prompt", field: "prompt" }], outputField: "url" },
        { mode: "I2V", inputs: [{ type: "image", field: "image" }], outputField: "" },
      ],
      setDraft,
    });
    render(<ModelAdaptersView />);

    await user.click(screen.getByRole("button", { name: "删除模式 单图生视频" }));
    /* 弹窗在场、还没删。 */
    expect(screen.getByText("删除这个模式？")).toBeInTheDocument();
    expect(setDraft).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "确认" }));
    expect(setDraft).toHaveBeenCalledTimes(1);
    /* updater 过滤掉 I2V（对真实草稿应用一次验证语义）。 */
    const updater = setDraft.mock.calls[0]?.[0];
    const t2i: RemoteModeAdapter = {
      mode: "T2I",
      inputs: [{ type: "prompt", field: "prompt" }],
      outputField: "url",
    };
    const i2v: RemoteModeAdapter = {
      mode: "I2V",
      inputs: [{ type: "image", field: "image" }],
      outputField: "",
    };
    expect(typeof updater === "function" ? updater([t2i, i2v]) : updater).toEqual([t2i]);
  });

  it("取消确认弹窗不删", async () => {
    const user = userEvent.setup();
    const setDraft = vi.fn<Dispatch<SetStateAction<Array<RemoteModeAdapter>>>>();
    current = baseController({
      draft: [{ mode: "T2I", inputs: [{ type: "prompt", field: "prompt" }], outputField: "url" }],
      setDraft,
    });
    render(<ModelAdaptersView />);
    await user.click(screen.getByRole("button", { name: "删除模式 文生图" }));
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(setDraft).not.toHaveBeenCalled();
  });
});
