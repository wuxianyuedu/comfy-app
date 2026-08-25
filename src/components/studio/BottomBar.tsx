"use client";

import React, { useState, useRef, useCallback } from "react";
import { DarkSelect } from "@/components/studio/ui/DarkSelect";

/* ── Updream-style Bottom Bar ────────────────────────────
  Fixed bottom bar with:
  - Optional timeline strip (collapsible)
  - Agent mode dropdown / Ask mode dropdown
  - Text input with send button
*/

export interface BottomBarProps {
  /** Placeholder text */
  placeholder?: string;
  /** On send callback */
  onSend?: (text: string) => void;
  /** Whether streaming is in progress */
  loading?: boolean;
  /** Agent mode options */
  agentModes?: string[];
  /** Current agent mode */
  agentMode?: string;
  /** On agent mode change */
  onAgentModeChange?: (mode: string) => void;
  /** Ask mode options */
  askModes?: string[];
  /** Current ask mode */
  askMode?: string;
  /** On ask mode change */
  onAskModeChange?: (mode: string) => void;
  /** Timeline nodes (optional) */
  timelineNodes?: Array<{ id: string; label: string; active?: boolean }>;
  /** Extra left content */
  leftContent?: React.ReactNode;
}

export function BottomBar({
  placeholder = "描述你的需求，或直接拖入素材…",
  onSend,
  loading = false,
  agentModes = ["Agent模式"],
  agentMode = "Agent模式",
  onAgentModeChange,
  askModes = ["询问"],
  askMode = "询问",
  onAskModeChange,
  timelineNodes,
  leftContent,
}: BottomBarProps) {
  const [text, setText] = useState("");
  const [timelineOpen, setTimelineOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    onSend?.(trimmed);
    setText("");
  }, [text, loading, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // Auto-resize textarea
  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      const el = e.target;
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 120) + "px";
    },
    []
  );

  return (
    <div className="flex flex-col">
      {/* Timeline strip (collapsible) */}
      {timelineNodes && timelineNodes.length > 0 && (
        <div className="border-b border-white/5 px-4 py-1.5">
          <button
            type="button"
            onClick={() => setTimelineOpen(!timelineOpen)}
            className="mb-1 flex items-center gap-1 text-xs text-gray-500 transition-colors hover:text-gray-300"
          >
            <span className={`transition-transform ${timelineOpen ? "rotate-90" : ""}`}>▶</span>
            时间线
          </button>
          {timelineOpen && (
            <div className="flex gap-1 overflow-x-auto pb-1">
              {timelineNodes.map((node) => (
                <span
                  key={node.id}
                  className={`shrink-0 rounded px-2 py-0.5 text-xs ${
                    node.active
                      ? "bg-violet-500/20 text-violet-300"
                      : "bg-white/5 text-gray-500"
                  }`}
                >
                  {node.label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Input row */}
      <div className="flex items-end gap-2 px-4 py-2.5">
        {/* Left content (e.g., template icons) */}
        {leftContent}

        {/* Dropdowns */}
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Agent Mode */}
          <DropdownSelect
            value={agentMode}
            options={agentModes}
            onChange={onAgentModeChange}
            icon={
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            }
          />

          {/* Ask Mode */}
          <DropdownSelect
            value={askMode}
            options={askModes}
            onChange={onAskModeChange}
            icon={
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
            }
          />
        </div>

        {/* Textarea */}
        <div className="relative min-w-0 flex-1">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            className="w-full resize-none rounded-xl border border-white/8 bg-white/[0.04] px-4 py-2.5 pr-11 text-sm text-gray-200 outline-none placeholder:text-gray-600 transition-colors focus:border-violet-500/40 focus:bg-white/[0.06]"
          />
          {/* Send button */}
          <button
            type="button"
            onClick={handleSend}
            disabled={!text.trim() || loading}
            className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-lg bg-white text-gray-900 transition-all hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="发送"
          >
            {loading ? (
              <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2v4m0 12v4m-8-10H2m20 0h-4" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14m-7-7l7 7-7 7" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Small dropdown select ─────────────────────────── */

function DropdownSelect({
  value,
  options,
  onChange,
  icon,
}: {
  value: string;
  options: string[];
  onChange?: (v: string) => void;
  icon: React.ReactNode;
}) {
  if (options.length <= 1 && !onChange) {
    return (
      <span className="flex items-center gap-1 rounded-lg border border-white/8 bg-white/[0.03] px-2 py-1.5 text-xs text-gray-400">
        {icon} {value}
      </span>
    );
  }

  return (
    <div className="relative">
      <DarkSelect
        className="appearance-none py-1.5 pr-5 text-xs"
        value={value}
        onChange={(value) => onChange?.(value)}
        options={options}
        placeholder="选择…"
      />
      <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-500">
        {icon}
      </span>
    </div>
  );
}
