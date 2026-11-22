import { describe, expect, it } from "vitest";

import { sizeSourceForMode, withSizeSource } from "./workflow-size-source";

describe("尺寸来源绑定", () => {
  it("没有声明时返回 null（按现有口径由外部尺寸值驱动）", () => {
    expect(sizeSourceForMode(null, "T2I")).toBeNull();
    expect(sizeSourceForMode({}, "T2I")).toBeNull();
    expect(sizeSourceForMode({ sizeSource: {} }, "T2I")).toBeNull();
    expect(sizeSourceForMode(null, null)).toBeNull();
  });

  it("按模式读，别的模式的声明不串味", () => {
    const paramMap = withSizeSource({ paramMap: {}, mode: "I2I", from: "reference-image" });
    expect(sizeSourceForMode(paramMap, "I2I")).toBe("reference-image");
    expect(sizeSourceForMode(paramMap, "T2I")).toBeNull();
  });

  it("写入只动 sizeSource 命名空间，其余键原样保留", () => {
    const original = {
      source: { "mode:T2I": { prompt: "6::widget::text" } },
      referenceLoaders: { maxReferences: 3 },
      customMarker: "keep-me",
    };
    const next = withSizeSource({ paramMap: original, from: "reference-image", mode: "I2I" });
    expect(next).toEqual({
      ...original,
      sizeSource: { "mode:I2I": { from: "reference-image" } },
    });
    expect((original as Record<string, unknown>).sizeSource).toBeUndefined();
  });

  it("删除后不留空壳", () => {
    const set = withSizeSource({ paramMap: {}, mode: "I2I", from: "reference-image" });
    const cleared = withSizeSource({ paramMap: set, mode: "I2I", from: null });
    expect(cleared).toEqual({});
  });

  it("畸形数据按没声明处理", () => {
    expect(sizeSourceForMode({ sizeSource: { "mode:I2I": "bad" } }, "I2I")).toBeNull();
    expect(sizeSourceForMode({ sizeSource: { "mode:I2I": { from: "other" } } }, "I2I")).toBeNull();
  });
});
