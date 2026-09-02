import { describe, it, expect } from "vitest";
import {
  controlForEntry,
  splitWorkflowIO,
  inferDimensionGroup,
  inferGroups,
  parseRatioFromLabel,
  type WorkflowIOMap,
  type WorkflowIOEntry,
  type EnrichedWidget,
} from "./workflow-io";

/* 2026-08-29：ComfyUI 离线时保存的 workflowIO 不带 type，width/height 因此被
 * 判成 text，inferDimensionGroup 从不命中，「比例 + 清晰度」选择器整体消失。
 * 本文件锁定 type 缺失时的回退推断行为，防止该回归复发。 */

/** 构造一个 widget pin；省略 type 即模拟 IO 未富化的场景。 */
function pin(name: string, label: string, type?: string): WorkflowIOEntry {
  return {
    direction: "input",
    kind: "widget",
    nodeId: "7",
    name,
    label,
    ...(type ? { type } : {}),
  };
}

/** 走真实的 splitWorkflowIO，保证用例覆盖的是运行时同一条链路。 */
function widgetsOf(...entries: WorkflowIOEntry[]): EnrichedWidget[] {
  const map: WorkflowIOMap = {};
  for (const entry of entries) {
    map[`${entry.nodeId}::widget::${entry.name}`] = entry;
  }
  return splitWorkflowIO(map).widgetInputs;
}

describe("controlForEntry — type 缺失时的回退推断", () => {
  it("width/height 无 type 时推断为 int，不再退化成 text", () => {
    expect(controlForEntry(pin("width", "宽度"))).toBe("int");
    expect(controlForEntry(pin("height", "高度"))).toBe("int");
  });

  it("aspect_ratio 无 type 时推断为 text，由 DimensionControl 接管", () => {
    expect(controlForEntry(pin("aspect_ratio", "宽高比"))).toBe("text");
  });

  it("aspect_ratio 带 options 时推断为 select", () => {
    const entry = { ...pin("aspect_ratio", "宽高比"), options: ["1:1", "16:9"] };
    expect(controlForEntry(entry)).toBe("select");
  });

  it("megapixels 无 type 时推断为 float", () => {
    expect(controlForEntry(pin("megapixels", "百万像素"))).toBe("float");
  });

  it("数字 defaultValue 优先于名称推断", () => {
    expect(controlForEntry({ ...pin("foo", "自定义"), defaultValue: 3 })).toBe("int");
    expect(controlForEntry({ ...pin("foo", "自定义"), defaultValue: 1.5 })).toBe("float");
  });

  it("显式声明的 STRING 不受回退影响（提示词仍是 text）", () => {
    expect(controlForEntry(pin("text", "正向提示词", "STRING"))).toBe("text");
  });

  it("显式声明的 INT / FLOAT 仍走既有分支", () => {
    expect(controlForEntry(pin("steps", "步数", "INT"))).toBe("int");
    expect(controlForEntry(pin("cfg", "引导系数", "FLOAT"))).toBe("float");
  });

  it("无 type 且名称无数字语义时仍回落 text", () => {
    expect(controlForEntry(pin("text", "正向提示词"))).toBe("text");
  });
});

describe("inferDimensionGroup — 两种形态", () => {
  it("W/H 形态：无 type 也能命中（回归：组合选择器消失）", () => {
    const group = inferDimensionGroup(widgetsOf(pin("width", "宽度"), pin("height", "高度")));
    expect(group).not.toBeNull();
    expect(group?.width?.ioKey).toBe("7::widget::width");
    expect(group?.height?.ioKey).toBe("7::widget::height");
    expect(group?.aspect).toBeUndefined();
    expect(group?.megapixels).toBeUndefined();
  });

  it("宽高比 + 百万像素形态（ResolutionSelector 类节点）", () => {
    const group = inferDimensionGroup(
      widgetsOf(pin("aspect_ratio", "宽高比"), pin("megapixels", "百万像素"))
    );
    expect(group).not.toBeNull();
    expect(group?.aspect?.ioKey).toBe("7::widget::aspect_ratio");
    expect(group?.megapixels?.ioKey).toBe("7::widget::megapixels");
    expect(group?.width).toBeUndefined();
    expect(group?.height).toBeUndefined();
  });

  it("W/H 齐备时优先于 宽高比/百万像素 形态", () => {
    const group = inferDimensionGroup(
      widgetsOf(
        pin("width", "宽度"),
        pin("height", "高度"),
        pin("aspect_ratio", "宽高比"),
        pin("megapixels", "百万像素")
      )
    );
    expect(group?.width?.name).toBe("width");
  });

  it("只有 width 缺 height 时不成立", () => {
    expect(inferDimensionGroup(widgetsOf(pin("width", "宽度")))).toBeNull();
  });

  it("只有 宽高比 缺 百万像素 时不成立", () => {
    expect(inferDimensionGroup(widgetsOf(pin("aspect_ratio", "宽高比")))).toBeNull();
  });
});

describe("inferGroups — groupedKeys 覆盖两种形态", () => {
  it("W/H 形态两个 pin 都进入 groupedKeys，不会在表单里重复渲染", () => {
    const { groupedKeys } = inferGroups(widgetsOf(pin("width", "宽度"), pin("height", "高度")));
    expect([...groupedKeys].sort()).toEqual(["7::widget::height", "7::widget::width"]);
  });

  it("宽高比 + 百万像素形态同样进入 groupedKeys", () => {
    const { groupedKeys } = inferGroups(
      widgetsOf(pin("aspect_ratio", "宽高比"), pin("megapixels", "百万像素"))
    );
    expect([...groupedKeys].sort()).toEqual([
      "7::widget::aspect_ratio",
      "7::widget::megapixels",
    ]);
  });

  it("无组合时不产出 groupedKeys", () => {
    const { dimension, video, groupedKeys } = inferGroups(widgetsOf(pin("text", "提示词")));
    expect(dimension).toBeNull();
    expect(video).toBeNull();
    expect(groupedKeys.size).toBe(0);
  });
});

describe("parseRatioFromLabel", () => {
  it("解析带英文后缀的 COMBO 标签", () => {
    expect(parseRatioFromLabel("16:9 (Widescreen)")).toBeCloseTo(16 / 9);
    expect(parseRatioFromLabel("1:1 (Square)")).toBeCloseTo(1);
  });

  it("解析裸比例与乘号写法", () => {
    expect(parseRatioFromLabel("9:16")).toBeCloseTo(9 / 16);
    expect(parseRatioFromLabel("1920x1080")).toBeCloseTo(16 / 9);
  });

  it("无法识别时返回 null", () => {
    expect(parseRatioFromLabel("自动")).toBeNull();
    expect(parseRatioFromLabel("")).toBeNull();
  });
});
