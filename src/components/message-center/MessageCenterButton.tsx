"use client";

/* ── 底部状态栏「消息」铃铛按钮 + 未读数量 ────────────────────
 * 纯展示：从共享 store 读未读数 & 当前面板开关，点击切换全屏消息中心。
 * 逻辑（消息生产/去重）不在此处，见 message-center-store 与各生产方。
 */

import { Bell } from "lucide-react";
import { useMessageCenterStore } from "./message-center-store";

export function MessageCenterButton() {
  const unread = useMessageCenterStore((s) =>
    s.messages.reduce((n, m) => n + (m.read ? 0 : 1), 0),
  );
  const open = useMessageCenterStore((s) => s.open);
  const toggleOpen = useMessageCenterStore((s) => s.toggleOpen);

  return (
    <button
      type="button"
      onClick={toggleOpen}
      title={`系统消息${unread > 0 ? `（${unread} 条未读）` : ""}，点击全屏查看`}
      aria-label={`系统消息${unread > 0 ? `，${unread} 条未读` : ""}`}
      aria-expanded={open}
      className={`relative flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors ${
        open || unread > 0
          ? "text-violet-700 dark:text-violet-300"
          : "text-ink-muted hover:bg-subtle hover:text-ink"
      }`}
    >
      <Bell size={12} />
      {unread > 0 && (
        <span className="flex min-w-[14px] items-center justify-center rounded-full bg-violet-500/20 px-1 text-[10px] font-semibold text-violet-700 tabular-nums dark:text-violet-300">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}
