import { type NextRequest, NextResponse } from "next/server";
import {
  getLLMConfig,
  completeLLM,
  completeLLMTools,
  streamLLM,
} from "~/lib/llm/server";
import { requireRequestUser } from "~/server/auth/request-user";
import { apiErrorBody } from "~/lib/api-error";
import {
  TASK_TYPES,
  type LLMMessage,
  type LLMRequestOptions,
  type LLMProviderType,
  type TaskType,
} from "~/lib/llm/types";
import { isRecord } from "~/lib/is-record";
import { isErrorResponse, readJsonRecord } from "~/server/lib/request-body";
import { unauthorizedResponse } from "~/server/lib/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = {
  parse(body: unknown): {
    messages: LLMMessage[];
    stream: boolean;
    opts: LLMRequestOptions;
  } {
    const rec: Record<string, unknown> = isRecord(body) ? body : {};
    if (!Array.isArray(rec.messages) || rec.messages.length === 0) {
      throw new Error("messages 不能为空");
    }
    const rawMessages: unknown[] = rec.messages;
    const messages: LLMMessage[] = rawMessages.map((m: unknown) => {
      // 逐元素断言为最小形状;null/undefined 元素在属性访问处抛 TypeError → 400,与原 any 版一致。
      const entry = m as {
        role?: unknown;
        content?: unknown;
        tool_calls?: unknown;
        tool_call_id?: unknown;
      };
      // 用 unknown 局部变量承接 `??` 结果,避免 String() 落在真值窄化后的 `{}` 类型上。
      const rawContent: unknown = entry.content ?? "";
      const role =
        entry.role === "assistant"
          ? "assistant"
          : entry.role === "user"
            ? "user"
            : entry.role === "tool"
              ? "tool"
              : "system";
      const base: LLMMessage = { role, content: String(rawContent) };
      // 透传 tool_calls（assistant 消息带）与 tool_call_id（tool 消息带）
      if (role === "assistant" && Array.isArray(entry.tool_calls)) {
        base.tool_calls = entry.tool_calls as LLMMessage["tool_calls"];
      }
      if (role === "tool" && typeof entry.tool_call_id === "string") {
        base.tool_call_id = entry.tool_call_id;
      }
      return base;
    });
    const opts: LLMRequestOptions = {};
    // 原 `as any` 透传:非 "local"/"remote" 的值继续透传给 getLLMConfig(按非 remote 处理),
    // 加守卫反而会改变该退化行为,这里只恢复静态类型。
    if (rec.provider) opts.provider = rec.provider as LLMProviderType;
    if (rec.model) {
      const rawModel: unknown = rec.model;
      opts.model = String(rawModel);
    }
    if (typeof rec.temperature === "number") opts.temperature = rec.temperature;
    if (typeof rec.maxTokens === "number") opts.maxTokens = rec.maxTokens;
    if (typeof rec.taskType === "string" && rec.taskType in TASK_TYPES) {
      opts.taskType = rec.taskType as TaskType;
    }
    if (Array.isArray(rec.tools)) {
      opts.tools = rec.tools as NonNullable<typeof opts.tools>;
    }
    return { messages, stream: rec.stream === true, opts };
  },
};

export async function POST(req: NextRequest) {
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }

  /* 读体那一步走唯一出口（规范 16 §16.2.4.44）；**字段级**校验仍留给
   * `BodySchema` —— 它绑着 `LLMRequestOptions` 的语义，是这一域的判据。 */
  const body = await readJsonRecord(req);
  if (isErrorResponse(body)) return body;

  let parsed: Awaited<ReturnType<typeof BodySchema.parse>>;
  try {
    parsed = BodySchema.parse(body);
  } catch (e) {
    return NextResponse.json(apiErrorBody(e, "请求格式错误"), { status: 400 });
  }

  const cfg = await getLLMConfig(parsed.opts);

  // ── Non-streaming ──
  if (!parsed.stream) {
    try {
      // 带 tools 参数时走工具调用链路，返回 tool_calls（Agent 场景）
      if (parsed.opts.tools?.length) {
        const result = await completeLLMTools(
          cfg,
          parsed.messages,
          parsed.opts.tools,
        );
        return NextResponse.json({
          content: result.content,
          tool_calls: result.toolCalls,
        });
      }
      const content = await completeLLM(cfg, parsed.messages);
      return NextResponse.json({ content });
    } catch (e) {
      return NextResponse.json(apiErrorBody(e, "LLM 调用失败"), {
        status: 502,
      });
    }
  }

  // ── Streaming (SSE) ──
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await streamLLM(cfg, parsed.messages, (token) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ token })}\n\n`),
          );
        });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (e) {
        controller.enqueue(
          encoder.encode(
            /* SSE 的一帧也用同一个键：客户端读的是同一处 `readApiError`。 */
            `data: ${JSON.stringify(apiErrorBody(e, "LLM 调用失败"))}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
