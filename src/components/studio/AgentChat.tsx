"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { chatAgent, type ChatMessage, type AgentSpec } from "@/lib/agent/agentic";
import { Icon } from "@/components/ui/icon";

/* ── AgentChat — multi-turn creation guidance overlay ──
  A floating chat panel where the user refines an idea with the AI assistant
  across several turns. Once the assistant decides the spec is ready, a
  "去生成" card appears that hands the structured spec back to the workspace.
*/

const GREETING = "我是你的 AI 创作助手，告诉我你想做什么，我会一步步帮你理清需求并生成。";

export interface AgentChatProps {
  open: boolean;
  onClose: () => void;
  /** If omitted, the "去生成" action is hidden (legacy create panel is removed). */
  onApply?: (spec: AgentSpec) => void;
}

export function AgentChat({ open, onClose, onApply }: AgentChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingSpec, setPendingSpec] = useState<AgentSpec | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Greeting is derived: shown as long as the panel is open and the user has
  // not sent anything yet — no effect-driven state seeding needed.
  const visibleMessages = useMemo<ChatMessage[]>(() => {
    if (open && messages.length === 0) {
      return [{ role: "assistant", content: GREETING }];
    }
    return messages;
  }, [open, messages]);

  // Keep the message list scrolled to the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, pendingSpec, loading]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    const next: ChatMessage[] = [...visibleMessages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await chatAgent(next);
      setMessages((messages) => [...messages, { role: "assistant", content: res.reply }]);
      if (res.ready && res.spec) setPendingSpec(res.spec);
    } catch {
      setMessages((messages) => [...messages, { role: "assistant", content: "抱歉，出错了，请重试。" }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, visibleMessages]);

  if (!open) return null;

  return (
    <div className="fixed bottom-8 right-4 z-40 flex h-[540px] w-[380px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-(--color-panel-deep)/95 shadow-2xl backdrop-blur-xl">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/8 px-4 py-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-linear-to-br from-violet-500 to-fuchsia-500 text-[11px] font-bold text-white">
          <Icon name="sparkles" size={13} className="text-white" />
        </span>
        <h3 className="u-title flex-1">AI 创作引导</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-500 transition-colors hover:text-gray-200"
          aria-label="关闭"
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {visibleMessages.map((msg, index) => (
          <div key={`msg-${index}`} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[82%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
                msg.role === "user"
                  ? "bg-violet-500/90 text-white"
                  : "bg-white/6 text-gray-200"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-white/6 px-3 py-2.5">
              <span className="inline-flex gap-1">
                <Dot />
                <Dot d={0.2} />
                <Dot d={0.4} />
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Ready card */}
      {pendingSpec && (
        <div className="mx-4 mb-2 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2.5">
          <p className="mb-1 text-[12px] text-violet-200">
            已为你准备好{pendingSpec.kind === "video" ? "视频" : "图片"}方案
          </p>
          <p
            className="mb-2 text-[11px] leading-snug text-gray-400"
            style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
          >
            {pendingSpec.prompt}
          </p>
          <div className="flex gap-2">
            {onApply ? (
              <button
                type="button"
                onClick={() => {
                  onApply(pendingSpec);
                  setPendingSpec(null);
                  onClose();
                }}
                className="flex-1 rounded-lg bg-violet-500 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-violet-400"
              >
                去生成
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setPendingSpec(null)}
              className={`rounded-lg border border-white/10 px-3 py-1.5 text-[12px] text-gray-300 transition-colors hover:bg-white/5 ${onApply ? "" : "flex-1"}`}
            >
              继续聊
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-white/8 p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={taRef}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              event.target.style.height = "auto";
              event.target.style.height = Math.min(event.target.scrollHeight, 90) + "px";
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="描述你的想法，或回答助手的问题…"
            className="min-w-0 flex-1 resize-none rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-[13px] text-gray-200 outline-none placeholder:text-gray-600 focus:border-violet-500/40"
          />
          <button
            type="button"
            onClick={send}
            disabled={!input.trim() || loading}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-gray-900 transition-all hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="发送"
          >
            {loading ? <Spinner /> : <Arrow />}
          </button>
        </div>
      </div>
    </div>
  );
}

function Dot({ d = 0 }: { d?: number }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400"
      style={{ animationDelay: `${d}s` }}
    />
  );
}

function Spinner() {
  return (
    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M12 2v4m0 12v4m-8-10H2m20 0h-4" />
    </svg>
  );
}

function Arrow() {
  return <ArrowRight size={14} strokeWidth={2.5} />;
}
