// 参考图装载预设库弹窗的视图契约（#4376 建，#4404 扩）：
//  1) 目录带候选的 COMBO 控件渲染成下拉（候选逐项出现）—— 不再退回自由文本框；
//  2) MATCHTYPE（COMFY_MATCHTYPE_V3）是连线口，不渲染部件框；
//  3) 动态 COMBO 按选中项渲染子输入，值取预设里的点号全名；
//  4) 换选后旧选项的子输入值被清掉（新选项的子输入以目录缺省呈现）；
//  5) 选中项带连线型子输入时提示「生成时该端点回落裸装载」。
// SelectMenu 的弹层定位口径由 ui/select-menu 自身的用例守，这里只驱动选项选择。
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReferenceChainClassDef } from "~/lib/comfyui/reference-loader-catalog";
import { buildReferenceChainCatalog } from "~/lib/comfyui/reference-loader-catalog";
import type { ReferenceLoaderPreset } from "~/lib/workshop/reference-loader-preset";

const { presetsHook, catalogHook, toastSpy } = vi.hoisted(() => ({
  presetsHook: {
    presets: [] as Array<ReferenceLoaderPreset>,
    loading: false,
    save: vi.fn(),
  },
  catalogHook: {
    data: undefined as { catalog: Record<string, ReferenceChainClassDef> } | undefined,
  },
  toastSpy: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("../hooks/use-reference-loader-presets", () => ({
  useReferenceLoaderPresets: () => presetsHook,
  /* 目录查询：第一参带 classes（编辑面板）、第二参带 search（加节点搜索）——
   * 这里只喂编辑面板的目录，搜索面给空目录即可。 */
  useNodeClassCatalog: (args: { classes?: Array<string>; search?: string }) => ({
    data: args.search === undefined ? catalogHook.data : { catalog: {} },
  }),
}));
vi.mock("../../ToastProvider", () => ({
  useToast: () => toastSpy,
}));

import { ReferenceLoaderPresetModal } from "./ReferenceLoaderPresetModal";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* 与链用例同源的 V3 目录夹具（object_info 实测形状）；归一失败即夹具坏了，直接 fail。 */
const catalogBuilt = buildReferenceChainCatalog({
  ResizeImageMaskNode: {
    input: {
      required: {
        input: [
          "COMFY_MATCHTYPE_V3",
          { template: { template_id: "input_type", allowed_types: "IMAGE,MASK" } },
        ],
        resize_type: [
          "COMFY_DYNAMICCOMBO_V3",
          {
            options: [
              {
                key: "scale dimensions",
                inputs: { required: { width: ["INT", { default: 512 }] } },
              },
              {
                key: "scale to multiple",
                inputs: { required: { multiple: ["INT", { default: 8 }] } },
              },
              { key: "match size", inputs: { required: { match: ["IMAGE,MASK", {}] } } },
            ],
          },
        ],
        scale_method: [
          "COMBO",
          { default: "area", options: ["nearest-exact", "bilinear", "area", "bicubic", "lanczos"] },
        ],
      },
    },
    input_order: { required: ["input", "resize_type", "scale_method"] },
    output: ["COMFY_MATCHTYPE_V3"],
    output_name: ["resized"],
  },
});
if (catalogBuilt === null) {
  throw new Error("夹具应当能归一成目录");
}
const CATALOG = catalogBuilt;

const PRESET: ReferenceLoaderPreset = {
  id: "rp-1",
  name: "缩放对齐（4MP → 32 倍数）",
  steps: [
    {
      class: "ResizeImageMaskNode",
      widgets: { resize_type: "scale to multiple", "resize_type.multiple": 32 },
    },
  ],
};

function renderModal(presets: Array<ReferenceLoaderPreset> = [PRESET]) {
  presetsHook.presets = presets;
  catalogHook.data = { catalog: CATALOG };
  return render(<ReferenceLoaderPresetModal onClose={vi.fn()} open />);
}

async function openSelector(name: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name }));
  await expect.poll(() => screen.getAllByRole("option").length).toBeGreaterThan(0);
}

describe("ReferenceLoaderPresetModal 的 V3 控件（#4404）", () => {
  it("目录带候选的 COMBO 渲染成下拉，候选逐项出现（此前退回自由文本框）", async () => {
    renderModal();
    await screen.findByLabelText("预设名称");
    await openSelector("scale_method");
    const labels = screen.getAllByRole("option").map((option) => option.textContent);
    expect(labels).toContain("area");
    expect(labels).toContain("lanczos");
    expect(labels).toContain("nearest-exact");
  });

  it("MATCHTYPE（连线口）不渲染部件框", async () => {
    renderModal();
    await screen.findByLabelText("预设名称");
    expect(screen.queryByLabelText("input")).toBeNull();
  });

  it("动态 COMBO 按选中项渲染子输入，值取预设的点号全名", async () => {
    renderModal();
    await screen.findByLabelText("预设名称");
    expect(screen.getByLabelText("resize_type")).toBeDefined();
    const multiple = screen.getByLabelText("resize_type.multiple");
    expect(multiple).toBeDefined();
    expect(multiple).toHaveValue(32);
  });

  it("换选后旧子输入清掉，新子输入以目录缺省呈现", async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByLabelText("预设名称");
    expect(screen.getByLabelText("resize_type.multiple")).toHaveValue(32);

    await openSelector("resize_type");
    await user.click(screen.getByRole("option", { name: "scale dimensions" }));

    expect(screen.queryByLabelText("resize_type.multiple")).toBeNull();
    expect(screen.getByLabelText("resize_type.width")).toHaveValue(512);
  });

  it("选中项带连线型子输入时提示「生成时该端点回落裸装载」，且不渲染连线子输入框", async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByLabelText("预设名称");

    await openSelector("resize_type");
    await user.click(screen.getByRole("option", { name: "match size" }));

    expect(screen.getByText(/要连线输入，装载链接不了 —— 生成时该端点回落裸装载/)).toBeDefined();
    expect(screen.queryByLabelText("resize_type.match")).toBeNull();
  });
});
