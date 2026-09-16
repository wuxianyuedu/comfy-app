import { afterEach, describe, expect, it, vi } from "vitest";

import {
  callImageGeneration,
  callVideoPoll,
  callVideoSubmit,
  defaultChannelsFromEnv,
  endpointFor,
  maskChannels,
  normalizeSettings,
  pollEndpointFor,
  sanitizeChannel,
  type ApiChannelStored,
  type WorkshopApiSettings,
} from "./api-channel-core";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 一个配齐的通道；用例只改自己关心的字段。 */
const IMAGE: ApiChannelStored = {
  baseUrl: "https://api.example.com/v1",
  path: "/images/generations",
  model: "m1",
  apiKey: "k1",
};

const VIDEO: ApiChannelStored = {
  baseUrl: "https://api.example.com/v1",
  path: "/videos/generations",
  model: "v1",
  apiKey: "k1",
};

/** fetch 打桩：只记录调用，返回值由 impl 给。请求体用 `bodyOf` 读成对象。 */
function stubFetch(impl: (url: string, init?: RequestInit) => unknown) {
  const mock = vi.fn(async (url: string, init?: RequestInit) =>
    impl(url, init),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** 取第 n 次 fetch 调用的请求体并解析成对象（body 是 JSON 字符串）。 */
function bodyOf(
  mock: ReturnType<typeof stubFetch>,
  call = 0,
): Record<string, unknown> {
  const init: RequestInit | undefined = mock.mock.calls[call]?.[1];
  const raw: unknown = init?.body;
  return JSON.parse(typeof raw === "string" ? raw : "{}") as Record<
    string,
    unknown
  >;
}

/** 取第 n 次 fetch 调用的请求头。 */
function headersOf(
  mock: ReturnType<typeof stubFetch>,
  call = 0,
): Record<string, string> {
  const init: RequestInit | undefined = mock.mock.calls[call]?.[1];
  return (init?.headers ?? {}) as Record<string, string>;
}

/** 上游响应桩：按上面的 mock 签名给回 Response 形状。 */
function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * 这一组用例的存在理由（ISSUE #536 P2）：
 * 生图 / 生视频的**协议**（端点拼装、请求体字段、超时、错误文案、结果提取）
 * 曾经在两个入口各存一份（`lib/workshop/api-channel.server.ts` 与
 * `server/workshop/api-channel.ts`，逐行 84% 相同）。协议实现现已收在本模块，
 * 两个入口只注入 IO 差异 —— 因此这里锁住的每一条断言，都是在锁「两份入口
 * 不可能再各自漂移」这件事本身。
 * ──────────────────────────────────────────────────────────────────────── */

describe("defaultChannelsFromEnv / normalizeSettings", () => {
  it("环境变量缺省时是「未配置」而非报错（新装可用）", () => {
    const s = defaultChannelsFromEnv({});
    expect(s.image.baseUrl).toBe("");
    expect(s.image.path).toBe("/images/generations");
    expect(s.video.path).toBe("/videos/generations");
    expect(s.video.apiKey).toBe("");
  });

  it("env 提供默认值，且被存量配置覆盖", () => {
    const defaults = defaultChannelsFromEnv({
      WORKSHOP_API_IMAGE_BASE: "https://from-env",
      WORKSHOP_API_IMAGE_KEY: "env-key",
    });
    expect(defaults.image.baseUrl).toBe("https://from-env");
    // 存量里**只**有 baseUrl（其余字段缺席）——缺席字段取 env / 内置默认
    const merged = normalizeSettings(
      { image: { baseUrl: "https://stored", path: "", model: "", apiKey: "" } },
      defaults,
    );
    expect(merged.image.baseUrl).toBe("https://stored");
    expect(defaults.image.apiKey).toBe("env-key");
    expect(merged.video.path).toBe("/videos/generations");
  });

  it("坏数据（非对象 / 字段类型不对）按默认处理，不抛错", () => {
    const defaults = defaultChannelsFromEnv({});
    const merged = normalizeSettings(
      { image: "not-an-object" as never, video: { baseUrl: 123 } as never },
      defaults,
    );
    expect(merged.image).toEqual(defaults.image);
    expect(merged.video.baseUrl).toBe("");
  });
});

describe("sanitizeChannel", () => {
  it("path 强制根相对（否则 ${baseUrl}${path} 拼不出合法地址）", () => {
    const c = sanitizeChannel({ path: "images/generations" }, IMAGE);
    expect(c.path).toBe("/images/generations");
  });

  it("字符串字段去空白；apiKey 为空串不被默认值顶掉（显式清空合法）", () => {
    const c = sanitizeChannel({ baseUrl: "  https://x  ", apiKey: "" }, IMAGE);
    expect(c.baseUrl).toBe("https://x");
    expect(c.apiKey).toBe("");
  });
});

describe("maskChannels", () => {
  it("apiKey 只以 hasApiKey 布尔出网，明文绝不出现", () => {
    const settings: WorkshopApiSettings = { image: IMAGE, video: VIDEO };
    const view = maskChannels(settings);
    expect(JSON.stringify(view)).not.toContain("k1");
    expect(view.image.hasApiKey).toBe(true);
    expect(view.video.configured).toBe(true);
  });

  it("未配置通道 configured=false（界面据此给「去配置」出口）", () => {
    const view = maskChannels({
      image: { ...IMAGE, baseUrl: "" },
      video: VIDEO,
    });
    expect(view.image.configured).toBe(false);
  });
});

describe("端点拼装", () => {
  it("endpointFor 去尾斜杠后接根相对 path", () => {
    expect(endpointFor({ ...IMAGE, baseUrl: "https://x/v1/" })).toBe(
      "https://x/v1/images/generations",
    );
  });

  it("pollEndpointFor 去重斜杠（baseUrl 尾 / 与 taskId 头 / 只留一个）", () => {
    expect(pollEndpointFor("https://x/v1/", "/task/1")).toBe(
      "https://x/v1/task/1",
    );
  });
});

describe("callImageGeneration", () => {
  it("未配置时不发请求，直接给可操作的错误文案", async () => {
    const fetchMock = stubFetch(async () => jsonResponse({}));
    await expect(
      callImageGeneration({ prompt: "p" }, { ...IMAGE, baseUrl: "" }, () => ({
        endpoint: "/images/generations",
        apiKey: "",
        model: "",
      })),
    ).rejects.toThrow("远端 API 生图通道未配置");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("请求体是 OpenAI 兼容默认映射，空串归一为省略字段", async () => {
    const fetchMock = stubFetch(async () =>
      jsonResponse({ data: [{ url: "https://img/1.png" }] }),
    );
    const url = await callImageGeneration(
      { prompt: "p", negative: "", size: "" },
      IMAGE,
      () => null,
    );
    expect(url).toBe("https://img/1.png");
    const body = bodyOf(fetchMock);
    expect(body.n).toBe(1);
    expect(body.response_format).toBe("url");
    // 空串不得以 "" 送进 payload（远端会当成"明确的空否定词"）
    expect("negative_prompt" in body).toBe(false);
    expect("size" in body).toBe(false);
  });

  it("有 apiKey 才带 Authorization", async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ url: "u" }));
    await callImageGeneration({ prompt: "p" }, IMAGE, () => null);
    expect(headersOf(fetchMock)).toMatchObject({ Authorization: "Bearer k1" });
    fetchMock.mockClear();
    await callImageGeneration(
      { prompt: "p" },
      { ...IMAGE, apiKey: "" },
      () => null,
    );
    expect(headersOf(fetchMock)).not.toHaveProperty("Authorization");
  });

  it("b64 响应包成 data URL（OpenAI images b64_json）", async () => {
    stubFetch(async () => jsonResponse({ data: [{ b64_json: "AAA" }] }));
    await expect(
      callImageGeneration({ prompt: "p" }, IMAGE, () => null),
    ).resolves.toBe("data:image/png;base64,AAA");
  });

  it("非 2xx 抛「API 生图失败 (状态码)」并截断响应体", async () => {
    stubFetch(async () => jsonResponse({ error: "boom" }, false, 502));
    await expect(
      callImageGeneration({ prompt: "p" }, IMAGE, () => null),
    ).rejects.toThrow("API 生图失败 (502)");
  });

  it("响应里既无 URL 也无 b64 时给明确文案（不返回 undefined）", async () => {
    stubFetch(async () => jsonResponse({ data: [{ nope: 1 }] }));
    await expect(
      callImageGeneration({ prompt: "p" }, IMAGE, () => null),
    ).rejects.toThrow("未找到图片 URL / b64 数据");
  });

  it("请求体可被适配器覆盖（bodyOverride 优先于默认映射）", async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ url: "u" }));
    await callImageGeneration({ prompt: "p" }, IMAGE, () => null, {
      bodyOverride: { custom_prompt: "p" },
    });
    expect(bodyOf(fetchMock)).toEqual({ custom_prompt: "p" });
  });

  it("outputField 命中即取那个字段（不再通配提取）", async () => {
    stubFetch(async () =>
      jsonResponse({
        result: { image: "https://picked" },
        url: "https://其他",
      }),
    );
    await expect(
      callImageGeneration({ prompt: "p" }, IMAGE, () => null, {
        outputField: "result.image",
      }),
    ).resolves.toBe("https://picked");
  });

  it("outputField 未命中时回落通配提取（向后兼容）", async () => {
    stubFetch(async () =>
      jsonResponse({ data: [{ url: "https://fallback" }] }),
    );
    await expect(
      callImageGeneration({ prompt: "p" }, IMAGE, () => null, {
        outputField: "result.image",
      }),
    ).resolves.toBe("https://fallback");
  });
});

