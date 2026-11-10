/**
 * `api-format.ts` — 三种上游接口格式的请求组装与响应解析（#3501）。
 *
 * 支持：
 *  · `chat-completions` —— OpenAI 兼容 `/chat/completions`（历史唯一通道，
 *    本地 Ollama / LM Studio / vLLM 也走它；本地多模态的 `images` 字段在这一支）；
 *  · `anthropic-messages` —— Anthropic Messages `/v1/messages`（system 提到顶层、
 *    图块用 `source.url`、工具结果是 `tool_result` 块）；
 *  · `responses` —— OpenAI Responses `/responses`（system 落 `instructions`、
 *    工具结果是 `function_call_output`）。
 *
 * 这里是**纯函数**（不碰 fetch、不碰 server-only），单测直接喂形状即可。
 * 传输层在 `~/lib/llm/server`：它只负责「取 url / headers / body → POST → 交给
 * 本模块解析」，不再自己拼协议细节。
 *
 * 工具调用只保证 `chat-completions` 一条链（其余两条的协议差异大、仓里也没有
 * 使用方），非该格式时由 `server.ts` 大声拒绝，而不是发出一个必然被上游忽略的
 * `tools` 字段。
 *
 * @module lib/llm/api-format
 */

import { asRecord } from "~/lib/is-record";
import { LLM_API_FORMAT_PATHS, type LlmApiFormat } from "./provider-types";
import type { LLMContentPart, LLMMessage, LLMTool } from "./types";

export type ChatRequestInput = {
  apiKey?: string | null;
  baseUrl: string;
  /** 本次调用的接口格式（由命中的供应商决定）。 */
  format: LlmApiFormat;
  /** 本地 Ollama：只有 chat-completions 这一支有区别（图块进 `images` 字段）。 */
  local: boolean;
  maxTokens: number;
  messages: Array<LLMMessage>;
  model: string;
  /** 结构化输出：只对 chat-completions / responses 生效。 */
  responseFormatJson?: boolean;
  stream: boolean;
  temperature: number;
  tools?: Array<LLMTool>;
};

/** 上游请求地址：Base URL 去尾斜杠 + 格式路径段。 */
export function chatRequestUrl(baseUrl: string, format: LlmApiFormat): string {
  return `${baseUrl.trim().replace(/\/$/, "")}${LLM_API_FORMAT_PATHS[format]}`;
}

/** 鉴权头：Anthropic 用 `x-api-key` + `anthropic-version`；其余用 Bearer。 */
export function chatHeaders(
  format: LlmApiFormat,
  apiKey: string | null | undefined,
): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (key === "") {
    return headers;
  }
  if (format === "anthropic-messages") {
    headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
    return headers;
  }
  headers.Authorization = `Bearer ${key}`;
  return headers;
}

/* ── 消息序列化 ─────────────────────────────────────────────────── */

function isTextPart(p: LLMContentPart): p is Extract<LLMContentPart, { type: "text" }> {
  return p.type === "text";
}

function isImagePart(p: LLMContentPart): p is Extract<LLMContentPart, { type: "image_url" }> {
  return p.type === "image_url";
}

/** chat-completions / 本地 Ollama 的消息形状（原 `messagesToWire`）。 */
function openAiMessages(
  local: boolean,
  messages: Array<LLMMessage>,
): Array<Record<string, unknown>> {
  return messages.map((m) => {
    const base: Record<string, unknown> = { role: m.role };
    if (typeof m.content === "string") {
      base.content = m.content;
    } else if (local) {
      const texts = m.content
        .filter(isTextPart)
        .map((p) => p.text)
        .join("\n");
      const images = m.content.filter(isImagePart).map((p) => p.image_url.url);
      base.content = texts;
      if (images.length > 0) {
        base.images = images;
      }
    } else {
      base.content = m.content.map((p) =>
        p.type === "text"
          ? { type: "text", text: p.text }
          : { type: "image_url", image_url: p.image_url },
      );
    }
    if (m.tool_calls) {
      base.tool_calls = m.tool_calls;
    }
    if (typeof m.tool_call_id === "string" && m.tool_call_id !== "") {
      base.tool_call_id = m.tool_call_id;
    }
    return base;
  });
}

/** Anthropic Messages 的 content 块（图块用 source.url；工具结果单独成块）。 */
function anthropicContent(content: string | Array<LLMContentPart>): Array<Record<string, unknown>> {
  if (typeof content === "string") {
    return content === "" ? [] : [{ type: "text", text: content }];
  }
  return content.map((p) =>
    p.type === "text"
      ? { type: "text", text: p.text }
      : { type: "image", source: { type: "url", url: p.image_url.url } },
  );
}

