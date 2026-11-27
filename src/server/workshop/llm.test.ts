import { describe, expect, it, vi } from "vitest";

const { safeFetchMock } = vi.hoisted(() => ({
  safeFetchMock: vi.fn<(url: string, init: { signal?: AbortSignal }) => Promise<Response>>(),
}));

vi.mock("~/lib/network/outbound-url-core", () => ({ safeFetch: safeFetchMock }));
vi.mock("~/server/workshop/db", () => ({ workshopDb: {} }));
vi.mock("~/lib/core/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { completeWorkshopLLM } from "./llm";

const cfg = {
  apiKey: null,
  baseUrl: "http://127.0.0.1:11434/v1",
  maxTokens: 128,
  model: "qwen3-8b",
  temperature: 0.7,
};

describe("completeWorkshopLLM 取消传播", () => {
  it("外部取消会中止真实上游 fetch", async () => {
    const controller = new AbortController();
    safeFetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => {
              reject(new Error("upstream aborted"));
            },
            { once: true },
          );
        }),
    );

    const pending = completeWorkshopLLM(
      cfg,
      [{ role: "user", content: "ping" }],
      controller.signal,
    );
    const upstreamSignal = safeFetchMock.mock.calls[0]?.[1].signal;
    expect(upstreamSignal?.aborted).toBe(false);
    controller.abort();
    expect(upstreamSignal?.aborted).toBe(true);
    await expect(pending).rejects.toThrow("LLM 请求失败");
  });

  it("配置不可用给出三类可行动文案（ISSUE #5145）", async () => {
    await expect(
      completeWorkshopLLM({ ...cfg, model: "" }, [{ role: "user", content: "ping" }]),
    ).rejects.toThrow("尚未配置生效模型");
    expect(safeFetchMock).not.toHaveBeenCalled();

    safeFetchMock.mockResolvedValue(new Response("unauthorized", { status: 403 }));
    await expect(completeWorkshopLLM(cfg, [{ role: "user", content: "ping" }])).rejects.toThrow(
      /API Key 无效或未授权.*设置 → 远程模型/,
    );

    safeFetchMock.mockRejectedValue(
      new TypeError("fetch failed", { cause: new Error("ECONNREFUSED 127.0.0.1:11434") }),
    );
    await expect(completeWorkshopLLM(cfg, [{ role: "user", content: "ping" }])).rejects.toThrow(
      /本地模型服务未启动.*Ollama/,
    );
  });

  it("成功响应仍按原形状返回回复文本", async () => {
    safeFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "pong" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(completeWorkshopLLM(cfg, [{ role: "user", content: "ping" }])).resolves.toBe(
      "pong",
    );
  });
});
