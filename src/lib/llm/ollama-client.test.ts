// Ollama 探测 / 启动客户端单测（规范 17 §17.2 第②层的网络部分）。
// 原先这两处 fetch 内联在设置页的事件处理器里，无法单测；抽出来后重点覆盖
// 「探测失败不是错误，只是状态行该显示红点」这条降级规则。

import type { Mock } from "vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ollamaTagsUrl, probeOllama, startOllama } from "./ollama-client";

function jsonRes(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ollamaTagsUrl", () => {
  it("剥掉 OpenAI 兼容的 /v1 后缀", () => {
    expect(ollamaTagsUrl("http://localhost:11434/v1")).toBe(
      "http://localhost:11434/api/tags",
    );
    expect(ollamaTagsUrl("http://localhost:11434/v1/")).toBe(
      "http://localhost:11434/api/tags",
    );
  });

  it("没有 /v1 时原样拼接", () => {
    expect(ollamaTagsUrl("http://localhost:11434")).toBe(
      "http://localhost:11434/api/tags",
    );
  });
});

describe("probeOllama", () => {
  it("2xx 且带 models → up + 模型列表", async () => {
    const fetchMock: Mock<typeof fetch> = vi.fn().mockResolvedValue(
      jsonRes(200, {
        models: [{ name: "qwen3:14b", size: 1, modified_at: "" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(probeOllama("http://localhost:11434/v1")).resolves.toEqual({
      up: true,
      models: [{ name: "qwen3:14b", size: 1, modified_at: "" }],
    });
  });

  it("2xx 但 models 缺失 → up + 空列表（UI 显示「0 个模型可用」）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(200, {})));
    await expect(probeOllama("http://x")).resolves.toEqual({
      up: true,
      models: [],
    });
  });

  it("非 2xx → down，不抛错", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(503, {})));
    await expect(probeOllama("http://x")).resolves.toEqual({ up: false });
  });

  it("超时 / 网络不可达 → down，不抛错（探测失败不是错误）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("The operation timed out")),
    );
    await expect(probeOllama("http://x")).resolves.toEqual({ up: false });
  });

  it("响应体不是合法 JSON → down，不把解析异常抛给用户", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("Unexpected token <");
        },
      }),
    );
    await expect(probeOllama("http://x")).resolves.toEqual({ up: false });
  });
});

describe("startOllama", () => {
  it("2xx → 正常返回", async () => {
    const fetchMock: Mock<typeof fetch> = vi
      .fn()
      .mockResolvedValue(jsonRes(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(startOllama()).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/llm/ollama-start");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
  });

  it("非 2xx → 抛带服务端 error 详情的 Error（失败路径必须有可读出口）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonRes(500, {
          error: "未找到 ollama 命令，请先安装 Ollama 或将其加入 PATH 后重试",
        }),
      ),
    );
    await expect(startOllama()).rejects.toThrow(
      "未找到 ollama 命令，请先安装 Ollama 或将其加入 PATH 后重试",
    );
  });

  it("非 2xx 且响应无 error 字段 → 抛兜底文案", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(500, {})));
    await expect(startOllama()).rejects.toThrow(
      "启动 Ollama 失败，请确认已安装 Ollama 并在 PATH 中可用",
    );
  });
});
