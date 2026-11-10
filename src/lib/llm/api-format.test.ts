/**
 * `api-format.ts` 的三种上游协议（#3501）。
 *
 * 这一份只判「url / headers / body 三件套」与「响应 → 文本 / 增量 / 工具调用」，
 * 传输层（fetch、流读取）在 `server.ts`，不在本文件的责任面。
 */
import { describe, expect, it } from "vitest";

import {
  buildChatRequest,
  chatHeaders,
  chatRequestUrl,
  extractStreamDelta,
  extractText,
  extractToolCalls,
  type ChatRequestInput,
} from "./api-format";
import type { LLMMessage, LLMTool } from "./types";

const baseInput = (patch: Partial<ChatRequestInput> = {}): ChatRequestInput => ({
  baseUrl: "https://platform.agnes-ai.com/",
  format: "chat-completions",
  local: false,
  maxTokens: 1024,
  messages: [{ role: "user", content: "你好" }],
  model: "claude-sonnet-4",
  stream: false,
  temperature: 0.7,
  ...patch,
});

const tool: LLMTool = {
  type: "function",
  function: {
    name: "lookup",
    description: "查资料",
    parameters: { type: "object", properties: { q: { type: "string" } } },
  },
};

describe("chatRequestUrl / chatHeaders", () => {
  it("Base URL 去尾斜杠后按格式拼路径段", () => {
    expect(chatRequestUrl("https://agnes/v1/", "chat-completions")).toBe(
      "https://agnes/v1/chat/completions",
    );
    expect(chatRequestUrl("https://agnes", "anthropic-messages")).toBe("https://agnes/v1/messages");
    expect(chatRequestUrl(" https://agnes/ ", "responses")).toBe("https://agnes/responses");
    expect(chatRequestUrl("", "responses")).toBe("/responses");
  });

  it("Anthropic 用 x-api-key + anthropic-version；其余用 Bearer；空密钥只留 Content-Type", () => {
    expect(chatHeaders("anthropic-messages", " sk-ant ")).toEqual({
      "Content-Type": "application/json",
      "x-api-key": "sk-ant",
      "anthropic-version": "2023-06-01",
    });
    expect(chatHeaders("chat-completions", "sk-openai")).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer sk-openai",
    });
    expect(chatHeaders("responses", "sk-r")).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer sk-r",
    });
    expect(chatHeaders("chat-completions", "   ")).toEqual({ "Content-Type": "application/json" });
    expect(chatHeaders("chat-completions", null)).toEqual({ "Content-Type": "application/json" });
  });
});

describe("buildChatRequest —— chat-completions", () => {
  it("url / headers / body 三件套：max_tokens、temperature、stream 原样透传", () => {
    const req = buildChatRequest(
      baseInput({ apiKey: "sk-1", stream: true, maxTokens: 2048, temperature: 0.2 }),
    );
    expect(req.url).toBe("https://platform.agnes-ai.com/chat/completions");
    expect(req.headers.Authorization).toBe("Bearer sk-1");
    expect(req.body).toEqual({
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "你好" }],
      temperature: 0.2,
      max_tokens: 2048,
      stream: true,
    });
  });

  it("多模态：远端走 content 数组（image_url 对象），本地 Ollama 走 images 字段", () => {
    const messages: Array<LLMMessage> = [
      {
        role: "user",
        content: [
          { type: "text", text: "看这张" },
          { type: "text", text: "还有这张" },
          { type: "image_url", image_url: { url: "https://img/a.png" } },
        ],
      },
    ];
    const remote = buildChatRequest(baseInput({ messages }));
    expect(remote.body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "看这张" },
          { type: "text", text: "还有这张" },
          { type: "image_url", image_url: { url: "https://img/a.png" } },
        ],
      },
    ]);

    const local = buildChatRequest(baseInput({ messages, local: true }));
    expect(local.body.messages).toEqual([
      {
        role: "user",
        content: "看这张\n还有这张",
        images: ["https://img/a.png"],
      },
    ]);
  });

  it("tool_calls / tool_call_id / response_format / tools 只在给出时出现", () => {
    const messages: Array<LLMMessage> = [
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "c1", type: "function", function: { name: "lookup", arguments: "{}" } }],
      },
      { role: "tool", content: "结果", tool_call_id: "c1" },
    ];
    const req = buildChatRequest(baseInput({ messages, responseFormatJson: true, tools: [tool] }));
    expect(req.body.response_format).toEqual({ type: "json_object" });
    expect(req.body.tools).toEqual([tool]);
    expect(req.body.messages).toEqual([
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "c1", type: "function", function: { name: "lookup", arguments: "{}" } }],
      },
      { role: "tool", content: "结果", tool_call_id: "c1" },
    ]);

    const plain = buildChatRequest(baseInput());
    expect(plain.body).not.toHaveProperty("tools");
    expect(plain.body).not.toHaveProperty("response_format");
  });
});

