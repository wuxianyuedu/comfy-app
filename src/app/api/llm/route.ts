/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { type NextRequest, NextResponse } from "next/server";
import { getLLMConfig, completeLLM, streamLLM } from "@/lib/llm/server";
import { requireServerUser } from "@/lib/auth-server";
import type { LLMMessage, LLMRequestOptions, LLMProviderType } from "@/lib/llm/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = {
  parse(body: any): { messages: LLMMessage[]; stream: boolean; opts: LLMRequestOptions } {
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      throw new Error("messages 不能为空");
    }
    const messages: LLMMessage[] = body.messages.map((m: any) => ({
      role: m.role === "assistant" ? "assistant" : m.role === "user" ? "user" : "system",
      content: String(m.content ?? ""),
    }));
    const opts: LLMRequestOptions = {};
    if (body.provider) opts.provider = body.provider as LLMProviderType;
    if (body.model) opts.model = String(body.model);
    if (typeof body.temperature === "number") opts.temperature = body.temperature;
    if (typeof body.maxTokens === "number") opts.maxTokens = body.maxTokens;
    return { messages, stream: body.stream === true, opts };
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
    const body = await req.json();
    parsed = BodySchema.parse(body);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "请求格式错误" }, { status: 400 });
  }

  const cfg = await getLLMConfig(parsed.opts);

  // ── Non-streaming ──
  if (!parsed.stream) {
    try {
      const content = await completeLLM(cfg, parsed.messages);
      return NextResponse.json({ content });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? "LLM 调用失败" }, { status: 502 });
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
      } catch (e: any) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: e?.message ?? "LLM 调用失败" })}\n\n`)
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
