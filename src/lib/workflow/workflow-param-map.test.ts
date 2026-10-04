/**
 * `paramMap` 列权威读边界（ISSUE #1460）。
 *
 * 这一列是多命名空间共用的扩展点，所以判据的重点是**收窄到哪儿为止**：
 * 认得的两个键空间按形状收，不认得的原样留着（剥键 = 静默丢作者数据）；
 * 形状不对的整列判 `null`（不是空表 —— 落库写入路径据此区分「没有」与「空」）。
 */
import { describe, expect, it } from "vitest";

import {
  parseWorkflowParamMap,
  workflowParamMapInputSchema,
} from "./workflow-param-map";

describe("parseWorkflowParamMap 读边界", () => {
  it("按模式归拢的三层结构原样收下", () => {
    const parsed = parseWorkflowParamMap({
      source: { "mode:T2I": { prompt: "1::widget::text", negative: null } },
      output: { "mode:T2I": { images: "5::output::IMAGE" } },
    });
    expect(parsed).toEqual({
      source: { "mode:T2I": { prompt: "1::widget::text", negative: null } },
      output: { "mode:T2I": { images: "5::output::IMAGE" } },
    });
  });

  it("不认识的命名空间原样保留（剥键会静默丢作者数据）", () => {
    const parsed = parseWorkflowParamMap({
      positiveNode: "4",
      source: { "mode:T2I": {} },
    });
    expect(parsed?.positiveNode).toBe("4");
    expect(parsed?.source).toEqual({ "mode:T2I": {} });
  });

  it("null / undefined 一律 null（区分「没有」与「空」）", () => {
    expect(parseWorkflowParamMap(null)).toBeNull();
    expect(parseWorkflowParamMap(undefined)).toBeNull();
  });

  it("形状不对的整列判 null（不是空表）", () => {
    expect(parseWorkflowParamMap("nope")).toBeNull();
    expect(parseWorkflowParamMap([])).toBeNull();
  });

  it("`source` 的值不是表（数组 / 字符串）→ 整列判 null", () => {
    expect(parseWorkflowParamMap({ source: [] })).toBeNull();
    expect(parseWorkflowParamMap({ source: "mode:T2I" })).toBeNull();
  });

  it("空对象是合法值（历史空列）", () => {
    expect(parseWorkflowParamMap({})).toEqual({});
  });
});

describe("workflowParamMapInputSchema（三条路由入参共用）", () => {
  it("undefined / null 透传成 undefined（= 这次不写这一列）", () => {
    expect(workflowParamMapInputSchema.parse(undefined)).toBeUndefined();
    expect(workflowParamMapInputSchema.parse(null)).toBeUndefined();
  });

  it("**不按认得的键空间收窄**：不认识的命名空间原样传下去（剥键 = 静默删数据）", () => {
    const input = {
      positiveNode: "4",
      source: { "mode:T2I": { prompt: "1::widget::text" } },
    };
    expect(workflowParamMapInputSchema.parse(input)).toBe(input);
  });

  it("顶层不是对象 → null（不抛：那是「这次没有内容可写」，不是整次保存失败）", () => {
    expect(workflowParamMapInputSchema.parse(42)).toBeNull();
    expect(workflowParamMapInputSchema.parse([])).toBeNull();
  });
});
