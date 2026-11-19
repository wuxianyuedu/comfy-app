// 参考图装载绑定区的视图契约（#4376）：
//  1) 只为参考图槽位渲染配置行（prompt 等其它契约口不出现），主落点如实显示；
//  2) 每个槽位一个「装载预设」下拉（写回语义由 withReferenceLoaderBinding 的
//     纯函数用例覆盖）；
//  3) 「管理预设」按钮打开预设库弹窗。
// 追加端口配置已移除（#4547，扇出由参考图挂载节点承担）：界面不再出现
// 「追加喂给端口」入口 —— 防回归判据在最后一个用例里。
// SelectMenu 的弹层交互不在这里驱动。
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

  it("管理预设按钮打开弹窗；不打 paramMap", () => {
    const { onPatchParamMap } = renderSection();
    fireEvent.click(screen.getByRole("button", { name: "管理预设" }));
    /* 弹窗已桩：验开关接线（open 传入 true）。 */
    expect(modalStub.open).toBe(true);
    expect(onPatchParamMap).not.toHaveBeenCalled();
  });

  it("追加端口配置已移除（#4547）：不渲染追加入口，存量旧键也不出胶囊", () => {
    const paramMap = {
      ...PARAM_MAP,
      referenceLoaders: {
        "mode:I2I": {
          "reference-image": {
            presetId: "p1",
            extraTargets: ["69::param::image_1"],
          },
        },
      },
    };
    renderSection({ paramMap });
    expect(screen.queryByLabelText("参考图 1 追加端口")).toBeNull();
    expect(screen.queryByLabelText("参考图 2 追加端口")).toBeNull();
    expect(screen.queryByLabelText(/移除追加端口/)).toBeNull();
    expect(screen.queryByText("追加端口")).toBeNull();
  });
});

describe("参考图上限（#4537）", () => {
  it("触发器显示当前配置：未配置 = 跟随模式契约", () => {
    renderSection();
    expect(screen.getByLabelText("参考图上限").textContent).toContain("跟随模式契约");
  });

  it("触发器显示已配置的上限张数", () => {
    renderSection({ paramMap: { ...PARAM_MAP, referenceLoaders: { maxReferences: 1 } } });
    expect(screen.getByLabelText("参考图上限").textContent).toContain("1 张");
  });

  it("序号超过上限的槽位不渲染（工坊喂图只有前 N 张生效）", () => {
    renderSection({ paramMap: { ...PARAM_MAP, referenceLoaders: { maxReferences: 1 } } });
    expect(screen.getByText("参考图 1")).toBeDefined();
    expect(screen.queryByText("参考图 2")).toBeNull();
  });

  it("上限未配置时全部契约槽位都渲染", () => {
    renderSection();
    expect(screen.getByText("参考图 1")).toBeDefined();
    expect(screen.getByText("参考图 2")).toBeDefined();
  });
});
