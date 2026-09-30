// 模型类型标签与筛选档位：一份出处，两处消费（卡片徽标 + 列表筛选）。
//
// 这个模块存在的理由是防一类具体的漂移：标签表认识某一类、筛选档位却没有它 ——
// 于是那类模型在界面上有名字却筛不出来（此前 `UPSCALE` 就是这个状态）。
// 所以核心判据不是「标签对不对」，而是**两张表不许各自演进**。
import { describe, expect, it } from "vitest";

import {
  ALL_TYPES_FILTER,
  MODEL_TYPE_FILTERS,
  MODEL_TYPE_LABELS,
  modelTypeLabel,
} from "./model-type-labels";

describe("档位表由标签表派生", () => {
  it("标签表里的每一类都有对应档位（少一档就是那类模型看得见却筛不出来）", () => {
    const filterKeys = MODEL_TYPE_FILTERS.map((f) => f.key).filter(Boolean);
    expect(new Set(filterKeys)).toEqual(
      new Set(Object.keys(MODEL_TYPE_LABELS)),
    );
  });

  it("档位标签与类型标签逐字相同，不是第二份文案", () => {
    for (const [type, label] of Object.entries(MODEL_TYPE_LABELS)) {
      expect(
        MODEL_TYPE_FILTERS.find((f) => f.key === type)?.label,
        `${type} 的筛选标签与徽标标签不一致`,
      ).toBe(label);
    }
  });

  it("第一项是「全部」且 key 为空串（空串 = 不下发 type 参数）", () => {
    expect(MODEL_TYPE_FILTERS[0]).toEqual(ALL_TYPES_FILTER);
    expect(ALL_TYPES_FILTER).toEqual({ key: "", label: "全部" });
  });

  it("「放大」在档位里（这一档此前只存在于标签表，列表筛不出来）", () => {
    expect(MODEL_TYPE_FILTERS.map((f) => f.key)).toContain("UPSCALE");
  });
});

describe("modelTypeLabel", () => {
  it("已知类型给中文名", () => {
    expect(modelTypeLabel("CHECKPOINT")).toBe("大模型");
    expect(modelTypeLabel("UPSCALE")).toBe("放大");
  });

  it("未知类型原样回显，不套一个最近的档位", () => {
    expect(modelTypeLabel("WORKLOAD_CUSTOM")).toBe("WORKLOAD_CUSTOM");
  });

  it("空值给空串（由调用处决定要不要占位，而不是这里造一个假名字）", () => {
    expect(modelTypeLabel(null)).toBe("");
    expect(modelTypeLabel(undefined)).toBe("");
    expect(modelTypeLabel("")).toBe("");
  });
});
