// ── api-channel.server 的按名解析回归（ISSUE #3778 问题 5）────────────────
// 题目只有一件事：**连接参数从哪来**。#3501 起 Base URL / 密钥以供应商为单位，
// 模型行自己的两格为空是常态 —— resolveRemoteModelConnection 必须折算供应商链，
// 否则「远程模型明明配了」的模型会被误判成「未配置」回落全局通道（诉求单现场）。
//
// 仓库层整体 mock（这一层不测 SQL，测的是「条目自己的 → 供应商的」取值链与
// 三态分流）；上游 fetch 打桩，断言**实际请求打到哪、带谁的密钥**。
// 打桩用闭包捕获入参（mock.calls 读出来要断言收窄，这里直接在桩里收窄）。

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

const repo = vi.hoisted(() => ({
  findById: vi.fn(),
  getWorkshopAdaptersDoc: vi.fn(),
  list: vi.fn(),
}));

vi.mock("~/lib/core/repository", () => ({
  llmProviderRepository: { findById: repo.findById },
  remoteModelRepository: {
    getWorkshopAdaptersDoc: repo.getWorkshopAdaptersDoc,
    list: repo.list,
  },
}));

import { generateImageViaApi } from "./api-channel.server";

/** 一条远端模型行（测试里只给判据关心的格子）。 */
function modelRow(overrides: Record<string, unknown> = {}) {
  return {
    apiKey: null,
    baseUrl: null,
    enabled: true,
    extraBody: null,
    kind: "image",
    name: "agnes-image-2.5-flash",
    providerId: "prov-1",
    ...overrides,
  };
}

/** 从 RequestInit 的 headers（三形态）里取一个头的值（不靠断言收窄）。 */
function headerValue(init: RequestInit | undefined, key: string): string {
  const h = init?.headers;
  if (h === undefined) {
    return "";
  }
  if (h instanceof Headers) {
    return h.get(key) ?? "";
  }
  if (Array.isArray(h)) {
    const hit = h.find(([k]) => k === key);
    return hit?.[1] ?? "";
  }
  return h[key] ?? "";
}

/** 打桩 fetch：每次调用的端点与 Authorization 记进捕获数组，恒回 200 + URL 载荷。 */
function captureFetch(): {
  calls: Array<{ authorization: string; endpoint: string }>;
  fetchMock: Mock;
} {
  const calls: Array<{ authorization: string; endpoint: string }> = [];
  const fetchMock: Mock = vi.fn(
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({
        authorization: headerValue(init, "Authorization"),
        endpoint:
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
      });
      return Promise.resolve(
        new Response(JSON.stringify({ url: "https://cdn/x.png" }), { status: 200 }),
      );
    },
  );
  return { calls, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("generateImageViaApi：按名解析的连接参数折算（ISSUE #3778）", () => {
  it("模型行 baseUrl 为空 → 折算所属供应商的 Base URL 与密钥（不再误报未配置）", async () => {
    repo.list.mockResolvedValue([modelRow()]);
    repo.findById.mockResolvedValue({
      apiKey: "sk-provider",
      baseUrl: "https://api.example.com",
      id: "prov-1",
    });
    repo.getWorkshopAdaptersDoc.mockResolvedValue({ adapters: [], endpointPath: "" });
    const { calls, fetchMock } = captureFetch();
    vi.stubGlobal("fetch", fetchMock);

    const url = await generateImageViaApi({
      model: "agnes-image-2.5-flash",
      mode: "T2I",
      prompt: "p",
    });
    expect(url).toBe("https://cdn/x.png");
    /* Base 不带版本段 → joinApiUrl 统一补 /v1；密钥用供应商的。 */
    expect(calls[0]).toMatchObject({
      authorization: "Bearer sk-provider",
      endpoint: "https://api.example.com/v1/images/generations",
    });
  });

  it("模型行有自己的 baseUrl / apiKey 时优先用条目自己的（供应商只是兜底）", async () => {
    repo.list.mockResolvedValue([
      modelRow({ apiKey: "sk-model", baseUrl: "https://model.example.com/v1" }),
    ]);
    repo.findById.mockResolvedValue({ apiKey: "sk-provider", baseUrl: "https://api.example.com" });
    repo.getWorkshopAdaptersDoc.mockResolvedValue({ adapters: [], endpointPath: "" });
    const { calls, fetchMock } = captureFetch();
    vi.stubGlobal("fetch", fetchMock);

    await generateImageViaApi({ model: "agnes-image-2.5-flash", mode: "T2I", prompt: "p" });
    expect(calls[0]).toMatchObject({
      authorization: "Bearer sk-model",
      endpoint: "https://model.example.com/v1/images/generations",
    });
    /* 条目地址可用时不再查供应商（少一轮读）。 */
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it("模型在但条目与供应商都没填地址 → 定向报错（点名模型，不套「通道未配置」）", async () => {
    repo.list.mockResolvedValue([modelRow()]);
    repo.findById.mockResolvedValue({ apiKey: "sk-provider", baseUrl: "" });
    repo.getWorkshopAdaptersDoc.mockResolvedValue({ adapters: [], endpointPath: "" });

    await expect(
      generateImageViaApi({ model: "agnes-image-2.5-flash", mode: "T2I", prompt: "p" }),
    ).rejects.toThrow("agnes-image-2.5-flash」没有可用的接口地址");
  });
  /* 「查无此模型 / 停用 → 回落通道设置」那一态不在此测：回落读的是本机
   * `data/workshop-api-settings.json` 与环境变量（模块加载时定值），测试宿主
   * 控制不了那份配置 —— 断言会随机器漂。它不是本轮改动的行为面（原样保留）。 */
});
