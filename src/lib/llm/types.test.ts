// llm/types 纯函数单测：温度解析链与 extraModels 归一化。
// 这两个函数是「按任务推荐温度」「远端多模型条目」两项行为的核心裁决点。

import { describe, expect, it } from "vitest";

import {
  extraModelName,
  foldRemoteToLocal,
  isLoopbackBaseUrl,
  isMisplacedLocalOllama,
  normalizeExtraModels,
  resolveTaskTemperature,
  TASK_TYPES,
  type TaskType,
} from "./types";

describe("resolveTaskTemperature", () => {
  const overrides = { chat: 0.9 } as Record<TaskType, number>;

  it("该任务配置了覆盖值 → 覆盖值优先（高于调用方显式温度）", () => {
    expect(
      resolveTaskTemperature({
        taskType: "chat",
        explicitTemperature: 0.3,
        overrides,
        fallback: 0.7,
      }),
    ).toBe(0.9);
  });

  it("无覆盖、调用方显式指定温度 → 用显式温度", () => {
    expect(
      resolveTaskTemperature({
        taskType: "code",
        explicitTemperature: 0.3,
        overrides,
        fallback: 0.7,
      }),
    ).toBe(0.3);
  });

  it("无覆盖、无显式温度 → 用该任务类型的推荐默认（不再一律回落全局 0.7）", () => {
    expect(
      resolveTaskTemperature({ taskType: "code", overrides, fallback: 0.7 }),
    ).toBe(TASK_TYPES.code.defaultTemperature);
    expect(
      resolveTaskTemperature({ taskType: "creative", overrides, fallback: 0.7 }),
    ).toBe(TASK_TYPES.creative.defaultTemperature);
    expect(TASK_TYPES.code.defaultTemperature).not.toBe(0.7);
  });

  it("没传任务类型 → 显式温度优先于全局默认；都没有则回落全局", () => {
    expect(resolveTaskTemperature({ explicitTemperature: 0.5, fallback: 0.7 })).toBe(0.5);
    expect(resolveTaskTemperature({ fallback: 0.7 })).toBe(0.7);
  });

  it("覆盖表为 null/缺失该 key 时按无覆盖处理", () => {
    expect(
      resolveTaskTemperature({ taskType: "txt2img", overrides: null, fallback: 0.7 }),
    ).toBe(TASK_TYPES.txt2img.defaultTemperature);
  });
});

describe("normalizeExtraModels", () => {
  it("旧数据（纯名字字符串）归一化为条目，丢弃空白项", () => {
    expect(normalizeExtraModels(["gpt-4o", "  ", "claude-3"])).toEqual([
      { name: "gpt-4o", baseUrl: null, apiKey: null, kind: null },
      { name: "claude-3", baseUrl: null, apiKey: null, kind: null },
    ]);
  });

  it("新数据（条目对象）保留独立 baseUrl / apiKey / kind；空白值归一为 null", () => {
    expect(
      normalizeExtraModels([
        { name: "gpt-4o", baseUrl: "https://api.example.com/v1", apiKey: "sk-1", kind: "chat" },
        { name: "qwen", baseUrl: "   ", apiKey: "" },
        { name: "bad-kind", kind: "audio" },
      ]),
    ).toEqual([
      { name: "gpt-4o", baseUrl: "https://api.example.com/v1", apiKey: "sk-1", kind: "chat" },
      { name: "qwen", baseUrl: null, apiKey: null, kind: null },
      { name: "bad-kind", baseUrl: null, apiKey: null, kind: null },
    ]);
  });

  it("无名 / 非字符串 / 非数组输入一律丢弃或返回空", () => {
    expect(normalizeExtraModels([{ baseUrl: "https://x" }, null, 42])).toEqual([]);
    expect(normalizeExtraModels(undefined)).toEqual([]);
    expect(normalizeExtraModels("gpt-4o")).toEqual([]);
  });
});

