/* 参考图数组卡的纯派生：哪些 id 是参考图槽、已连线的槽怎么恢复、连上后下一个槽。 */

import { describe, expect, it } from "vitest";

import type { ModeContract } from "~/lib/workshop/model-mode-contract";
import {
  nextReferenceSlotAfterConnect,
  referenceImageSlotIds,
  wiredReferenceSlotIds,
  withReferenceSlotInContracts,
} from "./reference-image-array";

describe("referenceImageSlotIds", () => {
  it("只收 reference-image 及带序号槽，按槽位序号升序", () => {
    expect(
      referenceImageSlotIds([
        "prompt",
        "reference-image-3",
        "reference-image",
        "size",
        "reference-image-2",
      ]),
    ).toEqual(["reference-image", "reference-image-2", "reference-image-3"]);
  });

  it("输入顺序不影响结果（按槽位而非按出现顺序）", () => {
    expect(referenceImageSlotIds(["reference-image-2", "reference-image"])).toEqual([
      "reference-image",
      "reference-image-2",
    ]);
  });
});

describe("wiredReferenceSlotIds", () => {
  it("从 paramMap.source.mode:<模式> 读出连过线的参考图槽", () => {
    expect(
      wiredReferenceSlotIds(
        {
          source: {
            "mode:I2I": {
              prompt: "1::widget::text",
              "reference-image": "5::widget::image_0",
              "reference-image-2": "5::widget::image_1",
            },
          },
        },
        "I2I",
      ),
    ).toEqual(["reference-image", "reference-image-2"]);
  });

  it("没有模式 / 没有 source 命名空间时返回空", () => {
    expect(wiredReferenceSlotIds({ source: { "mode:I2I": { prompt: "x" } } }, null)).toEqual([]);
    expect(wiredReferenceSlotIds({}, "I2I")).toEqual([]);
  });
});

describe("nextReferenceSlotAfterConnect", () => {
  it("连上第一张后长出 reference-image-2", () => {
    expect(
      nextReferenceSlotAfterConnect({
        entryId: "reference-image",
        knownIds: ["prompt", "reference-image"],
      }),
    ).toBe("reference-image-2");
  });

  it("按当前已知的最大槽递推，不撞已存在的槽", () => {
    expect(
      nextReferenceSlotAfterConnect({
        entryId: "reference-image-2",
        knownIds: ["reference-image", "reference-image-2", "reference-image-3"],
      }),
    ).toBe("reference-image-4");
  });

  it("非参考图口不长端点", () => {
    expect(
      nextReferenceSlotAfterConnect({ entryId: "prompt", knownIds: ["reference-image"] }),
    ).toBeNull();
  });

  it("到数组上限不再追加", () => {
    const ids = Array.from({ length: 16 }, (_, i) =>
      i === 0 ? "reference-image" : `reference-image-${i + 1}`,
    );
    expect(
      nextReferenceSlotAfterConnect({ entryId: "reference-image-16", knownIds: ids }),
    ).toBeNull();
  });
});

describe("withReferenceSlotInContracts", () => {
  const contracts: Array<ModeContract> = [
    { mode: "I2I", inputs: ["prompt", "reference-image"] },
    { mode: "T2I", inputs: ["prompt"] },
  ];

  it("往该模式的契约追加新槽，其它模式原样", () => {
    const next = withReferenceSlotInContracts({
      contracts,
      mode: "I2I",
      slot: "reference-image-2",
      fallbackInputs: [],
    });
    expect(next?.[0]?.inputs).toEqual(["prompt", "reference-image", "reference-image-2"]);
    expect(next?.[1]?.inputs).toEqual(["prompt"]);
  });

  it("该模式没有本机覆盖时用生效口清单构造一条完整覆盖", () => {
    const next = withReferenceSlotInContracts({
      contracts: [],
      mode: "I2I",
      slot: "reference-image-2",
      fallbackInputs: ["prompt", "reference-image"],
    });
    expect(next).toEqual([
      { mode: "I2I", inputs: ["prompt", "reference-image", "reference-image-2"] },
    ]);
  });

  it("槽位已存在 / slot 不是合法契约口时返回 null，不重复写", () => {
    expect(
      withReferenceSlotInContracts({
        contracts,
        mode: "I2I",
        slot: "reference-image",
        fallbackInputs: [],
      }),
    ).toBeNull();
    expect(
      withReferenceSlotInContracts({
        contracts,
        mode: "I2I",
        slot: "not-a-contract-id",
        fallbackInputs: [],
      }),
    ).toBeNull();
  });
});
