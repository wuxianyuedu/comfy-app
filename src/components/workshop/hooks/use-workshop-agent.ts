"use client";

// ── 工坊 Agent 指挥助手：逻辑层 hook ─────────────────────
// 状态：对话消息、输入、busy、错误、工具执行日志
// 职责：
//   1. 把用户消息 + 当前项目快照发给服务端 /api/agent/chat
//   2. 收到 tool_calls 后在本模块里逐条执行（调用 controller 回调）
//   3. 把工具结果回灌模型，继续循环直至模型直接回复用户
// 视图层（AgentOverlay.tsx）只消费本 hook 返回的 controller。
import React from "react";
import { sendAgentMessage } from "@/lib/agent/client";
import type { AgentMessageLike, AgentChatResponse } from "@/lib/agent/shared";
import { resolveAgentTool, type AgentToolHandlers } from "@/lib/agent/executor";

export type { AgentToolHandlers };

/** 一条工具执行记录（Agent 浮层「工作过程」面板的展示数据）。 */
export interface AgentToolRun {
  id: string;
  toolName: string;
  status: "running" | "done" | "error";
  summary: string;
  argSummary: string;
  detail?: string;
}

/** Agent 一帧对话消息（用户 / 助手 / 工具记录）。 */
export type AgentPanelMessage =
  | { id: string; role: "user" | "assistant"; content: string }
  | { id: string; role: "tool-run"; run: AgentToolRun };

/** 工坊 Agent 需要调用 controller 的操作（由 WorkshopPipeline 注入）。 */
export type WorkshopAgentToolHandlers = AgentToolHandlers;

/** Agent hook 返回给视图的 controller。 */
export interface WorkshopAgentController {
  open: boolean;
  messages: AgentPanelMessage[];
  input: string;
  busy: boolean;
  error: string;
  toolRuns: AgentToolRun[];
  openAgent: () => void;
  closeAgent: () => void;
  setInput: (value: string) => void;
  send: () => Promise<void>;
  clearToolRuns: () => void;
}

let _agentMsgId = 0;
function agentMsgId(): string {
  _agentMsgId += 1;
  return `agent-msg-${Date.now().toString(36)}-${_agentMsgId}`;
}

let _toolRunId = 0;
function toolRunId(): string {
  _toolRunId += 1;
  return `tool-run-${Date.now().toString(36)}-${_toolRunId}`;
}

