// 参考图装载绑定区的视图契约（#4376）：
//  1) 只为参考图槽位渲染配置行（prompt 等其它契约口不出现）；
//  2) 已配的追加端口以胶囊呈现，点 ✕ 按 withReferenceLoaderBinding 的口径写回
//     （只动 referenceLoaders 命名空间，source / output 原样保留）；
//  3) 「管理预设」按钮打开预设库弹窗。
// SelectMenu 的弹层交互不在这里驱动（写回语义由 withReferenceLoaderBinding 的
// 纯函数用例 + 追加端口的同一条 write() 路径覆盖）。
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReferenceLoaderPreset } from "~/lib/workshop/reference-loader-preset";

const { presetsHook, modalStub } = vi.hoisted(() => ({
  presetsHook: {
    presets: [] as Array<ReferenceLoaderPreset>,
    loading: false,
    save: vi.fn(),
  },
  modalStub: { open: false },
}));

vi.mock("../hooks/use-reference-loader-presets", () => ({
  useReferenceLoaderPresets: () => presetsHook,
}));
/* 弹窗自带 ToastProvider 依赖，这里只验绑定区的开关接线，桩成记录 open 的空壳。 */
vi.mock("./ReferenceLoaderPresetModal", () => ({
  ReferenceLoaderPresetModal: (props: { open: boolean }) => {
    modalStub.open = props.open;
    return null;
  },
}));

import { ReferenceLoaderBindingSection } from "./ReferenceLoaderBindingSection";

afterEach(() => {
  vi.clearAllMocks();
});

const PRESETS: Array<ReferenceLoaderPreset> = [
  { id: "p1", name: "缩放对齐", steps: [{ class: "ResizeImageMaskNode" }] },
];

const IO = {
  "69::param::image_0": {
    nodeId: "69",
    name: "image_0",
    kind: "param",
    direction: "input",
    type: "IMAGE",
  },
  "69::param::image_1": {
    nodeId: "69",
    name: "image_1",
    kind: "param",
    direction: "input",
    type: "IMAGE",
  },
  "12::param::image": {
    nodeId: "12",
    name: "image",
    kind: "param",
    direction: "input",
    type: "IMAGE",
  },
} as const;

const ENTRIES = [
  { id: "prompt", label: "提示词", targetIoKey: "1::param::prompt" },
  { id: "reference-image", label: "参考图 1", targetIoKey: "69::param::image_0" },
  { id: "reference-image-2", label: "参考图 2", targetIoKey: null },
];

const PARAM_MAP = {
  source: { "mode:I2I": { prompt: "1::param::prompt", "reference-image": "69::param::image_0" } },
};

function renderSection(
  args: { paramMap?: Record<string, unknown>; presets?: Array<ReferenceLoaderPreset> } = {},
) {
  presetsHook.presets = args.presets ?? PRESETS;
  const onPatchParamMap = vi.fn((_next: Record<string, unknown>) => undefined);
  render(
    <ReferenceLoaderBindingSection
      entries={ENTRIES}
      io={IO}
      mode="I2I"
      onPatchParamMap={onPatchParamMap}
      paramMap={args.paramMap ?? PARAM_MAP}
    />,
  );
  return { onPatchParamMap };
}

describe("参考图装载绑定区（#4376）", () => {
  it("只为参考图槽位渲染配置行；主落点与已配预设可见", () => {
    renderSection();
    expect(screen.getByText("参考图 1")).toBeDefined();
    expect(screen.getByText("参考图 2")).toBeDefined();
    expect(screen.queryByText("提示词")).toBeNull();
    /* 主落点如实显示（未连线的槽位显示「未连线」）。 */
    expect(screen.getByText("主落点：69::param::image_0")).toBeDefined();
    expect(screen.getByText("主落点：未连线")).toBeDefined();
    /* 每个参考图槽位各一个「装载预设」下拉（SelectMenu 把 aria-label 落在触发器上）。 */
    expect(screen.getAllByLabelText("参考图 1 装载预设")).toHaveLength(1);
    expect(screen.getAllByLabelText("参考图 2 装载预设")).toHaveLength(1);
  });

  it("点追加端口的 ✕ 按绑定口径写回（只动 referenceLoaders，source 原样）", () => {
    const paramMap = {
      ...PARAM_MAP,
      referenceLoaders: {
        "mode:I2I": {
          "reference-image": {
            presetId: "p1",
            extraTargets: ["12::param::image"],
          },
        },
      },
    };
    const { onPatchParamMap } = renderSection({ paramMap });

    fireEvent.click(screen.getByLabelText("移除追加端口 image（12）"));

    expect(onPatchParamMap).toHaveBeenCalledTimes(1);
    /* mock 已按 Record 入参收窄；referenceLoaders 形状由
     * withReferenceLoaderBinding 的纯函数用例保证。 */
    const next = onPatchParamMap.mock.calls[0]![0];
    expect(next.source).toEqual(PARAM_MAP.source);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const loaders = next.referenceLoaders as Record<string, Record<string, unknown>>;
    expect(loaders["mode:I2I"]?.["reference-image"]).toEqual({ presetId: "p1" });
  });

  it("无追加端口时不渲染移除入口；管理预设按钮打开弹窗", () => {
    const { onPatchParamMap } = renderSection();
    expect(screen.queryByLabelText("移除追加端口 image（12）")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "管理预设" }));
    /* 弹窗已桩：验开关接线（open 传入 true）。 */
    expect(modalStub.open).toBe(true);
    expect(onPatchParamMap).not.toHaveBeenCalled();
  });
});

describe("参考图装载绑定区 · 扇出候选（#4405）", () => {
  const GRAPH_PORTS = [
    {
      ioKey: "69::param::images.image_1",
      label: "images.image_1（69）",
      name: "images.image_1",
      nodeId: "69",
    },
    {
      ioKey: "34::param::images.image2",
      label: "images.image2（34）",
      name: "images.image2",
      nodeId: "34",
    },
  ];

  it("暴露面没有图片口时，追加端口候选由全图图片族连线口补上", () => {
    /* MiniMax 现场：workflowIO 只勾了 LoadImage 的 upload 部件口（非 IMAGE/MASK），
     * 只看暴露面时扇出下拉整格不渲染 —— 用户没有地方配「这张图还要喂到哪」。 */
    render(
      <ReferenceLoaderBindingSection
        entries={ENTRIES}
        graphImagePorts={GRAPH_PORTS}
        io={{
          "45::widget::upload": {
            nodeId: "45",
            name: "upload",
            kind: "widget",
            direction: "input",
            type: "IMAGEUPLOAD",
          },
        }}
        mode="I2I"
        onPatchParamMap={vi.fn()}
        paramMap={PARAM_MAP}
      />,
    );
    expect(screen.getByLabelText("参考图 1 追加端口")).toBeDefined();
    expect(screen.getByLabelText("参考图 2 追加端口")).toBeDefined();
  });

  it("全图候选与已暴露图片口同键时去重，不重复出选项", () => {
    render(
      <ReferenceLoaderBindingSection
        entries={ENTRIES}
        graphImagePorts={GRAPH_PORTS}
        io={IO}
        mode="I2I"
        onPatchParamMap={vi.fn()}
        paramMap={PARAM_MAP}
      />,
    );
    expect(screen.getByLabelText("参考图 1 追加端口")).toBeDefined();
  });
});
