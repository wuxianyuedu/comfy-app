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
import { FullScreenLayer } from "~/components/studio/fullscreen/FullScreenLayer";

const KIND_META: Record<
  string,
  { icon: typeof Bell; tint: string; ring: string }
> = {
  update: {
    icon: RefreshCw,
    tint: "text-violet-700 bg-violet-500/15 dark:text-violet-300",
    ring: "border-violet-500/25",
  },
  restart: {
    icon: RotateCcw,
    tint: "text-amber-700 bg-amber-500/15 dark:text-amber-300",
    ring: "border-amber-500/25",
  },
  info: {
    icon: Bell,
    tint: "text-cyan-700 bg-cyan-500/15 dark:text-cyan-300",
    ring: "border-cyan-500/25",
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
    <FullScreenLayer
      zClass="z-[10020]"
      className="bg-bg/92 flex flex-col backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="消息中心"
    >
      {/* 顶栏 */}
      <header className="border-border-strong flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <div className="flex items-center gap-2">
          <span className="relative">
            <BellRing
              size={16}
              className="text-violet-700 dark:text-violet-300"
            />
            {unread > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-violet-500 px-0.5 text-[9px] font-bold text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </span>
          <span className="text-ink-bright text-[15px] font-semibold">
            消息中心
          </span>
          <span className="text-ink-muted text-[12px]">
            {messages.length ? `${messages.length} 条 · ${unread} 条未读` : "暂无消息"}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={markAllRead}
            disabled={unread === 0}
            className="text-ink-soft hover:bg-subtle hover:text-ink flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          >
            <CheckCheck size={14} />
            全部已读
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={messages.length === 0}
            className="text-ink-soft flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] transition-colors hover:bg-rose-500/10 hover:text-rose-800 dark:text-rose-300 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:text-rose-300"
          >
            <Trash2 size={14} />
            清空
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-ink-soft hover:bg-subtle hover:text-ink ml-1 rounded-md p-2 transition-colors"
            aria-label="关闭消息中心"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/* 消息列表 */}
      <div className="custom-scrollbar flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="text-ink-fainter flex h-full flex-col items-center justify-center gap-3">
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
                  className={`bg-subtle/60 hover:bg-subtle cursor-pointer rounded-xl border p-3.5 transition-colors ${
                    m.read ? "border-border-subtle opacity-70" : `${meta.ring} border`
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
                        <h3 className="text-ink-bright text-[13px] font-semibold">
                          {m.title}
                        </h3>
                        {!m.read && (
                          <span className="rounded-full bg-violet-500/20 px-1.5 text-[10px] font-medium text-violet-700 dark:text-violet-300">
                            新
                          </span>
                        )}
                        <time className="text-ink-muted ml-auto shrink-0 text-[11px] tabular-nums">
                          {fmtTime(m.time)}
                        </time>
                      </div>
                      <p className="text-ink-soft mt-1 text-[12.5px] leading-relaxed break-words whitespace-pre-wrap">
                        {m.body}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(m.id);
                      }}
                      className="text-ink-fainter hover:bg-subtle hover:text-ink-soft shrink-0 rounded p-1 transition-colors"
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

      <footer className="border-border-strong text-ink-muted flex h-9 shrink-0 items-center justify-between border-t px-4 text-[11px]">
        <span>底部状态栏铃铛实时汇总未读消息，点此可全屏查看。</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="bg-subtle text-ink-soft hover:bg-surface-2 hover:text-ink rounded px-2 py-0.5 transition-colors"
        >
          关闭 (Esc)
        </button>
      </footer>
    </FullScreenLayer>
  );
}
