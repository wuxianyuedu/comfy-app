// ── Agent 模块的共享线上协议类型 ─────────────────────────
// 同时被服务端 handler（server.ts）、客户端 client.ts 引用，
// 保证两端只对齐一份契约。纯类型，无副作用。
import type { WorkshopDraftDto } from "@/lib/workshop/draft-sync-shared";

/** Agent 对话中的消息类型（与服务端/浏览器共享）。 */
export type AgentMessageLike =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      tool_calls?: Array<{ id: string; name: string; arguments: string }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

/** 客户端 → 服务端的 Agent 请求体。 */
export interface AgentChatRequest {
  messages: AgentMessageLike[];
  draft: WorkshopDraftDto;
  useTools?: boolean;
}

/** 服务端返回给客户端的 Agent 响应。 */
export interface AgentChatResponse {
  reply?: string;
  tool_calls?: Array<{ id: string; name: string; arguments: string }>;
  done?: boolean;
  fallback_instruction?: Record<string, unknown>;
}