export function useWorkshopAgent(
  handlers: WorkshopAgentToolHandlers,
): WorkshopAgentController {
  const [open, setOpen] = React.useState(false);
  const [messages, setMessages] = React.useState<AgentPanelMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [toolRuns, setToolRuns] = React.useState<AgentToolRun[]>([]);

  const handlersRef = React.useRef(handlers);
  // 与 messagesRef 同理：ref 同步放进 effect，渲染期写 ref 会触发
  // react-hooks/refs，且并发渲染下可能落到被丢弃的那次渲染上。
  React.useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const messagesRef = React.useRef<AgentPanelMessage[]>([]);
  React.useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const pushMsg = React.useCallback((msg: AgentPanelMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const pushToolRun = React.useCallback((run: AgentToolRun) => {
    setToolRuns((prev) => [...prev, run]);
    setMessages((prev) => [...prev, { id: run.id, role: "tool-run", run }]);
  }, []);

  const patchToolRun = React.useCallback(
    (id: string, patch: Partial<AgentToolRun>) => {
      setToolRuns((prev) =>
        prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      );
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id && m.role === "tool-run"
            ? { ...m, run: { ...m.run, ...patch } }
            : m,
        ),
      );
    },
    [],
  );

  /** 把工具调用解析并执行（纯逻辑经 executor 模块）。 */
  const executeOneTool = React.useCallback(
    async (call: { id: string; name: string; arguments: string }) => {
      const runId = toolRunId();
      const tool = resolveAgentTool(
        call.name,
        call.arguments,
        handlersRef.current,
      );
      const run: AgentToolRun = {
        id: runId,
        toolName: call.name,
        status: "running",
        summary: tool.summary,
        argSummary: tool.argSummary,
      };
      pushToolRun(run);
      try {
        const result = await tool.execute();
        patchToolRun(runId, {
          status: result.ok ? "done" : "error",
          detail: result.detail,
        });
        return {
          role: "tool" as const,
          tool_call_id: call.id,
          content: JSON.stringify({
            ok: result.ok,
            summary: result.summary,
            ...(result.detail ? { detail: result.detail } : {}),
          }),
        } satisfies AgentMessageLike;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "工具执行失败";
        patchToolRun(runId, { status: "error", detail: msg });
        return {
          role: "tool" as const,
          tool_call_id: call.id,
          content: JSON.stringify({ ok: false, error: msg }),
        } satisfies AgentMessageLike;
      }
    },
    [pushToolRun, patchToolRun],
  );

  /** 核心 send：把用户消息送入 Agent 循环直至模型回复。 */
  const send = React.useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;

    setInput("");
    setError("");
    setBusy(true);
    const userMsg: AgentPanelMessage = {
      id: agentMsgId(),
      role: "user",
      content: text,
    };
    pushMsg(userMsg);

    const wireOf = (): AgentMessageLike[] =>
      [...messagesRef.current, userMsg]
        .filter((m) => m.role !== "tool-run")
        .map((m) => ({ role: m.role, content: m.content }));

    try {
      let currentMessages: AgentMessageLike[] = wireOf();
      const maxRounds = 10;

      for (let round = 0; round < maxRounds; round++) {
        const response: AgentChatResponse = await sendAgentMessage({
          messages: currentMessages,
          draft: handlersRef.current.getDraft(),
        });

        // 纯文本回复（无工具调用）→ 结束本轮
        if (
          response.reply &&
          !(response.tool_calls && response.tool_calls.length > 0)
        ) {
          pushMsg({
            id: agentMsgId(),
            role: "assistant",
            content: response.reply,
          });
          break;
        }

        // 有 tool_calls：把说明文字与 tool_calls 放进同一条 assistant 消息，
        // 逐一执行后再把结果以 tool 消息回灌给模型（OpenAI 协议要求）。
        if (response.tool_calls && response.tool_calls.length > 0) {
          const replyText = response.reply ?? "";
          if (replyText) {
            pushMsg({
              id: agentMsgId(),
              role: "assistant",
              content: replyText,
            });
          }
          currentMessages = [
            ...currentMessages,
            {
              role: "assistant",
              content: replyText,
              tool_calls: response.tool_calls,
            } satisfies AgentMessageLike,
          ];
          const toolMessages: AgentMessageLike[] = [];
          for (const call of response.tool_calls) {
            const toolMsg = await executeOneTool(call);
            toolMessages.push(toolMsg);
          }
          currentMessages = [...currentMessages, ...toolMessages];
          continue;
        }

        // 回退指令
        if (response.fallback_instruction) {
          const instr = response.fallback_instruction;
          const action = typeof instr.action === "string" ? instr.action : "";
          const toolMsg = await executeOneTool({
            id: `fallback-${toolRunId()}`,
            name: action,
            arguments: JSON.stringify(instr),
          });
          currentMessages = [
            ...currentMessages,
            { role: "assistant", content: `执行了 ${action} 操作` },
            toolMsg,
          ];
          continue;
        }

        if (round === 0) {
          pushMsg({
            id: agentMsgId(),
            role: "assistant",
            content: "（模型未返回有效响应，请重试）",
          });
        }
        break;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "与 Agent 通信失败";
      setError(msg);
      pushMsg({
        id: agentMsgId(),
        role: "assistant",
        content: `抱歉，出错了：${msg}`,
      });
    } finally {
      setBusy(false);
    }
  }, [input, busy, pushMsg, executeOneTool]);

  const openAgent = React.useCallback(() => setOpen(true), []);
  const closeAgent = React.useCallback(() => setOpen(false), []);
  const clearToolRuns = React.useCallback(() => {
    setToolRuns([]);
    setMessages((prev) => prev.filter((m) => m.role !== "tool-run"));
  }, []);

  return {
    open,
    messages,
    input,
    busy,
    error,
    toolRuns,
    openAgent,
    closeAgent,
    setInput,
    send,
    clearToolRuns,
  };
}
