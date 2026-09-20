/**
 * `src/lib/llm/usage-test.server.ts` 的单元测试（ISSUE #565 覆盖率爬坡）。
 *
 * 这是设置页「测试」弹窗的服务端共享实现：两个路由（提交 / 继续等待）都从
 * 这里取「连接参数解析 + 上游调用 + 结果归一化」。此前零覆盖，而它的失败
 * 模式全是**用户可感知的**：密钥解析错 → 401 却说「网络问题」；错误文案分裂
 * → 同一个故障两条提示。
 *
 * mock 边界只有两处：
 *   · `~/lib/llm/server` 的 `getLLMConfig`（配置分层已在 server.test.ts 覆盖）；
 *   · 全局 `fetch`（断言上行 URL / 鉴权头 / 超时与回包处置）。
 * `api-channel-shared` 的抽取器与 `usage-test-config` 的纯函数走真实实现。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/lib/llm/server", () => ({
  getLLMConfig: vi.fn(async () => ({
    provider: "remote",
    baseUrl: "https://global/v1",
    model: "m",
    extraModels: [
      {
        name: "entry",
        baseUrl: "https://entry/v1",
        apiKey: "sk-entry",
        kind: "chat",
      },
    ],
    apiKey: "sk-global",
    temperature: 0.7,
    maxTokens: 2048,
  })),
}));

import {
  CHAT_TIMEOUT_MS,
  MEDIA_TIMEOUT_MS,
  USAGE_TEST_KINDS,
  strField,
  firstNonEmpty,
  normalizeEndpointPath,
  resolveUpstream,
  readUsageTestPrologue,
  readPayload,
  httpFailureDetail,
  parseExtraJson,
  chatTextFrom,
  callChat,
  callImage,
  callVideo,
  queryVideoTask,
  pendingDetail,
  SUBMIT_PENDING_DETAIL,
  saveMediaToLocalTemp,
} from "~/lib/llm/usage-test.server";
import { VIDEO_POLL_TOTAL_MS } from "~/lib/llm/video-task-util";

const fetchMock = vi.fn<typeof fetch>();

/** 取第 n 次 fetch 调用的 (url, init)，并把 init 收成可安全访问的形状。 */
function callAt(n = 0): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls[n]!;
  // fetch 的首参在运行时一定是字符串 URL 或 Request；这里只做类型收窄，
  // 不做字符串化（`String(obj)` 会得到 `[object Object]`，lint 也据此拦人）。
  const arg: unknown = call[0];
  const url = typeof arg === "string" ? arg : (arg as Request).url;
  return { url, init: call[1] ?? {} };
}

/** 取第 n 次 fetch 调用的请求体（JSON 解析后的对象）。 */
function sentBody(n = 0): Record<string, unknown> {
  const raw = callAt(n).init.body;
  return JSON.parse(typeof raw === "string" ? raw : "{}") as Record<
    string,
    unknown
  >;
}

