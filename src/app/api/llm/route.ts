import { type NextRequest, NextResponse } from "next/server";
import { getLLMConfig, completeLLM, streamLLM } from "@/lib/llm/server";
import { requireServerUser } from "@/lib/auth-server";
import type { LLMMessage, LLMRequestOptions, LLMProviderType } from "@/lib/llm/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** 提取错误信息,等价原 `e?.message ?? fallback`(catch 变量为 unknown 后的窄化版)。 */
function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e) {
    const msg: unknown = e.message;
    if (typeof msg === "string") return msg;
  }
  return fallback;
}

const BodySchema = {
  parse(body: unknown): { messages: LLMMessage[]; stream: boolean; opts: LLMRequestOptions } {
    const rec: Record<string, unknown> = isRecord(body) ? body : {};
    if (!Array.isArray(rec.messages) || rec.messages.length === 0) {
      throw new Error("messages 不能为空");
    }
    const rawMessages: unknown[] = rec.messages;
    const messages: LLMMessage[] = rawMessages.map((m: unknown) => {
      // 逐元素断言为最小形状;null/undefined 元素在属性访问处抛 TypeError → 400,与原 any 版一致。
      const entry = m as { role?: unknown; content?: unknown };
      // 用 unknown 局部变量承接 `??` 结果,避免 String() 落在真值窄化后的 `{}` 类型上。
      const rawContent: unknown = entry.content ?? "";
      return {
        role: entry.role === "assistant" ? "assistant" : entry.role === "user" ? "user" : "system",
        content: String(rawContent),
      };
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
    return { messages, stream: rec.stream === true, opts };
  },
};

export async function POST(req: NextRequest) {
  const user = await requireServerUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "auth.required", message: "未登录或会话已失效" } },
      { status: 401 }
    );
  }

  let parsed: Awaited<ReturnType<typeof BodySchema.parse>>;
  try {
    const body: unknown = await req.json();
    parsed = BodySchema.parse(body);
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e, "请求格式错误") }, { status: 400 });
  }

  const cfg = await getLLMConfig(parsed.opts);

  // ── Non-streaming ──
  if (!parsed.stream) {
    try {
      const content = await completeLLM(cfg, parsed.messages);
      return NextResponse.json({ content });
    } catch (e) {
      return NextResponse.json({ error: errorMessage(e, "LLM 调用失败") }, { status: 502 });
    }
  }

  // ── Streaming (SSE) ──
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await streamLLM(cfg, parsed.messages, (token) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ token })}\n\n`)
          );
        });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (e) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: errorMessage(e, "LLM 调用失败") })}\n\n`)
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
