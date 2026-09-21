import { afterEach, describe, expect, it, vi } from "vitest";
import { completeChat, probeRemoteApi, streamChat } from "./browser";

/* browser.ts 是浏览器侧唯一的 LLM 出口（服务端隐藏 API Key）。
 * 它的两条真风险：
 *   ① SSE 分帧 —— 网络 chunk 边界与 `\n` 边界无关，半个 JSON 必须留在缓冲里
 *      等下一片，否则 token 静默丢失（表现为「回答缺字」且无任何报错）；
 *   ② 错误必须**抛出来**而不是返回半截内容，否则调用方会当成正常回答渲染。
 */

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

function okStream(chunks: string[]) {
  return new Response(sseStream(chunks), { status: 200 });
}

/** 取出 fetch 的请求体并断言它是 JSON 字符串（`RequestInit.body` 还可能是
 *  FormData / Blob 等，直接 String() 会被 lint 判为可疑的隐式序列化）。 */
function jsonBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (typeof body !== "string")
    throw new Error(`请求体不是字符串: ${typeof body}`);
  return JSON.parse(body) as unknown;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamChat", () => {
  it("逐 token 回调并返回全文", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okStream([
          'data: {"token":"你"}\n',
          'data: {"token":"好"}\n',
          "data: [DONE]\n",
        ]),
      ),
    );
    const tokens: string[] = [];
    const full = await streamChat({
      messages: [{ role: "user", content: "hi" }],
      onToken: (t) => tokens.push(t),
    });
    expect(tokens).toEqual(["你", "好"]);
    expect(full).toBe("你好");
  });

  it("一片里含多行时逐行分发（不是只处理第一行）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okStream([
          'data: {"token":"a"}\ndata: {"token":"b"}\ndata: {"token":"c"}\ndata: [DONE]\n',
        ]),
      ),
    );
    expect(await streamChat({ messages: [] })).toBe("abc");
  });

  it("JSON 被网络切成两片时留在缓冲里拼回（token 不丢）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okStream([
          'data: {"tok',
          'en":"hello"}\n',
          'data: {"token":" world"}\ndata: [DONE]\n',
        ]),
      ),
    );
    const full = await streamChat({ messages: [] });
    expect(full).toBe("hello world");
  });

  it("忽略空行与非 data: 行（注释 / keep-alive 心跳）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okStream([
          ": keep-alive\n",
          "\n",
          'data: {"token":"x"}\n',
          "data: [DONE]\n",
        ]),
      ),
    );
    expect(await streamChat({ messages: [] })).toBe("x");
  });

  it("[DONE] 只作终止标记，不写进正文", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okStream(["data: [DONE]\n"])),
    );
    expect(await streamChat({ messages: [] })).toBe("");
  });

  it("缺 token 字段的帧产出空串且不回调", async () => {
    const onToken = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okStream(['data: {"other":1}\n', 'data: {"token":""}\n']),
      ),
    );
    expect(await streamChat({ messages: [], onToken })).toBe("");
    expect(onToken).not.toHaveBeenCalled();
  });

  it("末帧没有换行符时仍被冲刷出来（末字不丢）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okStream(['data: {"token":"tail"}'])),
    );
    // 读取循环 `break` 之后必须再冲刷一次缓冲：末帧常常没有换行符，此前整条被
    // 丢弃，用户可见表现是「回答最后一个字丢了」。现在流结束后按结尾帧处理。
    expect(await streamChat({ messages: [] })).toBe("tail");
  });

  it("末帧无换行 + 跨 chunk 半个 JSON 也拼得回来", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okStream(['data: {"token":"前半"}\ndata: {"tok', 'en":"末尾"}']),
      ),
    );
    expect(await streamChat({ messages: [] })).toBe("前半末尾");
  });

  it("流正常结束且末帧带换行时不多算/不重复", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okStream(['data: {"token":"a"}\ndata: [DONE]\n'])),
    );
    expect(await streamChat({ messages: [] })).toBe("a");
  });

  it("服务端返回非 2xx 时抛出响应文本，不静默返回空串", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("额度不足", { status: 402 })),
    );
    await expect(streamChat({ messages: [] })).rejects.toThrow("额度不足");
  });

  it("非 2xx 且无响应体时抛出带状态码的信息", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    await expect(streamChat({ messages: [] })).rejects.toThrow("500");
  });

  it("2xx 但无 body 视为失败（不能返回空回答）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    await expect(streamChat({ messages: [] })).rejects.toThrow();
  });

  it("帧内 error 字段必须抛出，而不是把半截正文当成功返回", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okStream([
          'data: {"token":"前半"}\n',
          'data: {"error":"上游鉴权失败"}\n',
        ]),
      ),
    );
    // 此前 `json.error` 抛出的 Error 会被下面的 catch 重新捕获，而 catch 只在
    // 消息命中 /LLM|请求|fetch/i 时才 rethrow —— "上游鉴权失败" 不命中，于是
    // 错误被静默丢弃、`"前半"` 作为**正常回答**返回（用户看到「模型答到一半就
    // 没了」，界面上没有任何报错）。现在语义错误一律中断整条流。
    await expect(streamChat({ messages: [] })).rejects.toThrow("上游鉴权失败");
  });

  it("error 帧即使空串也不当成功（空值不是「没有错误」）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okStream(['data: {"error":""}\n', 'data: {"token":"ok"}\n']),
      ),
    );
    // 空串 error 视为「没有值」，与 `lib/error-message` 对空串的口径一致：
    // 不能因为 `""` 是假值就把整条流当成正常。
    expect(await streamChat({ messages: [] })).toBe("ok");
  });

  it("纯语法坏帧被忽略（不因为一行坏 JSON 中断整条回答）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okStream([
          "data: {bad json\n",
          'data: {"token":"good"}\n',
          "data: [DONE]\n",
        ]),
      ),
    );
    expect(await streamChat({ messages: [] })).toBe("good");
  });

  it("请求体带上 stream:true 与调用方 opts，signal 透传", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      okStream(["data: [DONE]\n"]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    await streamChat({
      messages: [{ role: "user", content: "q" }],
      opts: { temperature: 0.2 },
      signal: controller.signal,
    });
    const init = fetchMock.mock.calls[0]![1]!;
    expect(jsonBody(init)).toMatchObject({ stream: true, temperature: 0.2 });
    expect(init.signal).toBe(controller.signal);
  });
});

