// @vitest-environment jsdom
// 模型列表的档位区：共享档位表要真的落到界面上才算数。
//
// 此前这里另写了一份 FILTERS、少了「放大」，而卡片却会渲染「放大」的徽标 ——
// 那一类模型看得见却筛不出来。本文件守的就是这个消费点：档位数量与共享表对齐、
// 「放大」确实在、点它会把类型下发给取数层。
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

import { ModelLibrary } from "./ModelLibrary";
import { MODEL_TYPE_FILTERS } from "./model-type-labels";
import type { ModelLibraryController } from "./hooks/use-model-library";

const controllerMock = vi.hoisted(() => vi.fn<() => ModelLibraryController>());

vi.mock("./hooks/use-model-library", () => ({
  useModelLibrary: (): ModelLibraryController => controllerMock(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** 同步桩：什么都不做，只要求是个可 await 的函数。 */
async function noopAsync() {
  /* 刻意留空 —— 断言的是「按钮有没有把这次点击交给 sync」，不是同步本身 */
}

function controller(
  over: Partial<ModelLibraryController> = {},
): ModelLibraryController {
  return {
    models: [],
    type: "",
    setType: vi.fn(),
    q: "",
    setQ: vi.fn(),
    loading: false,
    syncing: false,
    sync: vi.fn(noopAsync),
    ...over,
  };
}

describe("ModelLibrary 档位区", () => {
  it("渲染的档位数与共享档位表一致（不多不少，不各写一份）", () => {
    controllerMock.mockReturnValue(controller());
    render(<ModelLibrary />);
    for (const filter of MODEL_TYPE_FILTERS) {
      expect(
        screen.getByRole("button", { name: filter.label }),
        `缺档位「${filter.label}」`,
      ).toBeTruthy();
    }
  });

  it("「放大」这一档在界面上，点它把 UPSCALE 下发给取数层", () => {
    const setType = vi.fn();
    controllerMock.mockReturnValue(controller({ setType }));
    render(<ModelLibrary />);
    fireEvent.click(screen.getByRole("button", { name: "放大" }));
    expect(setType).toHaveBeenCalledWith("UPSCALE");
  });

  it("当前档位有选中态（用户能看出现在看的是哪一档）", () => {
    controllerMock.mockReturnValue(controller({ type: "LORA" }));
    render(<ModelLibrary />);
    expect(
      screen
        .getByRole("button", { name: "LoRA" })
        .className.includes("bg-primary-soft"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "大模型" })
        .className.includes("bg-primary-soft"),
    ).toBe(false);
  });

  it("取数中给骨架，不提前说「暂无模型」（首屏闪一句空态会把用户支去点同步）", () => {
    controllerMock.mockReturnValue(controller({ loading: true }));
    const { container } = render(<ModelLibrary />);
    expect(screen.queryByText(/暂无可用的本地模型/)).toBeNull();
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(
      8,
    );
  });

  it("确实为空时给一句能照着做的说明（要说出 ComfyUI 与「同步模型」这个出口）", () => {
    controllerMock.mockReturnValue(controller({ models: [] }));
    render(<ModelLibrary />);
    expect(screen.getByText(/暂无可用的本地模型/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "同步模型" })).toBeTruthy();
  });

  it("搜索落到 setQ、同步落到 sync", () => {
    const setQ = vi.fn();
    const sync = vi.fn(noopAsync);
    controllerMock.mockReturnValue(controller({ setQ, sync }));
    render(<ModelLibrary />);
    fireEvent.change(screen.getByPlaceholderText("搜索模型…"), {
      target: { value: "jugg" },
    });
    expect(setQ).toHaveBeenCalledWith("jugg");
    fireEvent.click(screen.getByRole("button", { name: "同步模型" }));
    expect(sync).toHaveBeenCalledTimes(1);
  });

  /* 同步中：按钮改文案且禁用 —— 连点会起两轮目录扫描，第二轮只是把第一轮
     的结果再覆盖一遍，白等一次 fs 遍历。 */
  it("同步进行中按钮禁用并说明在忙什么", () => {
    controllerMock.mockReturnValue(controller({ syncing: true }));
    render(<ModelLibrary />);
    const busy = screen.getByRole("button", { name: "同步中…" });
    expect(busy.hasAttribute("disabled")).toBe(true);
  });

  /* 列表 → 卡片 → 详情这一整条接线。点卡片此前是跳到一条**不存在**的
     `/models/[id]`（404），现在换成留在原地的详情弹窗。 */
  it("点卡片打开该条模型的详情，字段取自这一条而不是别处", () => {
    controllerMock.mockReturnValue(
      controller({
        models: [
          {
            id: "a",
            name: "Alpha",
            type: "LORA",
            fileName: "alpha_lora.safetensors",
            folder: "loras",
            subfolder: null,
            baseModel: "SDXL",
            source: "LOCAL",
            isAvailable: true,
          },
          {
            id: "b",
            name: "Beta",
            type: "UPSCALE",
            fileName: "4x_ultrafin.safetensors",
            folder: "upscale_models",
            subfolder: null,
            baseModel: null,
            source: "LOCAL",
            isAvailable: true,
          },
        ],
      }),
    );
    render(<ModelLibrary />);
    expect(screen.getByText("Alpha")).toBeTruthy();
    /* 「放大」同时是筛选档位与那一类卡片的徽标 —— 两件事都要在，缺一件就是
       此前那个状态：徽标认得这一类，档位里却没有它。 */
    expect(screen.getByRole("button", { name: "放大" })).toBeTruthy();
    expect(screen.getAllByText("放大").length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByRole("button", { name: /查看 Beta 详情/ }));
    /* 判据收在弹窗内：Alpha 的卡面上本来就写着 SDXL，全局查会假阳性。 */
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("4x_ultrafin.safetensors")).toBeTruthy();
    /* 这一条没有基座 —— 弹窗要说「不知道」，不能沿用上一条的 SDXL。 */
    expect(within(dialog).queryByText("SDXL")).toBeNull();
  });
});