describe("buildChatRequest —— anthropic-messages", () => {
  it("system 提到顶层、user / assistant 保留消息块、max_tokens 命名不同", () => {
    const req = buildChatRequest(
      baseInput({
        format: "anthropic-messages",
        apiKey: "sk-ant",
        maxTokens: 4096,
        messages: [
          { role: "system", content: "你是助手" },
          { role: "system", content: "回答简短" },
          { role: "user", content: "你好" },
        ],
      }),
    );
    expect(req.url).toBe("https://platform.agnes-ai.com/v1/messages");
    expect(req.headers["x-api-key"]).toBe("sk-ant");
    expect(req.body).toEqual({
      model: "claude-sonnet-4",
      max_tokens: 4096,
      temperature: 0.7,
      messages: [{ role: "user", content: [{ type: "text", text: "你好" }] }],
      system: "你是助手\n回答简短",
      stream: false,
    });
    // Anthropic 没有 response_format 那一格
    expect(req.body).not.toHaveProperty("response_format");
  });

  it("没有 system 时不写 system 字段；空文本消息给空块数组", () => {
    const req = buildChatRequest(
      baseInput({
        format: "anthropic-messages",
        messages: [{ role: "assistant", content: "" }],
      }),
    );
    expect(req.body).not.toHaveProperty("system");
    expect(req.body.messages).toEqual([{ role: "assistant", content: [] }]);
  });

  it("图块用 source.url；assistant 的 tool_calls 翻成 tool_use；tool 结果是 tool_result 块", () => {
    const req = buildChatRequest(
      baseInput({
        format: "anthropic-messages",
        messages: [
          {
            role: "user",
            content: [{ type: "image_url", image_url: { url: "https://img/a.png" } }],
          },
          {
            role: "assistant",
            content: "我查一下",
            tool_calls: [
              { id: "c1", type: "function", function: { name: "lookup", arguments: '{"q":"x"}' } },
              { id: "c2", type: "function", function: { name: "lookup", arguments: "not-json" } },
            ],
          },
          { role: "tool", content: "查到了", tool_call_id: "c1" },
        ],
      }),
    );
    expect(req.body.messages).toEqual([
      {
        role: "user",
        content: [{ type: "image", source: { type: "url", url: "https://img/a.png" } }],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "我查一下" },
          { type: "tool_use", id: "c1", name: "lookup", input: { q: "x" } },
          // 参数不是合法 JSON 时给空对象，不让整条请求炸掉
          { type: "tool_use", id: "c2", name: "lookup", input: {} },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "c1", content: "查到了" }],
      },
    ]);
  });

  it("tools 翻成 name / description / input_schema", () => {
    const req = buildChatRequest(baseInput({ format: "anthropic-messages", tools: [tool] }));
    expect(req.body.tools).toEqual([
      {
        name: "lookup",
        description: "查资料",
        input_schema: { type: "object", properties: { q: { type: "string" } } },
      },
    ]);
  });
});

describe("buildChatRequest —— responses", () => {
  it("system 落 instructions、user 文本落 input、max_output_tokens 命名不同", () => {
    const req = buildChatRequest(
      baseInput({
        format: "responses",
        apiKey: "sk-r",
        maxTokens: 2048,
        messages: [
          { role: "system", content: "你是助手" },
          { role: "user", content: "你好" },
        ],
      }),
    );
    expect(req.url).toBe("https://platform.agnes-ai.com/responses");
    expect(req.headers.Authorization).toBe("Bearer sk-r");
    expect(req.body).toEqual({
      model: "claude-sonnet-4",
      max_output_tokens: 2048,
      temperature: 0.7,
      input: [{ role: "user", content: "你好" }],
      instructions: "你是助手",
      stream: false,
    });
  });

  it("多模态用 input_text / input_image；工具结果成 function_call_output 条目", () => {
    const req = buildChatRequest(
      baseInput({
        format: "responses",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "看图" },
              { type: "image_url", image_url: { url: "https://img/a.png" } },
            ],
          },
          { role: "tool", content: "结果", tool_call_id: "c1" },
        ],
      }),
    );
    expect(req.body.input).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "看图" },
          { type: "input_image", image_url: "https://img/a.png" },
        ],
      },
      { type: "function_call_output", call_id: "c1", output: "结果" },
    ]);
  });

  it("responseFormatJson 落 text.format；tools 落 name / parameters（无 type: function 外层）", () => {
    const req = buildChatRequest(
      baseInput({ format: "responses", responseFormatJson: true, tools: [tool] }),
    );
    expect(req.body.text).toEqual({ format: { type: "json_object" } });
    expect(req.body.tools).toEqual([
      {
        type: "function",
        name: "lookup",
        description: "查资料",
        parameters: { type: "object", properties: { q: { type: "string" } } },
      },
    ]);
    expect(req.body).not.toHaveProperty("instructions");
  });
});

