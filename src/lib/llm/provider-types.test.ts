/**
 * `provider-types.ts` 的共享词表与纯函数（#3501）。
 *
 * 这里判三件事：接口格式 → 请求地址、库里坏值 → 可用词表（坏值不该让整条
 * 模型消失）、模型名 → 智能配置默认值。请求组装与落库各自有用例，不在本文件。
 */
import { describe, expect, it } from "vitest";

import { EMPTY_PLACEHOLDER } from "~/lib/display-value";

import {
  baseUrlVersionHint,
  formatContextWindow,
  inferModelDefaults,
  isLlmApiFormat,
  parseCapabilities,
  parseInputTypes,
  parseReasoningLevels,
  parseReasoningParamMapping,
  requestUrlForFormat,
} from "./provider-types";

describe("isLlmApiFormat / requestUrlForFormat", () => {
  it("只认三种格式，其余值一律 false", () => {
    expect(isLlmApiFormat("chat-completions")).toBe(true);
    expect(isLlmApiFormat("anthropic-messages")).toBe(true);
    expect(isLlmApiFormat("responses")).toBe(true);
    expect(isLlmApiFormat("openai")).toBe(false);
    expect(isLlmApiFormat(null)).toBe(false);
    expect(isLlmApiFormat(42)).toBe(false);
  });

  it("Base URL 去尾斜杠后按格式拼路径；空 Base URL 给空串（不是半截地址）", () => {
    expect(requestUrlForFormat("https://platform.agnes-ai.com/", "chat-completions")).toBe(
      "https://platform.agnes-ai.com/chat/completions",
    );
    expect(requestUrlForFormat(" https://agnes ", "anthropic-messages")).toBe(
      "https://agnes/v1/messages",
    );
    expect(requestUrlForFormat("https://agnes", "responses")).toBe("https://agnes/responses");
    expect(requestUrlForFormat("   ", "responses")).toBe("");
  });
});

describe("baseUrlVersionHint：只提示「看不出版本段」，不改写用户输入", () => {
  it("路径最后一段不是版本段时提示（含完全没有路径的域名）", () => {
    expect(baseUrlVersionHint("https://api.example.com", "chat-completions")).toContain(
      "看不出接口版本段",
    );
    expect(baseUrlVersionHint("https://api.example.com/api", "chat-completions")).toContain(
      "看不出接口版本段",
    );
  });

  it("/v1、/api/v1、/v1beta 都算有版本段（去尾斜杠后判）", () => {
    for (const base of [
      "https://api.example.com/v1",
      "https://api.example.com/api/v1/",
      "https://api.example.com/v1beta",
      "https://api.example.com/v2",
    ]) {
      expect(baseUrlVersionHint(base, "chat-completions"), base).toBeNull();
    }
  });

  it("格式路径自带版本段时不提示（Anthropic 的 Base URL 通常只到域名）", () => {
    expect(baseUrlVersionHint("https://api.anthropic.com", "anthropic-messages")).toBeNull();
  });

  it("空值 / 非 URL 不提示（那归字段校验管，别在输入中途唠叨）", () => {
    expect(baseUrlVersionHint("   ", "chat-completions")).toBeNull();
    expect(baseUrlVersionHint("not a url", "chat-completions")).toBeNull();
  });
});