function anthropicMessages(messages: Array<LLMMessage>): {
  messages: Array<Record<string, unknown>>;
  system: string;
} {
  const systemParts: Array<string> = [];
  const out: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(typeof m.content === "string" ? m.content : "");
      continue;
    }
    if (m.role === "tool") {
      out.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.tool_call_id ?? "",
            content: typeof m.content === "string" ? m.content : "",
          },
        ],
      });
      continue;
    }
    const blocks = anthropicContent(m.content);
    if (m.role === "assistant" && m.tool_calls) {
      for (const call of m.tool_calls) {
        let input: unknown;
        try {
          input = JSON.parse(call.function.arguments);
        } catch {
          input = {};
        }
        blocks.push({ type: "tool_use", id: call.id, name: call.function.name, input });
      }
    }
    out.push({ role: m.role === "assistant" ? "assistant" : "user", content: blocks });
  }
  return { messages: out, system: systemParts.filter((s) => s !== "").join("\n") };
}

/** Responses 的 input 条目（system 提到 `instructions`，工具结果成独立条目）。 */
function responsesInput(messages: Array<LLMMessage>): {
  input: Array<Record<string, unknown>>;
  instructions: string;
} {
  const instructions: Array<string> = [];
  const input: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === "system") {
      instructions.push(typeof m.content === "string" ? m.content : "");
      continue;
    }
    if (m.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: m.tool_call_id ?? "",
        output: typeof m.content === "string" ? m.content : "",
      });
      continue;
    }
    if (typeof m.content === "string") {
      input.push({ role: m.role, content: m.content });
      continue;
    }
    input.push({
      role: m.role,
      content: m.content.map((p) =>
        p.type === "text"
          ? { type: "input_text", text: p.text }
          : { type: "input_image", image_url: p.image_url.url },
      ),
    });
  }
  return { input, instructions: instructions.filter((s) => s !== "").join("\n") };
}

function toolsForAnthropic(tools: Array<LLMTool>): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters ?? { type: "object", properties: {} },
  }));
}

function toolsForResponses(tools: Array<LLMTool>): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    type: "function",
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters ?? { type: "object", properties: {} },
  }));
}

/** 组装一次对话请求（url / headers / body 三件套）。 */
export function buildChatRequest(input: ChatRequestInput): {
  body: Record<string, unknown>;
  headers: Record<string, string>;
  url: string;
} {
  const url = chatRequestUrl(input.baseUrl, input.format);
  const headers = chatHeaders(input.format, input.apiKey);
  if (input.format === "anthropic-messages") {
    const wire = anthropicMessages(input.messages);
    const body: Record<string, unknown> = {
      model: input.model,
      max_tokens: input.maxTokens,
      temperature: input.temperature,
      messages: wire.messages,
      stream: input.stream,
    };
    if (wire.system !== "") {
      body.system = wire.system;
    }
    if (input.tools !== undefined && input.tools.length > 0) {
      body.tools = toolsForAnthropic(input.tools);
    }
    return { url, headers, body };
  }
  if (input.format === "responses") {
    const wire = responsesInput(input.messages);
    const body: Record<string, unknown> = {
      model: input.model,
      max_output_tokens: input.maxTokens,
      temperature: input.temperature,
      input: wire.input,
      stream: input.stream,
    };
    if (wire.instructions !== "") {
      body.instructions = wire.instructions;
    }
    if (input.responseFormatJson === true) {
      body.text = { format: { type: "json_object" } };
    }
    if (input.tools !== undefined && input.tools.length > 0) {
      body.tools = toolsForResponses(input.tools);
    }
    return { url, headers, body };
  }
  const body: Record<string, unknown> = {
    model: input.model,
    messages: openAiMessages(input.local, input.messages),
    temperature: input.temperature,
    max_tokens: input.maxTokens,
    stream: input.stream,
  };
  if (input.responseFormatJson === true) {
    body.response_format = { type: "json_object" };
  }
  if (input.tools !== undefined && input.tools.length > 0) {
    body.tools = input.tools;
  }
  return { url, headers, body };
}

/* ── 响应解析 ───────────────────────────────────────────────────── */

function firstChoice(payload: unknown): Record<string, unknown> | null {
  const rec = asRecord(payload);
  const choices = rec === null ? undefined : rec.choices;
  const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
  return asRecord(first);
}

function stringField(rec: Record<string, unknown> | null, key: string, fallback: string): string {
  const v = rec === null ? undefined : rec[key];
  return typeof v === "string" ? v : fallback;
}

