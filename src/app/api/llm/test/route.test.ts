/**
 * `POST /api/llm/test` —— 连通性探测的服务端代查（#3501）。
 *
 * 供应商密钥不再下发到浏览器，所以「测试连接」必须由服务端按 `providerId`
 * 取已保存的 Base URL / 格式 / 密钥；这里钉住回落顺序与「探测失败不是硬错误」。
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isRecord } from "~/lib/is-record";

type ProviderRow = {
  apiFormat: string;
  apiKey: string | null;
  baseUrl: string;
  id: string;
  name: string;
};

const { requireRequestUser, getLLMConfig, findById } = vi.hoisted(() => ({
  requireRequestUser: vi.fn<() => Promise<{ id: string } | null>>(),
  getLLMConfig: vi.fn<() => Promise<{ apiKey: string | null; baseUrl: string }>>(),
  findById: vi.fn<(id: string) => Promise<ProviderRow | null>>(),
}));

vi.mock("~/server/auth/request-user", () => ({
  requireRequestUser: () => requireRequestUser(),
}));
vi.mock("~/lib/llm/server", () => ({ getLLMConfig }));
vi.mock("~/lib/core/repository", () => ({
  llmProviderRepository: { findById: (id: string) => findById(id) },
}));

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://127.0.0.1:3000/api/llm/test", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 响应体按未知形状读出来再收窄（`res.json()` 的 `any` 不往断言上带）。 */
async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await res.json();
  if (!isRecord(parsed)) {
    throw new Error("响应体不是对象");
  }
  return parsed;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireRequestUser.mockResolvedValue({ id: "u-1" });
  getLLMConfig.mockResolvedValue({ baseUrl: "https://global.example.com/v1", apiKey: "sk-global" });
  findById.mockResolvedValue(null);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/llm/test", () => {
  it("未登录 → 401，且不发起探测", async () => {
    requireRequestUser.mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(request({}));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("providerId 找不到 → ok:false，且不发起探测", async () => {
    const { POST } = await import("./route");
    const res = await POST(request({ providerId: "gone" }));
    await expect(res.json()).resolves.toEqual({
      ok: false,
      detail: "供应商不存在，请刷新后重试",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("providerId 命中：用供应商保存的 Base URL / 格式 / 密钥探测，浏览器一个密钥都不用给", async () => {
    findById.mockResolvedValue({
      id: "p1",
      name: "Agnes",
      baseUrl: "https://platform.agnes-ai.com",
      apiFormat: "anthropic-messages",
      apiKey: "sk-provider",
    });
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: "claude-sonnet-4" }] }));
    const { POST } = await import("./route");
    const res = await POST(request({ providerId: "p1", model: "claude-sonnet-4" }));
    await expect(res.json()).resolves.toEqual({
      ok: true,
      detail: "连接成功，服务端共 1 个模型",
      models: ["claude-sonnet-4"],
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    // Anthropic 的模型清单在 /v1/models（Base URL 只到域名时补上版本段）
    expect(url).toBe("https://platform.agnes-ai.com/v1/models");
    expect(init?.headers).toMatchObject({
      "x-api-key": "sk-provider",
      "anthropic-version": "2023-06-01",
    });
  });

  it("未给 providerId 时，请求体里的 baseUrl / apiKey / apiFormat 优先于全局配置", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));
    const { POST } = await import("./route");
    const res = await POST(
      request({
        baseUrl: "https://draft.example.com/v1",
        apiKey: "sk-draft",
        apiFormat: "chat-completions",
      }),
    );
    await expect(res.json()).resolves.toMatchObject({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://draft.example.com/v1/models");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer sk-draft" });
  });

  it("providerId 不存在时连草稿参数一起拒绝（不拿一份无主配置去探测）", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      request({ providerId: "gone", baseUrl: "https://draft.example.com/v1" }),
    );
    await expect(res.json()).resolves.toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("没有任何 Base URL → ok:false 的可操作提示", async () => {
    getLLMConfig.mockResolvedValue({ baseUrl: "", apiKey: null });
    const { POST } = await import("./route");
    const res = await POST(request({}));
    await expect(res.json()).resolves.toEqual({
      ok: false,
      detail: "接口地址为空，请先填写或保存 Base URL",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404 时回退到上一层 base 再试（用户把资源子路径填进了 Base URL）", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "not found" }, 404))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "m1" }] }));
    const { POST } = await import("./route");
    const res = await POST(request({ baseUrl: "https://api.example.com/v1/images" }));
    const body = await bodyOf(res);
    expect(body.ok).toBe(true);
    expect(body.detail).toContain("探测已回退到 https://api.example.com/v1/models");
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.example.com/v1/images/models",
      "https://api.example.com/v1/models",
    ]);
  });

  it("非 2xx（鉴权失败）原样透出状态码与片段，并补密钥归因，不重试", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "bad key" }, 401));
    const { POST } = await import("./route");
    const res = await POST(request({ baseUrl: "https://api.example.com/v1" }));
    await expect(res.json()).resolves.toEqual({
      ok: false,
      detail:
        'HTTP 401（https://api.example.com/v1/models）：{"error":"bad key"}（密钥无效，或该密钥没有这个接口的权限）',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("上游返回 HTML 错误页 → 不把整页标记灌进提示，指出这不是接口地址（#3517）", async () => {
    fetchMock.mockResolvedValue(
      new Response("<!DOCTYPE html><html><body>404</body></html>", {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    );
    const { POST } = await import("./route");
    const res = await POST(request({ baseUrl: "https://platform.example.com/v1" }));
    const body = await bodyOf(res);
    expect(body.ok).toBe(false);
    const detail = String(body.detail);
    expect(detail).toContain("HTTP 404（https://platform.example.com/v1/models）");
    expect(detail).toContain("返回的是网页（HTML）而不是接口响应");
    expect(detail).toContain("Base URL");
    expect(detail).not.toContain("<!DOCTYPE");
  });

  it("指定模型不在服务端列表里 → 成功但仍提示核对名称", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: "m1" }] }));
    const { POST } = await import("./route");
    const res = await POST(request({ baseUrl: "https://api.example.com/v1", model: "m2" }));
    await expect(res.json()).resolves.toEqual({
      ok: true,
      detail: "连接成功，但「m2」不在服务端模型列表中，请确认名称是否正确",
      models: ["m1"],
    });
  });

  it("网络层抛错 → 200 + ok:false（探测失败不是硬错误）", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    const { POST } = await import("./route");
    const res = await POST(request({ baseUrl: "https://api.example.com/v1" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: false });
  });
});
