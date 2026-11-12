/**
 * `src/lib/llm/usage-test.server.ts` 的单元测试（ISSUE #565 覆盖率爬坡）。
 *
 * 这是设置页「测试」弹窗的服务端共享实现：两个路由（提交 / 继续等待）都从
 * 这里取「连接参数解析 + 上游调用 + 结果归一化」。此前零覆盖，而它的失败
 * 模式全是**用户可感知的**：密钥解析错 → 401 却说「网络问题」；错误文案分裂
 * → 同一个故障两条提示。
 *
 * mock 边界只有三处：
 *   · `~/lib/llm/server` 的 `getLLMConfig`（配置分层已在 server.test.ts 覆盖）；
 *   · `~/lib/core/repository` 的两条仓储（#3577 供应商链直查：见 resolveUpstream）；
 *   · 全局 `fetch`（断言上行 URL / 鉴权头 / 超时与回包处置）。
 * `api-channel-shared` 的抽取器与 `usage-test-config` 的纯函数走真实实现。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { REMOTE_MODEL_KINDS } from "~/lib/llm/types";
import { asRecord } from "~/lib/is-record";

vi.mock("~/lib/llm/server", () => ({
  getLLMConfig: vi.fn(() => ({
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

/* 供应商链直查的桩（#3577）：只声明被测代码真正读的字段（本地最小类型，与
 * route.test.ts 的 mock 形状同款），避免为凑齐整行而断言（no-unsafe-type-assertion）。
 * vi.hoisted 声明必须在 vi.mock 引用它之前（no-use-before-define）。 */
const { findByName, findById } = vi.hoisted(() => ({
  findByName:
    vi.fn<(name: string) => Promise<{ name: string; providerId: string | null } | null>>(),
  findById:
    vi.fn<
      (id: string) => Promise<{ apiKey: string | null; baseUrl: string; name: string } | null>
    >(),
}));