describe("extractText", () => {
  it("chat-completions 取 choices[0].message.content", () => {
    expect(extractText("chat-completions", { choices: [{ message: { content: "答" } }] })).toBe(
      "答",
    );
    expect(extractText("chat-completions", { choices: [] })).toBe("");
    expect(extractText("chat-completions", "not-an-object")).toBe("");
  });

  it("anthropic 拼接 content 里的 text 块（跳过其它块）", () => {
    expect(
      extractText("anthropic-messages", {
        content: [
          { type: "text", text: "甲" },
          { type: "tool_use", id: "c1", name: "x", input: {} },
          { type: "text", text: "乙" },
        ],
      }),
    ).toBe("甲乙");
    expect(extractText("anthropic-messages", { content: "nope" })).toBe("");
  });

  it("responses 优先 output_text，缺失时拼 output[].content[].text", () => {
    expect(extractText("responses", { output_text: "直接给" })).toBe("直接给");
    expect(
      extractText("responses", {
        output: [
          { type: "message", content: [{ type: "output_text", text: "甲" }] },
          { type: "message", content: [{ type: "output_text", text: "乙" }] },
          { type: "function_call", call_id: "c1", name: "x", arguments: "{}" },
        ],
      }),
    ).toBe("甲乙");
    expect(extractText("responses", { output: "nope" })).toBe("");
  });
});

describe("extractStreamDelta", () => {
  it("chat-completions 取 choices[0].delta.content", () => {
    expect(
      extractStreamDelta("chat-completions", { choices: [{ delta: { content: "增" } }] }),
    ).toBe("增");
    expect(extractStreamDelta("chat-completions", { choices: [{ delta: {} }] })).toBe("");
  });

  it("anthropic 只认 content_block_delta；responses 只认 response.output_text.delta", () => {
    expect(
      extractStreamDelta("anthropic-messages", {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "甲" },
      }),
    ).toBe("甲");
    expect(
      extractStreamDelta("anthropic-messages", { type: "message_start", delta: { text: "x" } }),
    ).toBe("");
    expect(
      extractStreamDelta("responses", { type: "response.output_text.delta", delta: "乙" }),
    ).toBe("乙");
    expect(extractStreamDelta("responses", { type: "response.completed", delta: "x" })).toBe("");
  });
});

describe("extractToolCalls", () => {
  it("chat-completions：只收形状完整的调用（id / name / arguments 都得是字符串）", () => {
    expect(
      extractToolCalls("chat-completions", {
        choices: [
          {
            message: {
              tool_calls: [
                { id: "c1", type: "function", function: { name: "a", arguments: "{}" } },
                { id: "", type: "function", function: { name: "b", arguments: "{}" } },
                { id: "c2", type: "function", function: { name: "", arguments: "{}" } },
                { id: "c3", type: "function", function: { name: "c", arguments: 1 } },
                "nope",
              ],
            },
          },
        ],
      }),
    ).toEqual([{ id: "c1", type: "function", function: { name: "a", arguments: "{}" } }]);
    expect(extractToolCalls("chat-completions", {})).toEqual([]);
  });

  it("anthropic：tool_use 块翻成 function 调用（input 重新序列化）", () => {
    expect(
      extractToolCalls("anthropic-messages", {
        content: [
          { type: "text", text: "先查" },
          { type: "tool_use", id: "c1", name: "lookup", input: { q: "x" } },
          { type: "tool_use", id: "c2", name: "", input: {} },
          { type: "tool_use", name: "no-id", input: {} },
        ],
      }),
    ).toEqual([
      { id: "c1", type: "function", function: { name: "lookup", arguments: '{"q":"x"}' } },
    ]);
    expect(extractToolCalls("anthropic-messages", {})).toEqual([]);
  });

  it("responses：function_call 条目（缺 call_id / name 的丢掉）", () => {
    expect(
      extractToolCalls("responses", {
        output: [
          { type: "function_call", call_id: "c1", name: "lookup", arguments: '{"q":"x"}' },
          { type: "function_call", call_id: "", name: "lookup", arguments: "{}" },
          { type: "function_call", call_id: "c2", name: "", arguments: "{}" },
          { type: "message", content: [] },
        ],
      }),
    ).toEqual([
      { id: "c1", type: "function", function: { name: "lookup", arguments: '{"q":"x"}' } },
    ]);
    expect(extractToolCalls("responses", {})).toEqual([]);
  });
});
