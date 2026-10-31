import { describe, it, expect } from "vitest";
import type { LLMConfigView } from "~/lib/llm/types";
import {
  channelOptionValue,
  channelProviderLabel,
  channelSelectionDisplayValue,
  parseChannelOption,
  resolveChannelSelection,
} from "./channel-options";

function makeConfig(patch: Partial<LLMConfigView> = {}): LLMConfigView {
  return {
    baseUrl: "https://api.example.com/v1",
    hasApiKey: true,
    maxTokens: 2048,
    model: "qwen3:14b",
    provider: "remote",
    temperature: 0.7,
    ...patch,
  };
}

describe("channel-options 通道编解码", () => {
  it("本地 / 远端通道编解码互逆，模型名含冒号也不丢", () => {
    for (const value of [
      "local::llama3",
      "remote::qwen3:14b",
      "remote::qwen3:14b-instruct-q4_K_M",
    ]) {
      const { channel, model } = parseChannelOption(value);
      expect(channelOptionValue(channel, model)).toBe(value);
    }
  });
});

describe("channel-options 独立选择与全局配置的换算", () => {
  it("手动选择优先，取所选通道与模型", () => {
    const config = makeConfig({ model: "llama3", provider: "local" });
    expect(resolveChannelSelection("remote::qwen3:14b", config)).toEqual({
      model: "qwen3:14b",
      provider: "remote",
    });
    expect(resolveChannelSelection("local::llama3", config)).toEqual({
      model: "llama3",
      provider: "local",
    });
  });

  it("未手动选择时沿用全局配置；配置缺失按本地兜底", () => {
    expect(resolveChannelSelection("", makeConfig())).toEqual({
      model: "qwen3:14b",
      provider: "remote",
    });
    expect(resolveChannelSelection("", null)).toEqual({
      model: "",
      provider: "local",
    });
  });

  it("脏值（非 local/remote）按本地兜底", () => {
    expect(resolveChannelSelection("tool", makeConfig())).toEqual({
      model: "",
      provider: "local",
    });
    expect(resolveChannelSelection("garbage", null)).toEqual({
      model: "",
      provider: "local",
    });
  });

  it("展示值：已选择回显所选值，未选择跟随全局配置", () => {
    const config = makeConfig({ model: "llama3", provider: "local" });
    expect(channelSelectionDisplayValue("remote::qwen3:14b", config)).toBe("remote::qwen3:14b");
    expect(channelSelectionDisplayValue("", config)).toBe("local::llama3");
    expect(channelSelectionDisplayValue("", makeConfig({ model: "" }))).toBe("");
    expect(channelSelectionDisplayValue("", null)).toBe("");
  });
});

describe("channel-options provider 标签", () => {
  it("本地 / 远端中文标签与全局状态芯片口径一致", () => {
    expect(channelProviderLabel("local")).toBe("本地");
    expect(channelProviderLabel("remote")).toBe("远端");
  });
});