vi.mock("~/lib/core/repository", () => ({
  remoteModelRepository: { findByName: (name: string) => findByName(name) },
  llmProviderRepository: { findById: (id: string) => findById(id) },
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
function callAt(n = 0): { init: RequestInit; url: string } {
  const call = fetchMock.mock.calls[n]!;
  // fetch 的首参在运行时一定是字符串 URL 或 Request；这里只做类型收窄，
  // 不做字符串化（`String(obj)` 会得到 `[object Object]`，lint 也据此拦人）。
  const arg: unknown = call[0];
  let url = "";
  if (typeof arg === "string") {
    url = arg;
  } else if (arg instanceof Request) {
    url = arg.url;
  }
  return { url, init: call[1] ?? {} };
}

/** 取第 n 次 fetch 调用的请求体（JSON 解析后的对象）。 */
function sentBody(n = 0): Record<string, unknown> {
  const raw = callAt(n).init.body;
  const parsed: unknown = JSON.parse(typeof raw === "string" ? raw : "{}");
  return asRecord(parsed) ?? {};
}

/** 一次性响应替身（`json()` / `text()` 都可用）。 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** 构造一个 Request 替身（只用到 `.json()`）。 */
function reqOf(body: unknown, opts: { throw?: boolean } = {}): Request {
  const raw = opts.throw === true ? "bad json" : JSON.stringify(body);
  return new Request("https://usage-test.local/", { method: "POST", body: raw });
}

/** `expect.stringContaining` 的返回类型是 `any`；显式收成 `unknown` 再交给对象判据，
 *  避免 unsafe-assignment（运行期仍是同一个非对称匹配器）。 */
function containsText(text: string): unknown {
  const matcher: unknown = expect.stringContaining(text);
  return matcher;
}

beforeEach(() => {
  fetchMock.mockReset();
  findByName.mockReset();
  findByName.mockResolvedValue(null);
  findById.mockReset();
  findById.mockResolvedValue(null);
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

  it("常量对齐；kinds 与权威词表是**同一份**（#2170 并成一份：同一引用，非逐字复制）", () => {
    /* 旧断言 `toEqual(["chat","image","video"])` 是一份逐字复制值的判据 —— 抄的
     * 那份换任何写法都能过、却证明不了「只有一处定义」。toBe（同一引用）+
     * 权威词表自身的期望值，两条合起来才是「并成一份」的机器读数。 */
    expect(USAGE_TEST_KINDS).toBe(REMOTE_MODEL_KINDS);
    expect(REMOTE_MODEL_KINDS).toEqual(["chat", "image", "video"]);
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
    await expect(resolveUpstream("entry", "https://typed/v1/", "sk-typed", "x")).resolves.toEqual({
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
    expect(global).toMatchObject({
      headers: { Authorization: "Bearer sk-global" },
    });
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
    expect(up).not.toHaveProperty("headers.Authorization");
  });

  it("供应商链直查（#3577）：entry 缺席（getLLMConfig 读库失败回落空）也能从供应商行补回地址与密钥", async () => {
    const { getLLMConfig } = await import("~/lib/llm/server");
    vi.mocked(getLLMConfig).mockResolvedValueOnce({
      provider: "remote",
      baseUrl: "https://global/v1",
      model: "m",
      extraModels: [],
      apiKey: null,
      temperature: 0.7,
      maxTokens: 2048,
    });
    findByName.mockResolvedValueOnce({ name: "agnes-3.0-flash", providerId: "p1" });
    findById.mockResolvedValueOnce({
      apiKey: "sk-provider",
      baseUrl: "https://apihub.agnes-ai.com/v1",
      name: "agnes",
    });
    /* typedBase 模拟弹窗带来的供应商地址（它不依赖读库，所以 401 现场地址是对的）；
     * 密钥则由直查补回 —— 这正是「地址对、密钥丢」那一形 repaired 后的样子。 */
    await expect(
      resolveUpstream("agnes-3.0-flash", "https://apihub.agnes-ai.com/v1", "", ""),
    ).resolves.toEqual({
      base: "https://apihub.agnes-ai.com/v1",
      path: "",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-provider",
      },
    });
  });

  it("供应商存在但没配密钥 → 可读报错，不再静默裸发让上游 401 说谜语（#3577）", async () => {
    /* 全局密钥置空：它仍是最后一档回落（历史行为），但「模型挂在供应商下、
     * 供应商没配密钥」的缺口不该被一把不相干的全局钥匙掩盖。 */
    const { getLLMConfig } = await import("~/lib/llm/server");
    vi.mocked(getLLMConfig).mockResolvedValueOnce({
      provider: "remote",
      baseUrl: "https://global/v1",
      model: "m",
      extraModels: [],
      apiKey: null,
      temperature: 0.7,
      maxTokens: 2048,
    });
    findByName.mockResolvedValueOnce({ name: "agnes-3.0-flash", providerId: "p1" });
    /* 供应商行没有密钥 */
    findById.mockResolvedValueOnce({
      apiKey: null,
      baseUrl: "https://apihub.agnes-ai.com/v1",
      name: "agnes",
    });
    const out = await resolveUpstream("agnes-3.0-flash", "https://apihub.agnes-ai.com/v1", "", "");
    /* 单条断言同时钉住两件事：返回的是 error 形（不是 = 静默放行了无密钥请求，
     * 当场红），且文案里点到了供应商名与「未配置 API 密钥」。
     * 刻意不用 if 收窄 + expect —— no-conditional-expect 不许条件内断言；
     * 匹配器先收成 unknown 再进对象 —— 本文件 containsText 的同一手法。 */
    const matcher: unknown = expect.stringMatching(/agnes.*未配置 API 密钥/s);
    expect(out).toEqual({ error: matcher });
  });
});

describe("readUsageTestPrologue（两个路由共用的请求前言）", () => {
  it("缺模型名 → 判别式失败而不是异常", async () => {
    await expect(readUsageTestPrologue(reqOf({}))).resolves.toEqual({
      ok: false,
      detail: "缺少模型名",
    });
    await expect(readUsageTestPrologue(reqOf({ name: "   " }))).resolves.toEqual({
      ok: false,
      detail: "缺少模型名",
    });
  });

  it("body 不是 JSON 对象（解析抛错 / 数组）时同样给「缺少模型名」", async () => {
    await expect(readUsageTestPrologue(reqOf(null, { throw: true }))).resolves.toEqual({
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
    expect(failed).toMatchObject({ detail: containsText("接口地址为空") });
  });

  it("成功时回 name / 原 body / 解析好的连接参数", async () => {
    const out = await readUsageTestPrologue(
      reqOf({ name: "entry", path: "v1/chat/completions", prompt: "hi" }),
    );
    expect(out).toMatchObject({
      ok: true,
      name: "entry",
      up: { base: "https://entry/v1", path: "/v1/chat/completions" },
      rec: { prompt: "hi" },
    });
  });
});

describe("readPayload / parseExtraJson / chatTextFrom", () => {
  it("readPayload：非 JSON 响应体给 null（调用方按状态给文案）", async () => {
    expect(await readPayload(jsonResponse({ a: 1 }))).toEqual({ a: 1 });
    const html = new Response("not json", { status: 502 });
    expect(await readPayload(html)).toBeNull();
  });

  it("parseExtraJson：空串=无额外参数，非对象 / 坏 JSON 给可读文案", () => {
    expect(parseExtraJson("")).toEqual({ ok: true, extra: {} });
    expect(parseExtraJson('{"a":1}')).toEqual({ ok: true, extra: { a: 1 } });
    // 数组是 typeof "object"：isRecord 认它，调用方另有 Array 判断 —— 这里钉住
    // 现状（数组会被当合法「对象」合并），而不是按想象断言它会失败
    expect(parseExtraJson("[1]")).toEqual({ ok: true, extra: [1] });
    expect(parseExtraJson("{")).toMatchObject({
      ok: false,
      detail: containsText("额外参数不是有效的 JSON 对象"),
    });
  });

  it("chatTextFrom：认 OpenAI 的 string 与分片数组两种形态", () => {
    expect(chatTextFrom({ choices: [{ message: { content: "abc" } }] })).toBe("abc");
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
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: "好的" } }] }));
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

  it("非 2xx → HTTP 状态 + 地址 + 响应片段", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "bad" }, 500));
    await expect(callChat(UP, "m", "q", {})).resolves.toEqual({
      ok: false,
      detail: 'HTTP 500（https://u/v1/chat/completions）：{"error":"bad"}',
    });
  });

  it("非 2xx 且响应体是 HTML 页面 → 指出「不是接口响应」，不灌标记（#3517）", async () => {
    fetchMock.mockResolvedValue(
      new Response("<!DOCTYPE html><html><body>404</body></html>", { status: 404 }),
    );
    const out = await callChat(UP, "m", "q", {});
    expect(out).toMatchObject({
      ok: false,
      detail: containsText("返回的是网页（HTML）而不是接口响应"),
    });
  });

  it("2xx 但没有可解析文本 → 明确报「未解析到回复文本」", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [] }));
    const out = await callChat(UP, "m", "q", {});
    expect(out).toMatchObject({
      ok: false,
      detail: containsText("未解析到回复文本"),
    });
  });

  it("2xx 但响应体不是对象 → 同样归为失败", async () => {
    fetchMock.mockResolvedValue(new Response("纯文本", { status: 200 }));
    await expect(callChat(UP, "m", "q", {})).resolves.toMatchObject({
      ok: false,
    });
  });
});