describe("extraModelName", () => {
  it("兼容字符串与条目对象两种形状", () => {
    expect(extraModelName("gpt-4o")).toBe("gpt-4o");
    expect(extraModelName({ name: "gpt-4o", apiKey: "sk" })).toBe("gpt-4o");
  });
});

describe("isLoopbackBaseUrl", () => {
  it("识别 localhost / 127.x / [::1] 回环地址", () => {
    expect(isLoopbackBaseUrl("http://localhost:11434/v1")).toBe(true);
    expect(isLoopbackBaseUrl("http://127.0.0.1:11434")).toBe(true);
    expect(isLoopbackBaseUrl("localhost:11434")).toBe(true);
    expect(isLoopbackBaseUrl("https://[::1]:8080/v1")).toBe(true);
  });
  it("非回环地址 / 空串判否", () => {
    expect(isLoopbackBaseUrl("https://api.openai.com/v1")).toBe(false);
    expect(isLoopbackBaseUrl("https://192.168.1.10/v1")).toBe(false);
    expect(isLoopbackBaseUrl("")).toBe(false);
    expect(isLoopbackBaseUrl(null as unknown as string)).toBe(false);
  });
});

describe("isMisplacedLocalOllama", () => {
  it("无 apiKey 且指向本机回环 → 判定为误存的本地 ollama", () => {
    expect(
      isMisplacedLocalOllama(
        { baseUrl: "http://localhost:11434/v1", apiKey: null },
        "http://localhost:11434/v1",
      ),
    ).toBe(true);
  });
  it("无 apiKey、baseUrl 空 → 回落到全局 llmConfig.baseUrl 判定", () => {
    expect(
      isMisplacedLocalOllama(
        { baseUrl: null, apiKey: null },
        "http://localhost:11434/v1",
      ),
    ).toBe(true);
    expect(
      isMisplacedLocalOllama(
        { baseUrl: null, apiKey: null },
        "https://api.openai.com/v1",
      ),
    ).toBe(false);
  });
  it("带独立 apiKey 或指向非回环地址 → 真远端，不判为本地", () => {
    expect(
      isMisplacedLocalOllama(
        { baseUrl: "https://x/v1", apiKey: "sk-1" },
        "http://localhost:11434/v1",
      ),
    ).toBe(false);
    expect(
      isMisplacedLocalOllama(
        { baseUrl: "https://huggingface-infer/v1", apiKey: null },
        "http://localhost:11434/v1",
      ),
    ).toBe(false);
  });
});

describe("foldRemoteToLocal", () => {
  it("误存的本地 ollama 折回本地候选；真远端保留在远端组", () => {
    const folded = foldRemoteToLocal(
      [
        { name: "qwen3:14b", baseUrl: "http://localhost:11434/v1", apiKey: null, kind: "chat" },
        { name: "llama3", baseUrl: null, apiKey: null, kind: null },
        { name: "gpt-4o", baseUrl: "https://api.openai.com/v1", apiKey: "sk-1", kind: "chat" },
      ],
      ["qwen2.5"],
      "http://localhost:11434/v1",
    );
    // 本机回环且无密钥的 ollama → 进本地候选（并去重，不重复已有本地候选）
    expect(folded.localNames).toContain("qwen3:14b");
    expect(folded.localNames).toContain("llama3");
    // 真远端（带密钥、非回环）→ 仍留在远端组
    expect(folded.remoteEntries.map((e) => e.name)).toEqual(["gpt-4o"]);
  });

  it("已有同名本地候选时不重复追加", () => {
    const folded = foldRemoteToLocal(
      [{ name: "qwen3:14b", baseUrl: "http://localhost:11434/v1", apiKey: null, kind: "chat" }],
      ["qwen3:14b"],
      "http://localhost:11434/v1",
    );
    expect(folded.localNames.filter((n) => n === "qwen3:14b").length).toBe(1);
    expect(folded.remoteEntries).toEqual([]);
  });
});