/** 一次性响应替身（`json()` / `text()` 都可用）。 */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** 构造一个 Request 替身（只用到 `.json()`）。 */
function reqOf(body: unknown, opts: { throw?: boolean } = {}): Request {
  return {
    json: async () => {
      if (opts.throw) throw new Error("bad json");
      return body;
    },
  } as unknown as Request;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("字段读取助手", () => {
  it("strField 只认字符串并 trim，其余给空串", () => {
    expect(strField({ a: "  x  " }, "a")).toBe("x");
    expect(strField({ a: 1 }, "a")).toBe("");
    expect(strField({}, "a")).toBe("");
  });

  it("firstNonEmpty 跳过空串 / 全空白 / null，取第一个有值的", () => {
    expect(firstNonEmpty("", "   ", null, undefined, " hit ")).toBe(" hit ");
    expect(firstNonEmpty("", null)).toBe("");
  });

  it("normalizeEndpointPath 保证根相对，空串原样返回", () => {
    expect(normalizeEndpointPath("")).toBe("");
    expect(normalizeEndpointPath("/v1/x")).toBe("/v1/x");
    expect(normalizeEndpointPath("v1/x")).toBe("/v1/x");
  });

  it("常量与 kinds 对齐前端契约", () => {
    expect(USAGE_TEST_KINDS).toEqual(["chat", "image", "video"]);
    expect(CHAT_TIMEOUT_MS).toBe(60_000);
    expect(MEDIA_TIMEOUT_MS).toBe(180_000);
  });
});

describe("resolveUpstream（两个路由同一口径的连接参数解析）", () => {
  it("弹窗填的 → 条目已保存的 → 全局配置，逐级回落", async () => {
    // 全部留空 → 条目值
    await expect(resolveUpstream("entry", "", "", "")).resolves.toEqual({
      base: "https://entry/v1",
      path: "",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-entry",
      },
    });

    // 弹窗覆盖地址与密钥
    await expect(
      resolveUpstream("entry", "https://typed/v1/", "sk-typed", "x"),
    ).resolves.toEqual({
      base: "https://typed/v1",
      path: "/x",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-typed",
      },
    });

    // 名字不在条目里 → 全局
    const global = await resolveUpstream("unknown", "", "", "/chat");
    expect(global).toMatchObject({ base: "https://global/v1", path: "/chat" });
    expect(
      (global as { headers: Record<string, string> }).headers.Authorization,
    ).toBe("Bearer sk-global");
  });

  it("没有任何可用地址 → 返回可修正的错误文案而不是抛错", async () => {
    const { getLLMConfig } = await import("~/lib/llm/server");
    vi.mocked(getLLMConfig).mockResolvedValueOnce({
      provider: "remote",
      baseUrl: "",
      model: "m",
      extraModels: [],
      apiKey: null,
      temperature: 0.7,
      maxTokens: 2048,
    });
    await expect(resolveUpstream("x", "", "", "")).resolves.toEqual({
      error: "接口地址为空：请在弹窗内填写，或先在条目里保存接口地址",
    });
  });

  it("无密钥时不带 Authorization 头（本地 Ollama 不该被塞一个空 Bearer）", async () => {
    const { getLLMConfig } = await import("~/lib/llm/server");
    vi.mocked(getLLMConfig).mockResolvedValueOnce({
      provider: "local",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "m",
      extraModels: [],
      apiKey: null,
      temperature: 0.7,
      maxTokens: 2048,
    });
    const up = await resolveUpstream("x", "", "", "");
    expect(
      (up as { headers: Record<string, string> }).headers.Authorization,
    ).toBeUndefined();
  });
});

describe("readUsageTestPrologue（两个路由共用的请求前言）", () => {
  it("缺模型名 → 判别式失败而不是异常", async () => {
    await expect(readUsageTestPrologue(reqOf({}))).resolves.toEqual({
      ok: false,
      detail: "缺少模型名",
    });
    await expect(
      readUsageTestPrologue(reqOf({ name: "   " })),
    ).resolves.toEqual({
      ok: false,
      detail: "缺少模型名",
    });
  });

  it("body 不是 JSON 对象（解析抛错 / 数组）时同样给「缺少模型名」", async () => {
    await expect(
      readUsageTestPrologue(reqOf(null, { throw: true })),
    ).resolves.toEqual({
      ok: false,
      detail: "缺少模型名",
    });
  });

  it("连接参数解析失败时把错误原样带出（供路由回 200 + ok:false）", async () => {
    const { getLLMConfig } = await import("~/lib/llm/server");
    vi.mocked(getLLMConfig).mockResolvedValueOnce({
      provider: "remote",
      baseUrl: "",
      model: "m",
      extraModels: [],
      apiKey: null,
      temperature: 0.7,
      maxTokens: 2048,
    });
    const failed = await readUsageTestPrologue(reqOf({ name: "x" }));
    expect(failed.ok).toBe(false);
    expect((failed as { detail: string }).detail).toContain("接口地址为空");
  });

  it("成功时回 name / 原 body / 解析好的连接参数", async () => {
    const out = await readUsageTestPrologue(
      reqOf({ name: "entry", path: "v1/chat/completions", prompt: "hi" }),
    );
    expect(out).toMatchObject({
      ok: true,
      name: "entry",
      up: { base: "https://entry/v1", path: "/v1/chat/completions" },
    });
    // `rec` 是透传的原始 body（类型为 Record<string, unknown>）：用判据取值，
    // 不用 `as` 断言 —— 断言会掩盖「字段名写错」这类失败
    const rec = (out as { rec: Record<string, unknown> }).rec;
    expect(rec.prompt).toBe("hi");
  });
});

