/* workflow-app-mode 映射层的单元测试。夹具按 #5053 spike 的实测形状缩样：
 * widgetId 三段式（带 rootId 前缀）与两段式（旧格式）都覆盖。 */
import { describe, expect, it } from "vitest";

import {
  buildWorkflowIOFromLinearData,
  extractLinearData,
  parseLinearWidgetId,
} from "./workflow-app-mode";

const ROOT_ID = "6e5d96b7-1687-4e3d-8559-6c3e5468c193";

describe("extractLinearData", () => {
  it("缺失 / 畸形返回 null", () => {
    expect(extractLinearData(undefined)).toBeNull();
    expect(extractLinearData({})).toBeNull();
    expect(extractLinearData({ extra: {} })).toBeNull();
    expect(extractLinearData({ extra: { linearData: { inputs: [], outputs: [] } } })).toBeNull();
  });

  it("收窄合法形状并丢弃坏条目", () => {
    const raw = {
      extra: {
        linearData: {
          inputs: [
            [`${ROOT_ID}:14:aspect_ratio`, "aspect_ratio"],
            [`${ROOT_ID}:23:replace`, "replace", { description: "提示词" }],
            ["bad", 42],
            ["only-one-segment"],
          ],
          outputs: ["9", 42, `${ROOT_ID}:9`],
        },
      },
    };
    expect(extractLinearData(raw)).toEqual({
      inputs: [
        [`${ROOT_ID}:14:aspect_ratio`, "aspect_ratio"],
        [`${ROOT_ID}:23:replace`, "replace", { description: "提示词" }],
      ],
      /* outputs 只做字符串过滤、不校验格式 —— 引用是否有效由映射层的节点查找判。 */
      outputs: ["9", `${ROOT_ID}:9`],
    });
  });
});

describe("parseLinearWidgetId", () => {
  it("三段式取末两段", () => {
    expect(parseLinearWidgetId(`${ROOT_ID}:23:replace`)).toEqual({
      nodeId: "23",
      widgetName: "replace",
    });
  });

  it("两段式（旧格式）原样拆出", () => {
    expect(parseLinearWidgetId("6:0")).toEqual({ nodeId: "6", widgetName: "0" });
  });

  it("无法拆出两段返回 null", () => {
    expect(parseLinearWidgetId("only")).toBeNull();
    expect(parseLinearWidgetId("a::")).toBeNull();
    expect(parseLinearWidgetId(":b")).toBeNull();
  });
});

describe("buildWorkflowIOFromLinearData", () => {
  const RAW_NODES = [
    {
      id: 9,
      type: "SaveImage",
      inputs: [{ name: "images", type: "IMAGE", link: 30 }],
      outputs: [{ name: "images" }],
    },
    {
      id: 14,
      type: "ResolutionSelector",
      inputs: [
        { name: "aspect_ratio", widget: { name: "aspect_ratio" }, link: null },
        { name: "megapixels", widget: { name: "megapixels" }, link: null },
        { name: "multiple", widget: { name: "multiple" }, link: null },
      ],
      outputs: [{ name: "width" }, { name: "height" }],
    },
    {
      /* 子图包装节点：promoted 槽位里 replace/seed/switch 带 widget 标记，
       * width/height 是连线端口（有 link 无 widget）。 */
      id: 23,
      type: "b350fbfc-0ff8-4af1-8d09-09f50d84fcaa",
      inputs: [
        { name: "replace", widget: { name: "replace" }, link: null },
        { name: "switch", widget: { name: "switch" }, link: null },
        { name: "seed", widget: { name: "seed" }, link: null },
        { name: "width", link: 41 },
        { name: "height", link: 42 },
      ],
      outputs: [{ name: "IMAGE" }],
    },
    {
      /* 纯控件 widget 不在 inputs[] 里（如 CLIPTextEncode 的 text）—— 兜底判 widget。 */
      id: 5,
      type: "CLIPTextEncode",
      inputs: [{ name: "clip", link: 1 }],
      outputs: [{ name: "CONDITIONING" }],
    },
  ];

  it("widget / param / 纯控件兜底 / 输出 四类判型", () => {
    const result = buildWorkflowIOFromLinearData({
      existingIO: {},
      linearData: {
        inputs: [
          [`${ROOT_ID}:14:aspect_ratio`, "aspect_ratio"],
          [`${ROOT_ID}:23:width`, "width"],
          [`${ROOT_ID}:5:text`, "text"],
        ],
        outputs: ["9"],
      },
      rawNodes: RAW_NODES,
    });
    expect(result.skipped).toEqual([]);
    expect(result.io).toEqual({
      "14::widget::aspect_ratio": {
        direction: "input",
        kind: "widget",
        name: "aspect_ratio",
        nodeId: "14",
      },
      "23::param::width": { direction: "input", kind: "param", name: "width", nodeId: "23" },
      "5::widget::text": { direction: "input", kind: "widget", name: "text", nodeId: "5" },
      "9::output::images": { direction: "output", kind: "output", name: "images", nodeId: "9" },
    });
  });

  it("替换语义：幸存键保留作者元数据，落选键移除", () => {
    const existingIO = {
      "23::widget::replace": {
        direction: "input" as const,
        kind: "widget",
        name: "replace",
        nodeId: "23",
        label: "正面提示词",
        required: true,
        displayOrder: 3,
        modeOverrides: { T2I: { defaultValue: "一只狐狸" } },
      },
      "14::widget::megapixels": {
        direction: "input" as const,
        kind: "widget",
        name: "megapixels",
        nodeId: "14",
        label: "百万像素",
      },
    };
    const result = buildWorkflowIOFromLinearData({
      existingIO,
      linearData: {
        inputs: [[`${ROOT_ID}:23:replace`, "replace"]],
        outputs: [],
      },
      rawNodes: RAW_NODES,
    });
    /* megapixels 不在本次选择里 → 整条移除；replace 幸存 → 元数据保留、身份不变。 */
    expect(result.io).toEqual({
      "23::widget::replace": {
        direction: "input",
        kind: "widget",
        name: "replace",
        nodeId: "23",
        label: "正面提示词",
        required: true,
        displayOrder: 3,
        modeOverrides: { T2I: { defaultValue: "一只狐狸" } },
      },
    });
  });

  it("解析不了的引用计入 skipped，不静默丢弃", () => {
    const result = buildWorkflowIOFromLinearData({
      existingIO: {},
      linearData: {
        inputs: [["7:ghost", "ghost"]],
        outputs: ["999"],
      },
      rawNodes: RAW_NODES,
    });
    expect(result.io).toEqual({});
    expect(result.skipped).toEqual([
      { kind: "input", reason: "节点 7 不在当前图中", ref: "7:ghost" },
      { kind: "output", reason: "节点 999 不在当前图中", ref: "999" },
    ]);
  });
});
