// ── Agent 浏览器端 API 客户端 ─────────────────────────────
// 视图层不直接 fetch —— 组件把消息 + 项目快照交给本模块，
// 由它发起 POST /api/agent/chat 并解析返回结构。
import { readApiError, readJsonBody } from "~/lib/api-error";
import { isRecord } from "~/lib/is-record";
import type { AgentChatRequest, AgentChatResponse } from "./shared";

/** 向 Agent 服务端发送一轮消息，返回响应（reply / tool_calls / fallback）。 */
export async function sendAgentMessage(
  req: AgentChatRequest,
): Promise<AgentChatResponse> {
  let res: Response;
  try {
    res = await fetch("/api/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
  } catch {
    throw new Error("无法连接服务器");
  }
  /* 错误信封的读法收在一处（规范 16 §16.2.4.35）：这里此前只认
   * `{error:{message}}`，服务端回 `{error: "…"}` 时会被读成「请求失败」。 */
  const data: unknown = await readJsonBody(res);
  if (!res.ok) throw new Error(readApiError(data) ?? "请求失败");
  return parseAgentResponse(data);
}

function parseAgentResponse(data: unknown): AgentChatResponse {
  if (!isRecord(data)) return { reply: "（无有效响应）", done: true };
  const result: AgentChatResponse = {};
  if (typeof data.reply === "string") result.reply = data.reply;
  if (Array.isArray(data.tool_calls)) {
    result.tool_calls = data.tool_calls
      .filter(isRecord)
      .filter(
        (call) =>
          typeof call.id === "string" &&
          typeof call.name === "string" &&
          call.id !== "",
      )
      .map((call) => ({
        id: call.id as string,
        name: call.name as string,
        arguments: typeof call.arguments === "string" ? call.arguments : "{}",
      }));
  }
  if (data.done === true) result.done = true;
  if (isRecord(data.fallback_instruction)) {
    result.fallback_instruction = data.fallback_instruction;
  }
  return result;
}
