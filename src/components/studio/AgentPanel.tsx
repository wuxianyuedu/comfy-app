"use client";

import { Icon } from "@/components/ui/icon";

/* ── Agent Panel (Left slide-out or embedded) ───────────
  Task list per agent + empty state.
  Matches studio.cn agent panel style.
*/

export interface AgentTask {
  id: string;
  status: "pending" | "running" | "done" | "error";
  label: string;
  /** Reserved for multi-agent views; not rendered by the panel itself. */
  agentName?: string;
}

const STATUS_MAP: Record<AgentTask["status"], { dot: string; color: string; label: string }> = {
  pending: { dot: "bg-gray-600", color: "text-gray-500", label: "待开始" },
  running: { dot: "animate-pulse bg-amber-400", color: "text-amber-400", label: "运行中" },
  done: { dot: "bg-emerald-400", color: "text-emerald-400", label: "已完成" },
  error: { dot: "bg-red-400", color: "text-red-400", label: "错误" },
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
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? "A";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/6 px-4 py-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-linear-to-br from-violet-500 to-fuchsia-500 text-[10px] font-bold text-white">
          {initial}
        </span>
        <h3 className="u-title">{name}</h3>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto p-3">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/3 text-gray-600">
              <Icon name="smile" size={22} strokeWidth={1.5} />
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
                  disabled={!onTaskClick}
                  onClick={() => onTaskClick?.(task)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors enabled:hover:bg-white/4"
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${st.dot}`} />
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
      </div>

      {/* Footer: keep the add action reachable without scrolling */}
      {onAddTask && (
        <div className="shrink-0 border-t border-white/6 px-3 py-3">
          <button
            type="button"
            onClick={onAddTask}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-white/10 text-gray-500 transition-colors hover:border-violet-500/30 hover:text-violet-300"
            aria-label="添加任务"
          >
            <Icon name="plus" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
