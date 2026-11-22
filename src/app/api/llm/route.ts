import { type NextRequest, NextResponse } from "next/server";
import { getLLMConfig, completeLLM, completeLLMTools, streamLLM } from "~/lib/llm/server";
import { requireRequestUser } from "~/server/auth/request-user";
import { apiErrorBody } from "~/lib/api-error";
import {
  TASK_TYPES,
  type LLMMessage,
  type LLMRequestOptions,
  type LLMProviderType,
  type LLMTool,
  type TaskType,
} from "~/lib/llm/types";
import { isRecord } from "~/lib/is-record";
import { isErrorResponse, readJsonRecord } from "~/server/lib/request-body";
import { unauthorizedResponse } from "~/server/lib/error-response";
import { rejectCrossOriginWrite } from "~/server/lib/same-origin";
import { rejectOverRateLimit } from "~/server/lib/rest-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDER_TYPES: ReadonlyArray<LLMProviderType> = ["local", "remote"];

function isLLMProviderType(v: unknown): v is LLMProviderType {
  return typeof v === "string" && PROVIDER_TYPES.some((provider) => provider === v);
}

function isTaskType(v: unknown): v is TaskType {
  return typeof v === "string" && v in TASK_TYPES;
}

type LLMToolCallList = NonNullable<LLMMessage["tool_calls"]>;
type LLMToolCallEntry = LLMToolCallList[number];

function isLLMToolCall(v: unknown): v is LLMToolCallEntry {
  return (
    isRecord(v) &&
    v.type === "function" &&
    typeof v.id === "string" &&
    isRecord(v.function) &&
    typeof v.function.arguments === "string" &&
    typeof v.function.name === "string"
  );
}

function isLLMToolCallList(v: unknown): v is LLMToolCallList {
  return Array.isArray(v) && v.every(isLLMToolCall);
}

function isLLMTool(v: unknown): v is LLMTool {
  return (
    isRecord(v) &&
    v.type === "function" &&
    isRecord(v.function) &&
    typeof v.function.name === "string" &&
    typeof v.function.description === "string" &&
    (v.function.parameters === undefined || isRecord(v.function.parameters))
  );
}

function isLLMToolArray(v: unknown): v is Array<LLMTool> {
  return Array.isArray(v) && v.every(isLLMTool);
}

const BodySchema = {
  parse(body: unknown): {
    messages: Array<LLMMessage>;
    opts: LLMRequestOptions;
    stream: boolean;
  } {
    const rec: Record<string, unknown> = isRecord(body) ? body : {};
    if (!Array.isArray(rec.messages) || rec.messages.length === 0) {
      throw new Error("messages 不能为空");
    }
    const rawMessages: Array<unknown> = rec.messages;
    const messages: Array<LLMMessage> = rawMessages.map((m: unknown) => {
      // 逐元素窄化;null/undefined 元素直接抛 TypeError → 400,与原 any 版一致。
      if (m === null || m === undefined) {
        throw new TypeError("消息元素不能为 null/undefined");
      }
      const entry: Record<string, unknown> = isRecord(m) ? m : {};
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
      if (role === "assistant" && isLLMToolCallList(entry.tool_calls)) {
        base.tool_calls = entry.tool_calls;
      }
      if (role === "tool" && typeof entry.tool_call_id === "string") {
        base.tool_call_id = entry.tool_call_id;
      }
      return base;
    });
    const opts: LLMRequestOptions = {};
    // 只接受白名单内的 provider；非法值不进入 opts，下游按「非 remote 即本地」处理。
    if (isLLMProviderType(rec.provider)) {
      opts.provider = rec.provider;
    }
    const hasModel = Boolean(rec.model);
    if (hasModel) {
      const rawModel: unknown = rec.model;
      opts.model = String(rawModel);
    }
    if (typeof rec.temperature === "number") {
      opts.temperature = rec.temperature;
    }
    if (typeof rec.maxTokens === "number") {
      opts.maxTokens = rec.maxTokens;
    }
    if (isTaskType(rec.taskType)) {
      opts.taskType = rec.taskType;
    }
    if (isLLMToolArray(rec.tools)) {
      opts.tools = rec.tools;
    }
    return { messages, stream: rec.stream === true, opts };
  },
};

export async function POST(req: NextRequest) {
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }
  /* 同源闸（#4723）：写端点统一入口，判据见 ~/server/lib/same-origin。 */
  const crossOrigin = rejectCrossOriginWrite(req);
  if (crossOrigin !== null) {
    return crossOrigin;
  }
  /* 限流（#4725）：会花钱/外联/拉进程的端点挂滑动窗口（默认 10s/20 次）。 */
  const limited = rejectOverRateLimit(req, "llm-chat");
  if (limited !== null) {
    return limited;
  }

  /* 读体那一步走唯一出口（规范 16 §16.2.4.44）；**字段级**校验仍留给
   * `BodySchema` —— 它绑着 `LLMRequestOptions` 的语义，是这一域的判据。 */
  const body = await readJsonRecord(req);
  if (isErrorResponse(body)) {
    return body;
  }

  let parsed: Awaited<ReturnType<typeof BodySchema.parse>>;
  try {
    parsed = BodySchema.parse(body);
  } catch (error) {
    return NextResponse.json(apiErrorBody(error, "请求格式错误"), { status: 400 });
  }

  const cfg = await getLLMConfig(parsed.opts);

  // ── Non-streaming ──
  if (!parsed.stream) {
    try {
      // 带 tools 参数时走工具调用链路，返回 tool_calls（Agent 场景）
      if (parsed.opts.tools !== undefined && parsed.opts.tools.length > 0) {
        const result = await completeLLMTools(cfg, parsed.messages, parsed.opts.tools, req.signal);
        return NextResponse.json({
          content: result.content,
          tool_calls: result.toolCalls,
        });
      }
      const content = await completeLLM(cfg, parsed.messages, req.signal);
      return NextResponse.json({ content });
    } catch (error) {
      return NextResponse.json(apiErrorBody(error, "LLM 调用失败"), {
        status: 502,
      });
    }
  }

  // ── Streaming (SSE) ──
  const encoder = new TextEncoder();
  /* 客户端断开（req.signal abort → 流被 cancel）之后，上游的尾随令牌仍可能
   * 回来——对已关闭的 controller enqueue 会抛 TypeError（catch/finally 里再
   * 抛一次），每次断开都制造一串错误噪音。closed 判据让断开后的帧静默丢弃
   *（ISSUE #4286）。 */
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: string): void => {
        if (!closed) {
          controller.enqueue(encoder.encode(payload));
        }
      };
      req.signal.addEventListener("abort", () => {
        closed = true;
      });
      try {
        await streamLLM(
          cfg,
          parsed.messages,
          (token) => {
            send(`data: ${JSON.stringify({ token })}\n\n`);
          },
          /* 客户端断开（req.signal abort）→ 连上游一起停，别让挂起的生成白烧预算。 */
          req.signal,
        );
        send("data: [DONE]\n\n");
      } catch (error) {
        send(
          `data: ${JSON.stringify(
            /* SSE 的一帧也用同一个键：客户端读的是同一处 `readApiError`。 */
            apiErrorBody(error, "LLM 调用失败"),
          )}\n\n`,
        );
      } finally {
        if (!closed) {
          controller.close();
        }
      }
    },
    cancel(): void {
      closed = true;
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
