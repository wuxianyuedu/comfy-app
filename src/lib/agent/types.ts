// ── Agent 工具的线上协议类型 ─────────────────────────────
// Agent 是「工坊里能指挥完整管线的对话助手」：用户用自然语言描述
// 想要什么，Agent 理解后把目标拆成一步或多步管线操作，逐条执行
// 并把过程与结果回显在浮层面板中。
//
// 工具调用的两层协议（对齐 TAPD 需求）：
//   • 模型支持 OpenAI 兼容 tools（function calling）→ 走标准 tool_calls 字段
//   • 模型不支持（Ollama 旧版 / 部分远端）→ 用「prompt 约束输出 JSON
//     指令序列」的轻量回退，见 agent/prompts.ts
// 纯类型 + 少量纯函数，不依赖 React / 服务端环境，客户端可安全 import。

/** OpenAI 工具定义：把「可执行的管线操作」声明成 function schema。 */
export interface AgentToolSchema {
  name: string;
  description: string;
  /** JSON Schema 对象（OpenAI function calling 的 parameters）。 */
  parameters: Record<string, unknown>;
}

/** LLM 回包中的一个 tool_call。 */
export interface AgentToolCall {
  id: string;
  name: string;
  /** JSON 字符串参数（OpenAI 原样返回的格式）。 */
  arguments: string;
}

/** 一次工具调用的执行结果。 */
export interface AgentToolResult {
  toolCallId: string;
  /** 执行成功：结构化 payload 与可读 summary。 */
  ok: boolean;
  summary: string;
  payload?: Record<string, unknown>;
  error?: string;
}

/** Agent 与用户之间的一轮消息（工具执行后把结果回灌给模型）。 */
export type AgentMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: AgentToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** 一次 Agent 对话的往返结果。 */
export interface AgentChatResult {
  /** 纯文本回复（无工具调用时）。 */
  reply?: string;
  /** 模型请求执行的工具调用（前端逐条执行）。 */
  tool_calls?: AgentToolCall[];
  /** 模型执行完工具后给用户的最终总结（多步 Agent loop 的收尾）。 */
  done?: boolean;
  /** 上次执行的工具结果（已回灌模型）。 */
  tool_results?: AgentToolResult[];
}

/** 从 LLM JSON 回包中安全提取 tool_call 数组。 */
export function parseToolCalls(raw: unknown): AgentToolCall[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentToolCall[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id : "";
    if (!id) continue;
    const fn = typeof rec.function === "object" && rec.function !== null
      ? (rec.function as Record<string, unknown>)
      : null;
    if (!fn) continue;
    const name = typeof fn.name === "string" ? fn.name : "";
    const args = typeof fn.arguments === "string" ? fn.arguments : "";
    if (name) out.push({ id, name, arguments: args });
  }
  return out;
}

/** 把 unknown 消息安全归一成 AgentMessage[]（丢弃无法识别的项）。 */
export function normalizeAgentMessages(raw: unknown): AgentMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentMessage[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const role = rec.role;
    const content = typeof rec.content === "string" ? rec.content : "";
    if (role === "user" || role === "assistant") {
      if (role === "assistant") {
        const calls = parseToolCalls(rec.tool_calls);
        out.push(calls.length > 0 ? { role, content, tool_calls: calls } : { role, content });
      } else {
        out.push({ role, content });
      }
    } else if (role === "tool") {
      const id = typeof rec.tool_call_id === "string" ? rec.tool_call_id : "";
      out.push({ role: "tool", tool_call_id: id, content });
    }
  }
  return out;
}
