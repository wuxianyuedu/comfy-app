"use client";

import React from "react";
import type { Character } from "@/lib/workshop/types";

/* ── Agent Panel (Left slide-out or embedded) ───────────
  Task list per agent + empty state.
  Matches updream.cn agent panel style.
*/

export interface AgentTask {
  id: string;
  status: "pending" | "running" | "done" | "error";
  label: string;
  agentName?: string;
}

const STATUS_MAP: Record<AgentTask["status"], { color: string; label: string }> = {
  pending: { color: "text-gray-500", label: "待开始" },
  running: { color: "text-amber-400", label: "运行中" },
  done: { color: "text-emerald-400", label: "已完成" },
  error: { color: "text-red-400", label: "错误" },
};

export interface AgentPanelProps {
  /** Agent name */
  name?: string;
  /** Tasks for this agent */
  tasks?: AgentTask[];
  /** On task click */
  onTaskClick?: (task: AgentTask) => void;
  /** On add task */
  onAddTask?: () => void;
}

export function AgentPanel({
  name = "Agent",
  tasks = [],
  onTaskClick,
  onAddTask,
}: AgentPanelProps) {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/6 px-4 py-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-[10px] font-bold text-white">
          {name[0]}
        </span>
        <h3 className="u-title">{name}</h3>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto p-3">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.03] text-gray-600">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                <line x1="9" y1="9" x2="9.01" y2="9" />
                <line x1="15" y1="9" x2="15.01" y2="9" />
              </svg>
            </div>
            <p className="text-xs text-gray-600">添加技能给我任务</p>
            <p className="mt-1 text-[11px] text-gray-700">:: 无任务</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {tasks.map((task) => {
              const st = STATUS_MAP[task.status];
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onTaskClick?.(task)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04]"
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${task.status === "running" ? "animate-pulse bg-amber-400" : task.status === "done" ? "bg-emerald-400" : task.status === "error" ? "bg-red-400" : "bg-gray-600"}`} />
                  <span className="min-w-0 flex-1 truncate text-xs text-gray-300">
                    {task.label}
                  </span>
                  <span className={`shrink-0 text-[11px] ${st.color}`}>
                    {st.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Add button */}
        {onAddTask && (
          <button
            type="button"
            onClick={onAddTask}
            className="mt-3 flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-white/10 text-gray-500 transition-colors hover:border-violet-500/30 hover:text-violet-300"
            aria-label="添加任务"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
