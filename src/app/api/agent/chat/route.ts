// POST /api/agent/chat — Agent 对话推理入口。
// 接收用户消息 + 当前项目快照，服务端理解意图后返回：
//   • 模型纯文本回复（无工具调用）
//   • tool_calls 列表（前端执行后再回灌）
//   • JSON 指令序列回退（模型不支持 tools 时）
// 鉴权沿用 requireServerUser（单机本地演示可回落默认用户）。

import { NextRequest, NextResponse } from "next/server";
import { requireServerUser } from "@/lib/auth-server";
import { handleAgentChat } from "@/lib/agent/server";
import { parseDraftDto } from "@/lib/workshop/draft-sync-shared";
import { isRecord } from "@/lib/workshop/api-channel-shared";
import type { AgentChatRequest } from "@/lib/agent/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e) {
    const msg: unknown = (e as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
  }
  return fallback;
}

export async function POST(req: NextRequest) {
  const user = await requireServerUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "auth.required", message: "未登录或会话已失效" } },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  if (!isRecord(body)) {
    return NextResponse.json({ error: "请求体必须是对象" }, { status: 400 });
  }

  const rawMessages = Array.isArray(body.messages)
    ? (body.messages as Array<Record<string, unknown>>)
    : [];
  if (rawMessages.length === 0) {
    return NextResponse.json({ error: "messages 不能为空" }, { status: 400 });
  }

  const request: AgentChatRequest = {
    messages: rawMessages as AgentChatRequest["messages"],
    draft: parseDraftDto(body.draft),
    useTools: body.useTools !== false,
  };

  try {
    const result = await handleAgentChat(request);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: errorMessage(e, "Agent 处理请求失败") },
      { status: 502 },
    );
  }
}
