"use client";

/* ── 消息中心：全屏查看「只看一次就消失」的系统级提示 ─────────────
 * 仅做展示：从共享 store 读 open / messages，把每个消息（更新需重启、
 * dev server 重启等）展开成全屏可读列表。业务规则（谁 push、去重）在
 * 生产方，本组件不 import 逻辑/网络（规范 17 第③层视图）。
 */

import { useEffect, useMemo } from "react";
import {
  Bell,
  BellRing,
  CheckCheck,
  Inbox,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";

import { useMessageCenterStore } from "./message-center-store";

const KIND_META: Record<
  string,
  { icon: typeof Bell; tint: string; ring: string }
> = {
  update: {
    icon: RefreshCw,
    tint: "text-violet-300 bg-violet-500/15",
    ring: "border-violet-500/20",
  },
  restart: {
    icon: RotateCcw,
    tint: "text-amber-300 bg-amber-500/15",
    ring: "border-amber-500/20",
  },
  info: {
    icon: Bell,
    tint: "text-cyan-300 bg-cyan-500/15",
    ring: "border-cyan-500/20",
  },
};

function fmtTime(t: number): string {
  const d = new Date(t);
  return d.toLocaleString("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function MessageCenterPanel() {
  const open = useMessageCenterStore((s) => s.open);
  const messages = useMessageCenterStore((s) => s.messages);
  const setOpen = useMessageCenterStore((s) => s.setOpen);
  const markAllRead = useMessageCenterStore((s) => s.markAllRead);
  const markRead = useMessageCenterStore((s) => s.markRead);
  const remove = useMessageCenterStore((s) => s.remove);
  const clear = useMessageCenterStore((s) => s.clear);

  const unread = useMemo(
    () => messages.reduce((n, m) => n + (m.read ? 0 : 1), 0),
    [messages],
  );

  // Esc 关闭全屏面板
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[10020] flex flex-col bg-[#0a0a0f]/92 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="消息中心"
    >
      {/* 顶栏 */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-white/6 px-4">
        <div className="flex items-center gap-2">
          <span className="relative">
            <BellRing size={16} className="text-violet-300" />
            {unread > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-violet-500 px-0.5 text-[9px] font-bold text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </span>
          <span className="text-[15px] font-semibold text-gray-100">消息中心</span>
          <span className="text-[12px] text-gray-500">
            {messages.length ? `${messages.length} 条 · ${unread} 条未读` : "暂无消息"}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={markAllRead}
            disabled={unread === 0}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-gray-400 transition-colors hover:bg-white/5 hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <CheckCheck size={14} />
            全部已读
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={messages.length === 0}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-gray-400 transition-colors hover:bg-rose-500/10 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 size={14} />
            清空
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ml-1 rounded-md p-2 text-gray-400 transition-colors hover:bg-white/5 hover:text-gray-200"
            aria-label="关闭消息中心"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/* 消息列表 */}
      <div className="custom-scrollbar flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-600">
            <Inbox size={44} strokeWidth={1.2} className="opacity-30" />
            <p className="text-[13px]">暂无系统消息</p>
          </div>
        ) : (
          <ul className="mx-auto flex w-full max-w-3xl flex-col gap-2.5 px-4 py-5">
            {messages.map((m) => {
              const meta = KIND_META[m.kind] ?? KIND_META.info!;
              const Icon = meta.icon;
              return (
                <li
                  key={m.id}
                  onClick={() => markRead(m.id)}
                  className={`cursor-pointer rounded-xl border bg-white/2 p-3.5 transition-colors hover:bg-white/5 ${
                    m.read ? "border-white/5 opacity-70" : `${meta.ring} border`
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${meta.tint}`}
                    >
                      <Icon size={14} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <h3 className="text-[13px] font-semibold text-gray-100">
                          {m.title}
                        </h3>
                        {!m.read && (
                          <span className="rounded-full bg-violet-500/20 px-1.5 text-[10px] font-medium text-violet-300">
                            新
                          </span>
                        )}
                        <time className="ml-auto shrink-0 text-[11px] text-gray-500 tabular-nums">
                          {fmtTime(m.time)}
                        </time>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-gray-300">
                        {m.body}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(m.id);
                      }}
                      className="shrink-0 rounded p-1 text-gray-600 transition-colors hover:bg-white/5 hover:text-gray-300"
                      aria-label="删除该消息"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="flex h-9 shrink-0 items-center justify-between border-t border-white/6 px-4 text-[11px] text-gray-500">
        <span>底部状态栏铃铛实时汇总未读消息，点此可全屏查看。</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded bg-white/5 px-2 py-0.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-gray-200"
        >
          关闭 (Esc)
        </button>
      </footer>
    </div>
  );
}
