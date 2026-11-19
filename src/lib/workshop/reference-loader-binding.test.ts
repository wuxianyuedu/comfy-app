// 参考图装载绑定的读写契约（#4376）：
//  1) 按模式取绑定表：只认 `mode:<模式>` 键，畸形数据按「没配」处理；
//  2) 写入只动 `referenceLoaders` 命名空间，`source` / `output` 原样保留；
//  3) 删除绑定 / 清空模式表 / 清空命名空间时连键一起摘掉，不留空壳。
//  4) 追加端口已移除（#4547，扇出由挂载节点承担）：存量数据里的 extraTargets
//     旧键读端按「没配」忽略，写入不再产出。
// 参考图上限（#4537）：`maxReferences` 是命名空间级的工作流属性，读写同测。
// 参考图挂载节点（#4534）：`mountNodeIds` 同为命名空间级属性，读写同测。
import { describe, expect, it } from "vitest";

import {
  referenceLoaderBindingsForMode,
  referenceLoaderMax,
  referenceLoaderMountNodes,
  REFERENCE_LOADER_CAP_LIMIT,
  withReferenceLoaderBinding,
  withReferenceLoaderMax,
  withReferenceLoaderMountNodes,
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
        "mode:T2I": { "reference-image": { presetId: "p1" } },
        "mode:I2I": { "reference-image": { presetId: "p2" } },
      },
    };
    expect(referenceLoaderBindingsForMode(paramMap, "T2I")).toEqual({
      "reference-image": { presetId: "p1" },
    });
    expect(referenceLoaderBindingsForMode(paramMap, "I2I")).toEqual({
      "reference-image": { presetId: "p2" },
    });
  });

  it("存量数据里的 extraTargets 旧键按「没配」忽略（#4547 起已移除）", () => {
    const paramMap = {
      ...PARAM_MAP,
      referenceLoaders: {
        "mode:T2I": {
          "reference-image": { presetId: "p1", extraTargets: ["9::param::image"] },
          "reference-image-2": { extraTargets: ["9::param::image"] },
        },
      },
    };
    /* 有预设的槽位只读出预设；只有追加端口的槽位整体按没配处理。 */
    expect(referenceLoaderBindingsForMode(paramMap, "T2I")).toEqual({
      "reference-image": { presetId: "p1" },
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

describe("referenceLoaderMax / withReferenceLoaderMax（参考图上限，#4537）", () => {
  it("读出工作流级上限；未配置 / 畸形值 → null", () => {
    expect(referenceLoaderMax({ referenceLoaders: { maxReferences: 3 } })).toBe(3);
    expect(referenceLoaderMax(PARAM_MAP)).toBeNull();
    expect(referenceLoaderMax(null)).toBeNull();
    expect(referenceLoaderMax({ referenceLoaders: { maxReferences: "3" } })).toBeNull();
    expect(referenceLoaderMax({ referenceLoaders: { maxReferences: 2.5 } })).toBeNull();
    expect(referenceLoaderMax({ referenceLoaders: { maxReferences: 0 } })).toBeNull();
    expect(
      referenceLoaderMax({ referenceLoaders: { maxReferences: REFERENCE_LOADER_CAP_LIMIT + 1 } }),
    ).toBeNull();
  });

  it("上限与槽位绑定同住命名空间，互不干扰", () => {
    const paramMap = {
      ...PARAM_MAP,
      referenceLoaders: {
        maxReferences: 4,
        "mode:T2I": { "reference-image": { presetId: "p1" } },
      },
    };
    expect(referenceLoaderMax(paramMap)).toBe(4);
    expect(referenceLoaderBindingsForMode(paramMap, "T2I")).toEqual({
      "reference-image": { presetId: "p1" },
    });
  });

  it("写上限只动 referenceLoaders 命名空间；越界 / null = 清除", () => {
    const next = withReferenceLoaderMax({ paramMap: PARAM_MAP, max: 3 });
    expect(next.source).toEqual(PARAM_MAP.source);
    expect(next.referenceLoaders).toEqual({ maxReferences: 3 });
    const cleared = withReferenceLoaderMax({ paramMap: next, max: null });
    expect(cleared.referenceLoaders).toBeUndefined();
    const outOfRange = withReferenceLoaderMax({ paramMap: PARAM_MAP, max: 99 });
    expect(outOfRange.referenceLoaders).toBeUndefined();
  });

  it("清除上限后命名空间里还有槽位绑定时保留命名空间", () => {
    const withBinding = withReferenceLoaderBinding({
      paramMap: PARAM_MAP,
      mode: "T2I",
      slotId: "reference-image",
      binding: { presetId: "p1" },
    });
    const withCap = withReferenceLoaderMax({ paramMap: withBinding, max: 2 });
    expect(referenceLoaderMax(withCap)).toBe(2);
    const withoutCap = withReferenceLoaderMax({ paramMap: withCap, max: null });
    expect(referenceLoaderMax(withoutCap)).toBeNull();
    expect(referenceLoaderBindingsForMode(withoutCap, "T2I")).toEqual({
      "reference-image": { presetId: "p1" },
    });
  });

  it("上限边界 = 1 ~ REFERENCE_LOADER_CAP_LIMIT", () => {
    expect(REFERENCE_LOADER_CAP_LIMIT).toBe(16);
    expect(referenceLoaderMax(withReferenceLoaderMax({ paramMap: {}, max: 1 }))).toBe(1);
    expect(
      referenceLoaderMax(withReferenceLoaderMax({ paramMap: {}, max: REFERENCE_LOADER_CAP_LIMIT })),
    ).toBe(16);
  });
});

describe("referenceLoaderMountNodes / withReferenceLoaderMountNodes（挂载节点，#4534）", () => {
  it("读出挂载节点名单；未配置 / 畸形数据 → 空表", () => {
    expect(referenceLoaderMountNodes({ referenceLoaders: { mountNodeIds: ["69", "34"] } })).toEqual(
      ["69", "34"],
    );
    expect(referenceLoaderMountNodes(PARAM_MAP)).toEqual([]);
    expect(referenceLoaderMountNodes(null)).toEqual([]);
    expect(referenceLoaderMountNodes({ referenceLoaders: { mountNodeIds: "垃圾" } })).toEqual([]);
    expect(referenceLoaderMountNodes({ referenceLoaders: { mountNodeIds: [1, ""] } })).toEqual([]);
  });

  it("写名单只动 referenceLoaders 命名空间；重复项去重；原始值不被修改", () => {
    const snapshot = JSON.stringify(PARAM_MAP);
    const next = withReferenceLoaderMountNodes({
      paramMap: PARAM_MAP,
      nodeIds: ["69", "69", "34"],
    });
    expect(next.source).toEqual(PARAM_MAP.source);
    expect(next.referenceLoaders).toEqual({ mountNodeIds: ["69", "34"] });
    expect(JSON.stringify(PARAM_MAP)).toBe(snapshot);
  });

  it("空名单 = 清除；命名空间里还有别的配置时保留命名空间", () => {
    const withBinding = withReferenceLoaderBinding({
      paramMap: PARAM_MAP,
      mode: "T2I",
      slotId: "reference-image",
      binding: { presetId: "p1" },
    });
    const withMount = withReferenceLoaderMountNodes({ paramMap: withBinding, nodeIds: ["69"] });
    expect(referenceLoaderMountNodes(withMount)).toEqual(["69"]);
    const cleared = withReferenceLoaderMountNodes({ paramMap: withMount, nodeIds: [] });
    expect(referenceLoaderMountNodes(cleared)).toEqual([]);
    expect(referenceLoaderBindingsForMode(cleared, "T2I")).toEqual({
      "reference-image": { presetId: "p1" },
    });
  });
});
