// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { readApiErrorMessage, saveApiChannels } from "./api-channel-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(impl: (...args: unknown[]) => unknown) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => body };
}

describe("readApiErrorMessage", () => {
  it("认字符串错误体（业务错误）", () => {
    expect(readApiErrorMessage({ error: "保存失败" })).toBe("保存失败");
  });

  it("认信封错误体（鉴权错误用 {error:{message}}）", () => {
    expect(
      readApiErrorMessage({ error: { message: "未登录或会话已失效" } }),
    ).toBe("未登录或会话已失效");
  });

  it("无 error 字段返回 null，交由调用方回落", () => {
    expect(readApiErrorMessage({ channels: {} })).toBeNull();
    expect(readApiErrorMessage(null)).toBeNull();
  });
});

describe("saveApiChannels", () => {
  it("成功时返回脱敏视图", async () => {
    const channels = {
      image: {
        configured: true,
        baseUrl: "https://a",
        path: "/p",
        model: "m",
        hasApiKey: true,
      },
      video: {
        configured: false,
        baseUrl: "",
        path: "/p",
        model: "",
        hasApiKey: false,
      },
    };
    const fetchMock = stubFetch(async () => jsonResponse({ channels }));
    await expect(
      saveApiChannels({ image: { baseUrl: "https://a" } }),
    ).resolves.toEqual(channels);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workshop-api/config",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("响应不 ok 时抛出服务端文案", async () => {
    stubFetch(async () => jsonResponse({ error: "baseUrl 不合法" }, false));
    await expect(saveApiChannels({})).rejects.toThrow("baseUrl 不合法");
  });

  it("响应格式不符时抛可读错误，不把 undefined 漏给调用方", async () => {
    stubFetch(async () => jsonResponse({ channels: { image: {} } }));
    await expect(saveApiChannels({})).rejects.toThrow(
      "服务端返回的通道配置格式不正确",
    );
  });

  it("fetch 直接 reject（断网 / dev server 未起）时统一中文文案", async () => {
    stubFetch(async () => {
      throw new Error("Failed to fetch");
    });
    await expect(saveApiChannels({})).rejects.toThrow("无法连接服务器");
  });

  it("响应体非法 JSON 时按空对象处理，不二次抛错", async () => {
    stubFetch(async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    }));
    await expect(saveApiChannels({})).rejects.toThrow("保存失败");
  });
});