describe("词表容错解析：坏值跳过、重复去掉、空白裁掉", () => {
  it("输入类型与能力只留词表里认得的字符串", () => {
    expect(parseInputTypes(["text", "image", "bogus", 3, "text"])).toEqual(["text", "image"]);
    expect(parseInputTypes("text")).toEqual([]);
    expect(parseCapabilities(["structured-output", "nope"])).toEqual(["structured-output"]);
    expect(parseCapabilities(undefined)).toEqual([]);
  });

  it("推理等级是用户可扩展词表：只裁空白与去重，不收窄到三档", () => {
    expect(parseReasoningLevels([" low ", "high", "low", "", 1, "minimal"])).toEqual([
      "low",
      "high",
      "minimal",
    ]);
    expect(parseReasoningLevels(null)).toEqual([]);
  });

  it("推理参数映射：param 与 values 都空时给 null（不是一条空壳）", () => {
    expect(parseReasoningParamMapping(null)).toBeNull();
    expect(parseReasoningParamMapping({ param: "", values: {} })).toBeNull();
    expect(
      parseReasoningParamMapping({
        param: " reasoning_effort ",
        values: { " low ": " low ", high: 8192, "": "x" },
      }),
    ).toEqual({ param: "reasoning_effort", values: { low: "low" } });
    expect(parseReasoningParamMapping({ param: "thinking.budget_tokens" })).toEqual({
      param: "thinking.budget_tokens",
      values: {},
    });
  });
});

describe("inferModelDefaults：按模型名给保守默认值", () => {
  it("空名 / 认不出的名字给兜底值（空窗口会让下游算错预算）", () => {
    const fallback = {
      contextWindow: 8192,
      maxOutputTokens: 2048,
      inputTypes: ["text"],
      capabilities: ["system-messages"],
    };
    expect(inferModelDefaults("")).toEqual(fallback);
    expect(inferModelDefaults("   ")).toEqual(fallback);
    expect(inferModelDefaults("agnes-1")).toEqual(fallback);
  });

  it("各家族命中各自的窗口 / 输出上限 / 输入类型", () => {
    expect(inferModelDefaults("claude-sonnet-4-5")).toMatchObject({
      contextWindow: 200_000,
      maxOutputTokens: 8192,
      inputTypes: ["text", "image", "pdf"],
    });
    expect(inferModelDefaults("gemini-2.5-pro")).toMatchObject({
      contextWindow: 1_000_000,
      inputTypes: ["text", "image", "video", "pdf"],
    });
    expect(inferModelDefaults("o3-mini")).toMatchObject({
      contextWindow: 200_000,
      maxOutputTokens: 100_000,
    });
    expect(inferModelDefaults("gpt-5")).toMatchObject({
      contextWindow: 1_000_000,
      maxOutputTokens: 32_768,
    });
    expect(inferModelDefaults("gpt-4o")).toMatchObject({
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
    });
    expect(inferModelDefaults("deepseek-chat")).toMatchObject({ contextWindow: 64_000 });
    expect(inferModelDefaults("qwen-max")).toMatchObject({ contextWindow: 32_768 });
    expect(inferModelDefaults("llama-3-8b")).toMatchObject({
      contextWindow: 8192,
      maxOutputTokens: 4096,
      capabilities: ["system-messages"],
    });
  });

  it("返回的数组是副本：改它不会污染下一次推断", () => {
    const first = inferModelDefaults("");
    first.inputTypes.push("pdf");
    first.capabilities.push("native-web-search");
    expect(inferModelDefaults("").inputTypes).toEqual(["text"]);
    expect(inferModelDefaults("").capabilities).toEqual(["system-messages"]);
  });
});

describe("formatContextWindow：未知给唯一占位符，大数按 K / M 档", () => {
  it("缺值 / 非有限数 / 非正数 → 占位符", () => {
    expect(formatContextWindow(null)).toBe(EMPTY_PLACEHOLDER);
    expect(formatContextWindow(undefined)).toBe(EMPTY_PLACEHOLDER);
    expect(formatContextWindow(Number.NaN)).toBe(EMPTY_PLACEHOLDER);
    expect(formatContextWindow(0)).toBe(EMPTY_PLACEHOLDER);
    expect(formatContextWindow(-5)).toBe(EMPTY_PLACEHOLDER);
  });

  it("千位以上用 K / M，小数去掉尾零", () => {
    expect(formatContextWindow(999)).toBe("999");
    expect(formatContextWindow(2500)).toBe("2.5K");
    expect(formatContextWindow(200_000)).toBe("200K");
    expect(formatContextWindow(1_000_000)).toBe("1M");
    expect(formatContextWindow(1_500_000)).toBe("1.5M");
  });
});