describe("callImage", () => {
  it("成功：从 URL / 内联 data URL 两种回包里取图；size 只在非空时上行", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ url: "https://img/1.png" }] }));
    await expect(callImage(UP, "m", "p", "1024x1024", {})).resolves.toEqual({
      ok: true,
      url: "https://img/1.png",
    });
    expect(sentBody()).toMatchObject({ n: 1, size: "1024x1024" });

    fetchMock.mockResolvedValue(jsonResponse({ data: [{ b64_json: "AAAA" }] }));
    const inline = await callImage(UP, "m", "p", "", {});
    expect(inline).toMatchObject({ url: containsText("data:image") });

    // size 为空串时不塞进请求体（否则上游会按空尺寸参数报错）
    expect(sentBody(1)).not.toHaveProperty("size");
  });

  it("非 2xx → HTTP 文案；2xx 但没图 → 报未解析到 URL", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 429));
    await expect(callImage(UP, "m", "p", "", {})).resolves.toEqual({
      ok: false,
      detail: "HTTP 429（https://u/v1/chat/completions）：{}",
    });

    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));
    const out = await callImage(UP, "m", "p", "", {});
    expect(out).toMatchObject({ detail: containsText("未解析到图片 URL") });
  });
});

describe("callVideo（提交 + 内置一轮轮询）", () => {
  it("上游同步返回视频地址 → done，不轮询", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ url: "https://v/1.mp4" }] }));
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
        .mockResolvedValue(jsonResponse({ data: [{ url: "https://v/done.mp4" }] }));
      const p = callVideo(UP, "m", "p", {});
      await vi.advanceTimersByTimeAsync(6000);
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
      await vi.advanceTimersByTimeAsync(VIDEO_POLL_TOTAL_MS + 6000);
      await expect(p).resolves.toEqual({ status: "pending", taskId: "t2" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("既没有视频也没有任务 ID → error，文案指出上游可能改了字段名", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ weird: true }));
    const out = await callVideo(UP, "m", "p", {});
    expect(out).toMatchObject({
      status: "error",
      detail: containsText("未找到视频 URL 或任务 ID"),
    });
  });

  it("提交非 2xx → error 带 HTTP 文案", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ m: "x" }, 400));
    await expect(callVideo(UP, "m", "p", {})).resolves.toEqual({
      status: "error",
      detail: 'HTTP 400（https://u/v1/chat/completions）：{"m":"x"}',
    });
  });
});

describe("queryVideoTask（继续等待，绝不重新提交）", () => {
  it("查到产物 → done；只发查询请求（不带 method / body）—— 重复扣费防线", async () => {
    // 轮询循环**先等一个 interval 再发第一次请求**（VIDEO_POLL_INTERVAL_MS = 5s，
    // 正好是 vitest 的默认用例超时），所以这里必须推进假计时器而不是真等。
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValue(jsonResponse({ data: [{ url: "https://v/x.mp4" }] }));
      const p = queryVideoTask(UP, "m", "t");
      await vi.advanceTimersByTimeAsync(6000);
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
