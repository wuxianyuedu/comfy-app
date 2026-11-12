// `apiSubmitVideo` / `apiPollVideo` 的中继请求体单测（#3590）：
// model / mode / duration 三个新键的透传与「空值省略」口径。直接 mock 全局
// fetch（postRelay 的传输层），请求组装逻辑保持真实执行。

import { afterEach, describe, expect, it, vi } from "vitest";

import { apiPollVideo, apiSubmitVideo } from "./generation-client";
import { asRecord } from "~/lib/is-record";

afterEach(() => {
  vi.unstubAllGlobals();
});

type FetchMock = ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;

function stubRelay(impl: () => unknown): FetchMock {
  const mock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(new Response(JSON.stringify(impl()), { status: 200 })),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

function relayBodyOf(mock: FetchMock): Record<string, unknown> {
  const init: RequestInit | undefined = mock.mock.calls[0]![1];
  const raw: unknown = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
  return asRecord(raw) ?? {};
}

describe("apiSubmitVideo：远端模型定向字段（#3590）", () => {
  it("model / mode / duration 原样进中继请求体", async () => {
    const mock = stubRelay(() => ({ url: "https://v/out.mp4" }));
    await expect(
      apiSubmitVideo({
        prompt: "p",
        model: "agnes-video-2.5-flash",
        mode: "T2V",
        duration: 5,
      }),
    ).resolves.toEqual({ url: "https://v/out.mp4" });
    const body = relayBodyOf(mock);
    expect(body.kind).toBe("video");
    expect(body.model).toBe("agnes-video-2.5-flash");
    expect(body.mode).toBe("T2V");
    expect(body.duration).toBe(5);
  });

  it("没带的键省略（空串与缺省同义 = 服务端按「没带」回落通道设置）", async () => {
    const mock = stubRelay(() => ({ remoteTaskId: "t-1" }));
    await apiSubmitVideo({ prompt: "p", model: "", mode: "" });
    const body = relayBodyOf(mock);
    expect("model" in body).toBe(false);
    expect("mode" in body).toBe(false);
    expect("duration" in body).toBe(false);
  });
});

describe("apiPollVideo：轮询带模型上下文（#3590）", () => {
  it("opts.model / opts.mode 进中继请求体", async () => {
    const mock = stubRelay(() => ({ url: "https://v/done.mp4" }));
    await expect(
      apiPollVideo("t-9", { model: "agnes-video-2.5-flash", mode: "T2V" }),
    ).resolves.toEqual({
      url: "https://v/done.mp4",
      pending: false,
    });
    const body = relayBodyOf(mock);
    expect(body.remoteTaskId).toBe("t-9");
    expect(body.model).toBe("agnes-video-2.5-flash");
    expect(body.mode).toBe("T2V");
  });

  it("不带 opts 时请求体只有 kind + remoteTaskId（工坊镜头链路不变）", async () => {
    const mock = stubRelay(() => ({}));
    await expect(apiPollVideo("t-9")).resolves.toEqual({ pending: true });
    const body = relayBodyOf(mock);
    expect(Object.keys(body).sort()).toEqual(["kind", "remoteTaskId"]);
  });
});
