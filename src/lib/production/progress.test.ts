// ProductionProgress 单一来源的纯函数契约（Phase 4 / 设计 §7）。
import { describe, expect, it } from "vitest";

import {
  DEFAULT_PRODUCTION_PROGRESS,
  isProductionStage,
  normalizeProductionProgress,
  PRODUCTION_STAGES,
} from "./progress";

describe("isProductionStage", () => {
  it("接受全部合法阶段", () => {
    for (const stage of PRODUCTION_STAGES) {
      expect(isProductionStage(stage)).toBe(true);
    }
  });

  it("拒绝非阶段值 / 非字符串", () => {
    expect(isProductionStage("nope")).toBe(false);
    expect(isProductionStage(1)).toBe(false);
    expect(isProductionStage(undefined)).toBe(false);
  });
});

describe("normalizeProductionProgress", () => {
  it("合法形状原样读出", () => {
    expect(normalizeProductionProgress({ rendered: true, stage: "shots" })).toEqual({
      rendered: true,
      stage: "shots",
    });
  });

  it("非法 stage / 缺字段回落默认", () => {
    expect(normalizeProductionProgress({ stage: "乱写" })).toEqual({
      rendered: false,
      stage: "script",
    });
    expect(normalizeProductionProgress({})).toEqual(DEFAULT_PRODUCTION_PROGRESS);
  });

  it("非对象（含 null / 字符串）→ 默认，不抛", () => {
    expect(normalizeProductionProgress(null)).toEqual(DEFAULT_PRODUCTION_PROGRESS);
    expect(normalizeProductionProgress("x")).toEqual(DEFAULT_PRODUCTION_PROGRESS);
  });

  it("rendered 只在严格 true 时为真", () => {
    expect(normalizeProductionProgress({ rendered: "yes", stage: "video" }).rendered).toBe(false);
    expect(normalizeProductionProgress({ rendered: 1, stage: "video" }).rendered).toBe(false);
  });
});
