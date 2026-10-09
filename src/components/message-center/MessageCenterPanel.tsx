"use client";

/* ── 消息中心：全屏查看「只看一次就消失」的系统级提示 ─────────────
 * 仅做展示：从共享 store 读 open / messages，把每个消息（更新需重启、
 * dev server 重启等）展开成全屏可读列表。业务规则（谁 push、去重）在
 * 生产方，本组件不 import 逻辑/网络（规范 17 第③层视图）。
 */

import { formatClock, formatDate } from "~/lib/time-format";

import { useMemo } from "react";
import { zClass } from "~/lib/shell/overlay-z";
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
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useHotkey } from "~/components/ui/use-hotkey";

const KIND_META: Record<
  string,
  { icon: typeof Bell; tint: string; ring: string }
> = {
  update: {
    icon: RefreshCw,
    tint: "text-primary-strong bg-primary/15",
    ring: "border-primary/25",
  },
  restart: {
    icon: RotateCcw,
    tint: "text-warning-strong bg-warning/15",
    ring: "border-warning/25",
  },
  info: {
    icon: Bell,
    tint: "text-info-strong bg-info/15",
    ring: "border-info/25",
  },
};

function fmtTime(t: number): string {
  /* 消息中心带完整日期（消息可能跨天阅读）—— 日期口径走 `~/lib/time-format`
   * 的 `formatDate`（此前这里与历史日期桶、按天文件名各拼一遍）。 */
  return `${formatDate(t)} ${formatClock(t)}`;
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

  /* Esc 关闭全屏面板。`filterInput: false` —— 用户在消息正文里选中文本后
   * 按 Esc，期望的是关掉面板而不是「因为焦点在文本里所以没反应」。 */
  useHotkey({ key: "Escape" }, () => setOpen(false), {
    enabled: open,
    filterInput: false,
  });

  if (!open) return null;

  return (
    <FullScreenLayer
      zClass={zClass("modal")}
      className="bg-bg/92 flex flex-col backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="消息中心"
    >
      {/* 顶栏 */}
      <header className="border-border-strong flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <div className="flex items-center gap-2">
          <span className="relative">
            <BellRing size={16} className="text-primary-strong" />
            {unread > 0 && (
              <span className="bg-primary absolute -top-1.5 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[9px] font-bold text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </span>
          <span className="text-ink-bright text-[15px] font-semibold">
            消息中心
          </span>
          <span className="text-ink-muted text-xs">
            {messages.length
              ? `${messages.length} 条 · ${unread} 条未读`
              : "暂无消息"}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            onClick={markAllRead}
            disabled={unread === 0}
            className="text-ink-soft hover:bg-subtle hover:text-ink h-auto gap-1.5 rounded-md px-2.5 py-1.5 text-xs"
          >
            <CheckCheck data-icon="inline-start" size={14} />
            全部已读
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={clear}
            disabled={messages.length === 0}
            className="text-ink-soft hover:bg-danger/10 hover:text-danger-strong h-auto gap-1.5 rounded-md px-2.5 py-1.5 text-xs"
          >
            <Trash2 data-icon="inline-start" size={14} />
            清空
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen(false)}
            className="text-ink-soft hover:bg-subtle hover:text-ink ml-1 rounded-md"
            aria-label="关闭消息中心"
          >
            <X data-icon="inline-start" size={16} />
          </Button>
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
                    m.read
                      ? "border-border-subtle opacity-70"
                      : `${meta.ring} border`
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg ${meta.tint}`}
                    >
                      <Icon size={14} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <h3 className="text-ink-bright text-[13px] font-semibold">
                          {m.title}
                        </h3>
                        {!m.read && (
                          <Badge tone="primary" size="pill-sm">
                            新
                          </Badge>
                        )}
                        <time className="text-ink-muted text-2xs ml-auto shrink-0 tabular-nums">
                          {fmtTime(m.time)}
                        </time>
                      </div>
                      <p className="text-ink-soft mt-1 text-[12.5px] leading-relaxed wrap-break-word whitespace-pre-wrap">
                        {m.body}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(m.id);
                      }}
                      className="text-ink-fainter hover:bg-subtle hover:text-ink-soft shrink-0 rounded"
                      aria-label="删除该消息"
                    >
                      <Trash2 data-icon="inline-start" size={13} />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="border-border-strong text-ink-muted text-2xs flex h-9 shrink-0 items-center justify-between border-t px-4">
        <span>底部状态栏铃铛实时汇总未读消息，点此可全屏查看。</span>
        <Button
          variant="secondary"
          size="xs"
          onClick={() => setOpen(false)}
          className="bg-subtle text-ink-soft hover:bg-surface-2 hover:text-ink rounded px-2 py-0.5"
        >
          关闭 (Esc)
        </Button>
      </footer>
    </FullScreenLayer>
  );
}