describe("readPayload / httpFailureDetail / parseExtraJson / chatTextFrom", () => {
  it("readPayload：非 JSON 响应体给 null（调用方按状态给文案）", async () => {
    expect(await readPayload(jsonResponse({ a: 1 }))).toEqual({ a: 1 });
    const html = {
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response;
    expect(await readPayload(html)).toBeNull();
  });

  it("httpFailureDetail：对象体走 JSON、非 JSON 体带原始文本、都截断到 240 字符", () => {
    expect(httpFailureDetail(500, { a: "x" })).toBe('HTTP 500：{"a":"x"}');
    // 非 JSON 体（网关 HTML 错误页）此前拼出的是重复状态码 `HTTP 503：HTTP 503`，
    // 上游写的真实原因一个字都看不到
    expect(httpFailureDetail(503, null, "<html>upstream boom</html>")).toBe(
      "HTTP 503：<html>upstream boom</html>",
    );
    expect(httpFailureDetail(503, null, "   ")).toBe("HTTP 503");
    expect(httpFailureDetail(503, null)).toBe("HTTP 503");
    const long = httpFailureDetail(500, { a: "y".repeat(500) });
    expect(long.length).toBeLessThanOrEqual("HTTP 500：".length + 240);
    expect(
      httpFailureDetail(500, null, "z".repeat(500)).length,
    ).toBeLessThanOrEqual("HTTP 500：".length + 240);
  });

  it("parseExtraJson：空串=无额外参数，非对象 / 坏 JSON 给可读文案", () => {
    expect(parseExtraJson("")).toEqual({ ok: true, extra: {} });
    expect(parseExtraJson('{"a":1}')).toEqual({ ok: true, extra: { a: 1 } });
    // 数组是 typeof "object"：isRecord 认它，调用方另有 Array 判断 —— 这里钉住
    // 现状（数组会被当合法「对象」合并），而不是按想象断言它会失败
    expect(parseExtraJson("[1]")).toEqual({ ok: true, extra: [1] });
    expect(parseExtraJson("{")).toMatchObject({ ok: false });
    expect((parseExtraJson("{") as { detail: string }).detail).toContain(
      "额外参数不是有效的 JSON 对象",
    );
  });

  it("chatTextFrom：认 OpenAI 的 string 与分片数组两种形态", () => {
    expect(chatTextFrom({ choices: [{ message: { content: "abc" } }] })).toBe(
      "abc",
    );
    expect(
      chatTextFrom({
        choices: [{ message: { content: [{ text: "a" }, { text: "b" }] } }],
      }),
    ).toBe("ab");
    // 分片数组里的非对象 / 非字符串 text 被跳过
    expect(
      chatTextFrom({
        choices: [{ message: { content: [1, { text: "x" }, null] } }],
      }),
    ).toBe("x");
    // 畸形负载全部回空串
    for (const p of [null, {}, { choices: [] }, { choices: [{}] }]) {
      expect(chatTextFrom(p)).toBe("");
    }
    expect(chatTextFrom({ choices: [{ message: { content: 42 } }] })).toBe("");
  });
});

/* ───────────────────────────── 上游调用 ───────────────────────────── */

const UP = {
  base: "https://u/v1",
  path: "/chat/completions",
  headers: { "Content-Type": "application/json", Authorization: "Bearer sk" },
};

describe("callChat", () => {
  it("成功：取回复文本，并带上超时与额外参数", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "好的" } }] }),
    );
    await expect(callChat(UP, "m", "问", { top_p: 0.9 })).resolves.toEqual({
      ok: true,
      text: "好的",
    });

    expect(callAt().url).toBe("https://u/v1/chat/completions");
    const body = sentBody();
    expect(body).toMatchObject({ model: "m", top_p: 0.9 });
    expect(body.messages).toEqual([{ role: "user", content: "问" }]);
    expect(callAt().init.signal).toBeInstanceOf(AbortSignal);
  });

  it("非 2xx → HTTP 状态 + 响应片段", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "bad" }, 500));
    await expect(callChat(UP, "m", "q", {})).resolves.toEqual({
      ok: false,
      detail: 'HTTP 500：{"error":"bad"}',
    });
  });

  it("2xx 但没有可解析文本 → 明确报「未解析到回复文本」", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [] }));
    const out = await callChat(UP, "m", "q", {});
    expect(out).toMatchObject({ ok: false });
    expect((out as { detail: string }).detail).toContain("未解析到回复文本");
  });

  it("2xx 但响应体不是对象 → 同样归为失败", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => "纯文本",
    } as unknown as Response);
    await expect(callChat(UP, "m", "q", {})).resolves.toMatchObject({
      ok: false,
    });
  });
});

