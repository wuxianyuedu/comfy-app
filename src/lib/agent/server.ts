// ── Agent 服务端编排：理解用户意图 → 输出指令（tools 或 JSON 序列）──
// 纯服务端逻辑，不持有工坊前端 React state：
//   • 如果模型支持 OpenAI 兼容 tools → 用 function calling 返回 tool_calls
//   • 不支持 tools → 用「prompt 约束输出 JSON 指令序列」的轻量回退
// 本文件不执行工具 —— 工具执行在浏览器端（工坊 controller 里）。
import "server-only";

import { completeLLM, completeLLMTools, getLLMConfig } from "@/lib/llm/server";
import type { LLMConfig, LLMMessage, LLMTool } from "@/lib/llm/types";

import type { AgentChatRequest, AgentChatResponse } from "./shared";
import {
  parseJsonInstruction,
  formatDraftContext,
  AGENT_SYSTEM_PROMPT,
  AGENT_FALLBACK_SYSTEM_PROMPT,
} from "./prompts";
import { workshopOpenAITools } from "./tools";

/** 把 messages 数组窄化为 LLMMessage 形状并透传 tool_calls / tool_call_id。 */
function narrowMessages(raw: AgentChatRequest["messages"]): LLMMessage[] {
  return raw
    .filter((m) => m && typeof m === "object")
    .map((m) => {
      const role = m.role;
      if (role !== "assistant" && role !== "user" && role !== "system" && role !== "tool") {
        return null;
      }
      const msg: LLMMessage = {
        role,
        content: typeof m.content === "string" ? m.content : "",
      };
      if (role === "assistant" && Array.isArray(m.tool_calls)) {
        msg.tool_calls = m.tool_calls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: {
            name: call.name,
            arguments: call.arguments,
          },
        }));
      }
      if (role === "tool" && typeof m.tool_call_id === "string") {
        msg.tool_call_id = m.tool_call_id;
      }
      return msg;
    })
    .filter((m): m is LLMMessage => m !== null);
}

/** 走 OpenAI 兼容 tools 协议调用模型，返回 content 与 tool_calls。 */
async function callWithTools(
  cfg: LLMConfig,
  messages: LLMMessage[],
  tools: LLMTool[],
): Promise<{ content: string; toolCalls: Array<{ id: string; function: { name: string; arguments: string } }> }> {
  return completeLLMTools(cfg, messages, tools);
}

/** 普通对话调用（不带 tools / response_format）。 */
async function callPlain(cfg: LLMConfig, messages: LLMMessage[]): Promise<string> {
  return completeLLM(cfg, messages);
}

/** 处理一次 Agent 请求：调模型理解意图并返回指令。 */
export async function handleAgentChat(req: AgentChatRequest): Promise<AgentChatResponse> {
  const cfg = await getLLMConfig({ taskType: "chat" });
  const messages = narrowMessages(req.messages);
  const tools = workshopOpenAITools();
  const context = formatDraftContext(req.draft);

  // 构造给模型的系统消息 + 项目状态上下文
  const sysMessages: LLMMessage[] = [
    {
      role: "system",
      content: `${AGENT_SYSTEM_PROMPT}\n\n${context}`,
    },
    ...messages,
  ];

  // 方案 1：OpenAI 兼容 tools 协议
  if (req.useTools !== false) {
    try {
      const { content, toolCalls } = await callWithTools(cfg, sysMessages, tools);
      if (toolCalls.length > 0) {
        return {
          ...(content.trim() ? { reply: content.trim() } : {}),
          tool_calls: toolCalls.map((call) => ({
            id: call.id,
            name: call.function.name,
            arguments: call.function.arguments,
          })),
        };
      }
      if (content.trim()) {
        return { reply: content.trim() };
      }
      // 空回复 → 回退
    } catch {
      // 工具协议失败（模型不支持 / 接口错误）→ 走 JSON 指令序列回退
    }
  }

  // 方案 2：JSON 指令序列回退（lightweight MVP）
  const fallbackMessages: LLMMessage[] = [
    {
      role: "system",
      content: `${AGENT_FALLBACK_SYSTEM_PROMPT}\n\n${context}`,
    },
    ...messages,
  ];
  const content = await callPlain(cfg, fallbackMessages);

  // 从模型输出解析 JSON 指令
  const instruction = parseJsonInstruction(content);
  if (!instruction) {
    return { reply: content.trim() || "抱歉，我暂时无法理解你的意思。", done: true };
  }

  // 指令对象可能是 {reply: ...} / {action: ...} / {done: true, reply: ...}
  const hasReply = typeof instruction.reply === "string";
  const hasAction = typeof instruction.action === "string";
  const validNames = new Set(workshopOpenAITools().map((t) => t.function.name));
  if (hasReply && !hasAction) {
    return { reply: instruction.reply as string };
  }
  if (hasAction && validNames.has(instruction.action as string)) {
    return { fallback_instruction: instruction };
  }
  if (instruction.done === true && hasReply) {
    return { reply: instruction.reply as string, done: true };
  }
  if (hasReply) {
    return { reply: instruction.reply as string };
  }
  return { reply: content.trim() || "我已收到你的请求，但暂时无法处理。", done: true };
}
