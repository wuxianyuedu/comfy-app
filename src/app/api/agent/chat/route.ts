// POST /api/agent/chat — Agent 对话推理入口：接收用户消息 + 项目快照，服务端理解意图后返回
// 模型纯文本回复 / tool_calls 列表（前端执行后再回灌）/ 模型不支持 tools 时的 JSON 指令序列回退。
// 鉴权沿用 requireRequestUser（单机本地演示可回落默认用户）。

import { type NextRequest, NextResponse } from "next/server";
import { requireRequestUser } from "~/server/auth/request-user";
import { handleAgentChat } from "~/lib/agent/server";
import { parseDraftDto } from "~/lib/workshop/draft-sync-shared";
import { isErrorResponse, readJsonRecord } from "~/server/lib/request-body";
import type { AgentChatRequest, AgentMessageLike } from "~/lib/agent/shared";
import { apiErrorBody } from "~/lib/api-error";
import { unauthorizedResponse } from "~/server/lib/error-response";
import { isRecord } from "~/lib/is-record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AgentToolCall = { arguments: string; id: string; name: string };

function isAgentToolCall(v: unknown): v is AgentToolCall {
  return (
    isRecord(v) &&
    typeof v.arguments === "string" &&
    typeof v.id === "string" &&
    typeof v.name === "string"
  );
}

function isAgentMessageLike(v: unknown): v is AgentMessageLike {
  if (!isRecord(v) || typeof v.content !== "string") {
    return false;
  }
  if (v.role === "user") {
    return true;
  }
  if (v.role === "tool") {
    return typeof v.tool_call_id === "string";
  }
  if (v.role === "assistant") {
    const toolCalls = v.tool_calls;
    return (
      toolCalls === undefined || (Array.isArray(toolCalls) && toolCalls.every(isAgentToolCall))
    );
  }
  return false;
}

export async function POST(req: NextRequest) {
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const body = await readJsonRecord(req);
  if (isErrorResponse(body)) {
    return body;
  }

  const rawMessages: Array<AgentMessageLike> = Array.isArray(body.messages)
    ? body.messages.filter(isAgentMessageLike)
    : [];
  if (rawMessages.length === 0) {
    return NextResponse.json({ error: "messages 不能为空" }, { status: 400 });
  }

  const request: AgentChatRequest = {
    messages: rawMessages,
    draft: parseDraftDto(body.draft),
    useTools: body.useTools !== false,
  };

  try {
    const result = await handleAgentChat(request);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(apiErrorBody(error, "Agent 处理请求失败"), {
      status: 502,
    });
  }
}