describe("callImage", () => {
  it("成功：从 URL / 内联 data URL 两种回包里取图；size 只在非空时上行", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: [{ url: "https://img/1.png" }] }),
    );
    await expect(callImage(UP, "m", "p", "1024x1024", {})).resolves.toEqual({
      ok: true,
      url: "https://img/1.png",
    });
    expect(sentBody()).toMatchObject({ n: 1, size: "1024x1024" });

    fetchMock.mockResolvedValue(jsonResponse({ data: [{ b64_json: "AAAA" }] }));
    const inline = await callImage(UP, "m", "p", "", {});
    expect((inline as { url: string }).url).toContain("data:image");

    // size 为空串时不塞进请求体（否则上游会按空尺寸参数报错）
    expect(sentBody(1)).not.toHaveProperty("size");
  });

  it("非 2xx → HTTP 文案；2xx 但没图 → 报未解析到 URL", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 429));
    await expect(callImage(UP, "m", "p", "", {})).resolves.toEqual({
      ok: false,
      detail: "HTTP 429：{}",
    });

    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));
    const out = await callImage(UP, "m", "p", "", {});
    expect((out as { detail: string }).detail).toContain("未解析到图片 URL");
  });
});

describe("callVideo（提交 + 内置一轮轮询）", () => {
  it("上游同步返回视频地址 → done，不轮询", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: [{ url: "https://v/1.mp4" }] }),
    );
    await expect(callVideo(UP, "m", "p", {})).resolves.toEqual({
      status: "done",
      url: "https://v/1.mp4",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("返回任务 ID → 进入轮询；轮询到产物则 done", async () => {
    vi.useFakeTimers();
    try {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ task_id: "t1" }))
        .mockResolvedValue(
          jsonResponse({ data: [{ url: "https://v/done.mp4" }] }),
        );
      const p = callVideo(UP, "m", "p", {});
      await vi.advanceTimersByTimeAsync(6_000);
      await expect(p).resolves.toEqual({
        status: "done",
        url: "https://v/done.mp4",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("窗口内没轮询到 → pending 带任务 ID（供「继续等待」再查）", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValue(jsonResponse({ task_id: "t2" }));
      const p = callVideo(UP, "m", "p", {});
      await vi.advanceTimersByTimeAsync(VIDEO_POLL_TOTAL_MS + 6_000);
      await expect(p).resolves.toEqual({ status: "pending", taskId: "t2" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("既没有视频也没有任务 ID → error，文案指出上游可能改了字段名", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ weird: true }));
    const out = await callVideo(UP, "m", "p", {});
    expect(out).toMatchObject({ status: "error" });
    expect((out as { detail: string }).detail).toContain(
      "未找到视频 URL 或任务 ID",
    );
  });

  it("提交非 2xx → error 带 HTTP 文案", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ m: "x" }, 400));
    await expect(callVideo(UP, "m", "p", {})).resolves.toEqual({
      status: "error",
      detail: 'HTTP 400：{"m":"x"}',
    });
  });
});

describe("queryVideoTask（继续等待，绝不重新提交）", () => {
  it("查到产物 → done；只发查询请求（不带 method / body）—— 重复扣费防线", async () => {
    // 轮询循环**先等一个 interval 再发第一次请求**（VIDEO_POLL_INTERVAL_MS = 5s，
    // 正好是 vitest 的默认用例超时），所以这里必须推进假计时器而不是真等。
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValue(
        jsonResponse({ data: [{ url: "https://v/x.mp4" }] }),
      );
      const p = queryVideoTask(UP, "m", "t");
      await vi.advanceTimersByTimeAsync(6_000);
      await expect(p).resolves.toEqual({ done: true, url: "https://v/x.mp4" });

      // 只发查询请求：不重新提交、不带 body —— 这是「不重复扣费」的机器判据
      expect(fetchMock).toHaveBeenCalledTimes(1);
      for (let i = 0; i < fetchMock.mock.calls.length; i++) {
        expect(callAt(i).init.method).toBeUndefined();
        expect(callAt(i).init.body).toBeUndefined();
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("pending 文案与导出面", () => {
  it("pendingDetail 带上窗口秒数，两条路由口径一致", () => {
    const secs = Math.round(VIDEO_POLL_TOTAL_MS / 1000);
    expect(pendingDetail("仍在生成")).toBe(`仍在生成（已等待 ${secs}s）`);
    expect(SUBMIT_PENDING_DETAIL).toContain(`已等待 ${secs}s`);
    expect(SUBMIT_PENDING_DETAIL).toContain("无需重新提交");
  });

  it("落盘助手经本模块转手导出（路由不必 import 两个模块）", () => {
    expect(saveMediaToLocalTemp).toBeTypeOf("function");
  });
});
