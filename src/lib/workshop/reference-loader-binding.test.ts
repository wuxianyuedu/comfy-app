// 参考图装载绑定的读写契约（#4376）：
//  1) 按模式取绑定表：只认 `mode:<模式>` 键，畸形数据按「没配」处理；
//  2) 写入只动 `referenceLoaders` 命名空间，`source` / `output` 原样保留；
//  3) 删除绑定 / 清空模式表 / 清空命名空间时连键一起摘掉，不留空壳。
import { describe, expect, it } from "vitest";

import {
  referenceLoaderBindingsForMode,
  withReferenceLoaderBinding,
} from "./reference-loader-binding";

const PARAM_MAP = {
  source: { "mode:T2I": { prompt: "1::param::text" } },
  output: { "mode:T2I": { images: "5::output::IMAGE" } },
};

describe("referenceLoaderBindingsForMode", () => {
  it("按模式读出绑定表", () => {
    const paramMap = {
      ...PARAM_MAP,
      referenceLoaders: {
        "mode:T2I": { "reference-image": { presetId: "p1", extraTargets: ["9::param::image"] } },
        "mode:I2I": { "reference-image": { presetId: "p2" } },
      },
    };
    expect(referenceLoaderBindingsForMode(paramMap, "T2I")).toEqual({
      "reference-image": { presetId: "p1", extraTargets: ["9::param::image"] },
    });
    expect(referenceLoaderBindingsForMode(paramMap, "I2I")).toEqual({
      "reference-image": { presetId: "p2" },
    });
  });

  it("没配 / 缺模式 / 畸形数据 → 空对象", () => {
    expect(referenceLoaderBindingsForMode(PARAM_MAP, "T2I")).toEqual({});
    expect(referenceLoaderBindingsForMode(PARAM_MAP, null)).toEqual({});
    expect(referenceLoaderBindingsForMode(null, "T2I")).toEqual({});
    expect(referenceLoaderBindingsForMode({ referenceLoaders: "垃圾" }, "T2I")).toEqual({});
    expect(
      referenceLoaderBindingsForMode({ referenceLoaders: { "mode:T2I": { x: "垃圾" } } }, "T2I"),
    ).toEqual({});
  });
});

describe("withReferenceLoaderBinding", () => {
  it("写入绑定并保留其余命名空间", () => {
    const next = withReferenceLoaderBinding({
      paramMap: PARAM_MAP,
      mode: "T2I",
      slotId: "reference-image",
      binding: { presetId: "p1" },
    });
    expect(next.source).toEqual(PARAM_MAP.source);
    expect(next.output).toEqual(PARAM_MAP.output);
    expect(next.referenceLoaders).toEqual({
      "mode:T2I": { "reference-image": { presetId: "p1" } },
    });
  });

  it("删除绑定后清空的模式表与命名空间连键一起摘掉", () => {
    const withOne = withReferenceLoaderBinding({
      paramMap: PARAM_MAP,
      mode: "T2I",
      slotId: "reference-image",
      binding: { presetId: "p1" },
    });
    const removed = withReferenceLoaderBinding({
      paramMap: withOne,
      mode: "T2I",
      slotId: "reference-image",
      binding: null,
    });
    expect(removed.referenceLoaders).toBeUndefined();
    expect(removed.source).toEqual(PARAM_MAP.source);
  });

  it("空绑定等价于删除；原始 paramMap 不被修改", () => {
    const original = {
      ...PARAM_MAP,
      referenceLoaders: { "mode:T2I": { "reference-image": { presetId: "p1" } } },
    };
    const snapshot = JSON.stringify(original);
    const next = withReferenceLoaderBinding({
      paramMap: original,
      mode: "T2I",
      slotId: "reference-image",
      binding: { presetId: "" },
    });
    expect(next.referenceLoaders).toBeUndefined();
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});