describe("callVideoSubmit", () => {
  it("未配置时不发请求", async () => {
    const fetchMock = stubFetch(async () => jsonResponse({}));
    await expect(
      callVideoSubmit({ prompt: "p" }, { ...VIDEO, baseUrl: "" }),
    ).rejects.toThrow("API 视频通道未配置");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("同步返回 URL 时直接给 url（不猜任务 id）", async () => {
    stubFetch(async () =>
      jsonResponse({ data: [{ video_url: "https://v/1.mp4" }] }),
    );
    await expect(callVideoSubmit({ prompt: "p" }, VIDEO)).resolves.toEqual({
      url: "https://v/1.mp4",
    });
  });

  it("异步返回任务 id 时给 remoteTaskId（交由调用方轮询）", async () => {
    stubFetch(async () => jsonResponse({ task_id: "t-9" }));
    await expect(callVideoSubmit({ prompt: "p" }, VIDEO)).resolves.toEqual({
      remoteTaskId: "t-9",
    });
  });

  it("首帧图同时写 image_url 与 image（兼容两种上游命名）", async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ url: "u" }));
    await callVideoSubmit(
      { prompt: "p", imageDataUrl: "data:image/png;base64,AAA" },
      VIDEO,
    );
    const body = bodyOf(fetchMock);
    expect(body.image_url).toBe("data:image/png;base64,AAA");
    expect(body.image).toBe("data:image/png;base64,AAA");
  });

  it("既无 URL 也无任务 id 时给明确文案", async () => {
    stubFetch(async () => jsonResponse({ ok: true }));
    await expect(callVideoSubmit({ prompt: "p" }, VIDEO)).rejects.toThrow(
      "未找到视频 URL 或任务 ID",
    );
  });
});

describe("callVideoPoll", () => {
  it("拿到结果 → pending=false + url", async () => {
    stubFetch(async () => jsonResponse({ output_url: "https://v/done.mp4" }));
    await expect(callVideoPoll("t-1", VIDEO)).resolves.toEqual({
      url: "https://v/done.mp4",
      pending: false,
    });
  });

  it("还没结果 → pending=true 且不带 url（上界由调用方轮询控制）", async () => {
    stubFetch(async () => jsonResponse({ status: "running" }));
    await expect(callVideoPoll("t-1", VIDEO)).resolves.toEqual({
      pending: true,
    });
  });

  it("请求打到 baseUrl + 任务 id", async () => {
    const fetchMock = stubFetch(async () =>
      jsonResponse({ status: "running" }),
    );
    await callVideoPoll("/t-1", VIDEO);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.example.com/v1/t-1");
  });

  it("未配置时抛错（不静默 pending）", async () => {
    await expect(
      callVideoPoll("t-1", { ...VIDEO, baseUrl: "" }),
    ).rejects.toThrow("API 视频通道未配置");
  });
});
