// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { saveApiChannels } from "~/lib/workshop/api-channel-client";
import type { ApiChannelsView } from "~/lib/workshop/api-channel-shared";

import { useApiChannelSettings } from "./use-api-channel-settings";

// 逻辑层单测：hook 自己不发请求，请求全在 api-channel-client 里，
// 故只 mock 那一层——换后端错误信封时改 client 一处即可，这里断言的是编排行为。
vi.mock("~/lib/workshop/api-channel-client", () => ({
  saveApiChannels: vi.fn(),
}));

const mockedSave = vi.mocked(saveApiChannels);

const channels: ApiChannelsView = {
  image: {
    configured: true,
    baseUrl: "https://api.openai.com/v1",
    path: "/images/generations",
    model: "gpt-image-1",
    hasApiKey: true,
  },
  video: {
    configured: false,
    baseUrl: "",
    path: "/videos/generations",
    model: "",
    hasApiKey: false,
  },
};

beforeEach(() => {
  mockedSave.mockReset();
});

afterEach(cleanup);

describe("useApiChannelSettings", () => {
  it("草稿按服务端下发值起步，缺失时回落到默认路径", () => {
    const { result } = renderHook(() => useApiChannelSettings({ initial: null }));
    expect(result.current.tab).toBe("image");
    expect(result.current.draft.image.path).toBe("/images/generations");
    expect(result.current.draft.video.path).toBe("/videos/generations");

    const withInitial = renderHook(() => useApiChannelSettings({ initial: channels }));
    expect(withInitial.result.current.draft.image.baseUrl).toBe("https://api.openai.com/v1");
    expect(withInitial.result.current.draft.image.model).toBe("gpt-image-1");
  });

  it("patchChannel 只改目标通道，不波及其他页签草稿", () => {
    const { result } = renderHook(() => useApiChannelSettings({ initial: channels }));
    act(() => result.current.patchChannel("video", { model: "sora" }));
    expect(result.current.draft.video.model).toBe("sora");
    expect(result.current.draft.image.model).toBe("gpt-image-1");
  });

  it("保存成功：回调新视图 + 成功提示，且清空 saving", async () => {
    const updated: ApiChannelsView = {
      ...channels,
      video: { ...channels.video, configured: true, baseUrl: "https://v.example/v1" },
    };
    mockedSave.mockResolvedValue(updated);
    const onSaved = vi.fn();

    const { result } = renderHook(() => useApiChannelSettings({ initial: channels, onSaved }));
    act(() => result.current.patchApiKey("video", "sk-x"));
    await act(async () => {
      await result.current.save();
    });

    expect(onSaved).toHaveBeenCalledWith(updated);
    expect(result.current.msg).toEqual({ kind: "ok", text: "已保存。API 通道已可用。" });
    expect(result.current.saving).toBe(false);
    expect(result.current.saved).toEqual(updated);
  });

  it("保存成功时 payload 带上非空 apiKey，留空的通道不带该字段", async () => {
    mockedSave.mockResolvedValue(channels);
    const { result } = renderHook(() => useApiChannelSettings({ initial: channels }));
    act(() => result.current.patchApiKey("video", "  sk-video  "));
    await act(async () => {
      await result.current.save();
    });

    const payload = mockedSave.mock.calls[0]?.[0];
    expect(payload?.video?.apiKey).toBe("sk-video");
    expect(payload?.image).not.toHaveProperty("apiKey");
  });

  it("保存失败：抛出文案进提示条，saving 复位", async () => {
    mockedSave.mockRejectedValue(new Error("baseUrl 必须以 http 开头"));
    const onSaved = vi.fn();
    const { result } = renderHook(() => useApiChannelSettings({ initial: channels, onSaved }));

    await act(async () => {
      await result.current.save();
    });

    expect(onSaved).not.toHaveBeenCalled();
    expect(result.current.msg).toEqual({ kind: "err", text: "baseUrl 必须以 http 开头" });
    await waitFor(() => expect(result.current.saving).toBe(false));
  });

  it("保存失败且非 Error 抛出时回落到通用文案", async () => {
    mockedSave.mockRejectedValue("boom");
    const { result } = renderHook(() => useApiChannelSettings({ initial: channels }));
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.msg?.text).toBe("保存失败");
  });
});
