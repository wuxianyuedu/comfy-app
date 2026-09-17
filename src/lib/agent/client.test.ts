/**
 * `agent/client.ts` 的浏览器端 API 客户端单测（ISSUE #565 覆盖率爬坡 / 规范 §17.2 第②层）。
 *
 * 此前**零覆盖**。它是视图层与 Agent 服务端之间唯一的网络出口，判决面全在
 * 「响应形状不合法时怎么办」上 —— 这类分支用户只在出错时看到，表现是
 * 「界面没反应」或「报了个看不懂的错」，而没有任何日志指得出是哪一层。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendAgentMessage } from "./client";
import type { AgentChatRequest } from "./shared";

const REQ: AgentChatRequest = {
  messages: [{ role: "user", content: "hi" }],
  draft: {} as AgentChatRequest["draft"],
};

function mockFetch(impl: () => Promise<Response> | Response) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendAgentMessage", () => {
  it("正常响应：reply / tool_calls / done / fallback_instruction 全部带出", async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            reply: "好的",
            tool_calls: [
              { id: "c1", name: "generate_script", arguments: '{"idea":"x"}' },
            ],
            done: true,
            fallback_instruction: { action: "get_project_state" },
          }),
          { status: 200 },
        ),
    );
    const res = await sendAgentMessage(REQ);
    expect(res.reply).toBe("好的");
    expect(res.tool_calls).toEqual([
      { id: "c1", name: "generate_script", arguments: '{"idea":"x"}' },
    ]);
    expect(res.done).toBe(true);
    expect(res.fallback_instruction).toEqual({ action: "get_project_state" });
  });

  it("坏 tool_call 被过滤，不把半个调用交给执行层", async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            tool_calls: [
              { id: "ok", name: "f", arguments: "{}" },
              // 缺 name
              { id: "bad1", arguments: "{}" },
              // 空 id（执行层按 id 回传结果，空 id 会串台）
              { id: "", name: "f", arguments: "{}" },
              // 不是对象
              "nonsense",
              // arguments 缺失 → 用 "{}" 兜底，而不是 undefined
              { id: "ok2", name: "g" },
            ],
          }),
          { status: 200 },
        ),
    );
    const res = await sendAgentMessage(REQ);
    expect(res.tool_calls).toEqual([
      { id: "ok", name: "f", arguments: "{}" },
      { id: "ok2", name: "g", arguments: "{}" },
    ]);
  });

  it("done 只在真为 true 时带出（false / 缺省都不带）", async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ reply: "x", done: false }), {
          status: 200,
        }),
    );
    expect((await sendAgentMessage(REQ)).done).toBeUndefined();
  });

  it("响应是原始值（字符串 / null / 数字）→ 给可见占位且 done=true", async () => {
    for (const body of ['"hello"', "null", "42"]) {
      mockFetch(() => new Response(body, { status: 200 }));
      const res = await sendAgentMessage(REQ);
      expect(res.done).toBe(true);
      expect(res.reply).toBe("（无有效响应）");
    }
  });

  it("【现状登记】响应是数组时也走空响应，而不是占位", async () => {
    // `isRecord([])` 为真（数组也是 object），所以数组体被当成「合法对象」，
    // 结果是空响应而非占位。这是个次要缺口（服务端从不返回数组），本批**只登记
    // 不改**：补测试与改行为分开提交（规范 §13.5.1 的同类口径）。
    mockFetch(() => new Response("[]", { status: 200 }));
    const res = await sendAgentMessage(REQ);
    expect(res).toEqual({});
  });

  it("响应是空对象 / 不可解析体 → 返回空响应（各字段缺省），交由调用方兜底", async () => {
    // `parseAgentResponse` 只在「不是对象」时给占位；`{}` 是合法对象，于是
    // 结果是一个**各字段都缺省**的响应。这里把现状钉住：消费方
    // （`use-workshop-agent.ts`）在「无 reply、无 tool_calls、无 fallback」时
    // 走自己的首轮兜底分支，因此`done` 缺省不影响它。
    mockFetch(() => new Response("{}", { status: 200 }));
    const res = await sendAgentMessage(REQ);
    expect(res).toEqual({});
  });

  it("非 2xx：带出服务端错误信封里的 message", async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            error: { code: "auth.required", message: "未登录" },
          }),
          { status: 401 },
        ),
    );
    await expect(sendAgentMessage(REQ)).rejects.toThrow("未登录");
  });

  it("非 2xx 但信封缺 message / 不是对象 → 统一回退文案（不抛 undefined）", async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ error: { code: "x" } }), { status: 500 }),
    );
    await expect(sendAgentMessage(REQ)).rejects.toThrow("请求失败");

    mockFetch(() => new Response("plain text error", { status: 500 }));
    await expect(sendAgentMessage(REQ)).rejects.toThrow("请求失败");
  });

  it("响应体不是 JSON 但状态 2xx → 不因 json() 抛错而炸（回落到空响应）", async () => {
    mockFetch(() => new Response("<html>", { status: 200 }));
    const res = await sendAgentMessage(REQ);
    expect(res).toEqual({});
  });

  it("fetch 抛错（服务不可达）→ 抛出可读文案，而不是原始 TypeError", async () => {
    mockFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(sendAgentMessage(REQ)).rejects.toThrow("无法连接服务器");
  });

  it("请求体按线上协议序列化", async () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    mockFetch(() => new Response("{}", { status: 200 }));
    vi.mocked(fetch).mockImplementation((url: string | URL | Request, init) => {
      seen.url =
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      seen.init = init;
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    await sendAgentMessage(REQ);
    expect(seen.url).toBe("/api/agent/chat");
    expect(seen.init?.method).toBe("POST");
    expect(JSON.parse(seen.init?.body as string)).toEqual(REQ);
  });
});