/** 从响应体取助手文本。 */
export function extractText(format: LlmApiFormat, payload: unknown): string {
  if (format === "anthropic-messages") {
    const rec = asRecord(payload);
    const blocks = rec === null ? undefined : rec.content;
    if (!Array.isArray(blocks)) {
      return "";
    }
    return blocks
      .map((block) => {
        const b = asRecord(block);
        return b?.type === "text" ? stringField(b, "text", "") : "";
      })
      .join("");
  }
  if (format === "responses") {
    const rec = asRecord(payload);
    if (rec !== null) {
      if (typeof rec.output_text === "string") {
        return rec.output_text;
      }
      const output = rec.output;
      if (Array.isArray(output)) {
        return output
          .map((item) => {
            const it = asRecord(item);
            const content = it === null ? undefined : it.content;
            if (!Array.isArray(content)) {
              return "";
            }
            return content
              .map((part) => {
                const p = asRecord(part);
                return p !== null && typeof p.text === "string" ? p.text : "";
              })
              .join("");
          })
          .join("");
      }
    }
    return "";
  }
  const choice = firstChoice(payload);
  const message = choice === null ? null : asRecord(choice.message);
  return stringField(message, "content", "");
}

/** 从一帧 SSE 里取增量文本（`[DONE]` 由调用方先剥掉）。 */
export function extractStreamDelta(format: LlmApiFormat, payload: unknown): string {
  if (format === "anthropic-messages") {
    const rec = asRecord(payload);
    if (rec === null || rec.type !== "content_block_delta") {
      return "";
    }
    const delta = asRecord(rec.delta);
    return stringField(delta, "text", "");
  }
  if (format === "responses") {
    const rec = asRecord(payload);
    if (rec === null || rec.type !== "response.output_text.delta") {
      return "";
    }
    return stringField(rec, "delta", "");
  }
  const choice = firstChoice(payload);
  const delta = choice === null ? null : asRecord(choice.delta);
  return stringField(delta, "content", "");
}

export type ParsedToolCall = {
  function: { arguments: string; name: string };
  id: string;
  type: "function";
};

/** 从响应体取工具调用（只有 chat-completions 保证支持；其余两条也顺手解析）。 */
export function extractToolCalls(format: LlmApiFormat, payload: unknown): Array<ParsedToolCall> {
  if (format === "anthropic-messages") {
    const rec = asRecord(payload);
    const blocks = rec === null ? undefined : rec.content;
    if (!Array.isArray(blocks)) {
      return [];
    }
    const out: Array<ParsedToolCall> = [];
    for (const block of blocks) {
      const b = asRecord(block);
      if (b === null || b.type !== "tool_use" || typeof b.id !== "string") {
        continue;
      }
      const name = stringField(b, "name", "");
      if (name === "") {
        continue;
      }
      out.push({
        id: b.id,
        type: "function",
        function: { name, arguments: JSON.stringify(b.input ?? {}) },
      });
    }
    return out;
  }
  if (format === "responses") {
    const rec = asRecord(payload);
    const output = rec === null ? undefined : rec.output;
    if (!Array.isArray(output)) {
      return [];
    }
    const out: Array<ParsedToolCall> = [];
    for (const item of output) {
      const it = asRecord(item);
      if (it === null || it.type !== "function_call") {
        continue;
      }
      const callId = typeof it.call_id === "string" ? it.call_id : "";
      const name = stringField(it, "name", "");
      if (callId === "" || name === "") {
        continue;
      }
      out.push({
        id: callId,
        type: "function",
        function: { name, arguments: stringField(it, "arguments", "{}") },
      });
    }
    return out;
  }
  const choice = firstChoice(payload);
  const message = choice === null ? null : asRecord(choice.message);
  const rawCallsValue: unknown = message === null ? undefined : message.tool_calls;
  const rawCalls: Array<unknown> = Array.isArray(rawCallsValue) ? rawCallsValue : [];
  const out: Array<ParsedToolCall> = [];
  for (const call of rawCalls) {
    const callRecord = asRecord(call);
    const fn = callRecord === null ? null : asRecord(callRecord.function);
    if (callRecord === null || fn === null) {
      continue;
    }
    const id = callRecord.id;
    const fnName = fn.name;
    const fnArguments = fn.arguments;
    if (
      typeof id !== "string" ||
      id === "" ||
      typeof fnName !== "string" ||
      fnName === "" ||
      typeof fnArguments !== "string"
    ) {
      continue;
    }
    out.push({ id, type: "function", function: { name: fnName, arguments: fnArguments } });
  }
  return out;
}