describe("completeChat", () => {
  it("返回 content 字段", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ content: "一次性回答" }), {
            status: 200,
          }),
      ),
    );
    expect(await completeChat({ messages: [] })).toBe("一次性回答");
  });

  it("请求体带 stream:false", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ content: "x" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await completeChat({ messages: [] });
    expect(jsonBody(fetchMock.mock.calls[0]![1])).toMatchObject({
      stream: false,
    });
  });

  it("content 缺失时返回空串而不是 undefined", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    expect(await completeChat({ messages: [] })).toBe("");
  });

  it("非 2xx 抛出服务端 error 文案", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "密钥无效" }), { status: 401 }),
      ),
    );
    await expect(completeChat({ messages: [] })).rejects.toThrow("密钥无效");
  });

  it("非 2xx 且无 error 字段时抛出带状态码的信息", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );
    await expect(completeChat({ messages: [] })).rejects.toThrow("503");
  });
});

describe("probeRemoteApi", () => {
  it("成功时返回模型清单，并过滤掉非字符串与空串", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              detail: "连通",
              models: ["a", "", 1, null, "b"],
            }),
            { status: 200 },
          ),
      ),
    );
    const got = await probeRemoteApi({ baseUrl: "https://x" });
    expect(got).toEqual({ ok: true, detail: "连通", models: ["a", "b"] });
  });

  it("models 不是数组时返回 undefined（调用方不渲染清单）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ok: true, detail: "ok", models: "a" }),
            { status: 200 },
          ),
      ),
    );
    expect((await probeRemoteApi({})).models).toBeUndefined();
  });

  it("fetch 抛错时返回 ok:false + 可读 detail（探测失败不是硬错误）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Failed to fetch");
      }),
    );
    const got = await probeRemoteApi({});
    expect(got.ok).toBe(false);
    expect(got.detail).toBe("网络请求失败，请检查应用服务是否正在运行");
  });

  it("detail 缺失时回落到 error 字段", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, error: "鉴权失败" }), {
            status: 401,
          }),
      ),
    );
    expect((await probeRemoteApi({})).detail).toBe("鉴权失败");
  });

  it("响应不是 JSON 时回落到带状态码的文案，不抛错", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>502</html>", { status: 502 })),
    );
    const got = await probeRemoteApi({});
    expect(got.ok).toBe(false);
    expect(got.detail).toContain("502");
  });

  it("服务端只回 {ok:true} 时 ok 为 true 而不是被 truthy 值误判", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: "true", detail: "d" }), {
            status: 200,
          }),
      ),
    );
    // 字符串 "true" 不等于布尔 true —— 探测结论必须是严格布尔。
    expect((await probeRemoteApi({})).ok).toBe(false);
  });
});
