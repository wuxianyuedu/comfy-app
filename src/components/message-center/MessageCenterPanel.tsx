"use client";

/* ── 消息中心：全屏查看「只看一次就消失」的系统级提示 ─────────────
 * 仅做展示：从共享 store 读 open / messages，把每个消息（更新需重启、
 * dev server 重启等）展开成全屏可读列表。业务规则（谁 push、去重）在
 * 生产方，本组件不 import 逻辑/网络（规范 17 第③层视图）。
 */

import { formatClock, formatDate } from "~/lib/time-format";

import { useMemo, useEffect, Fragment } from "react";
import { zClass } from "~/lib/shell/overlay-z";
import { groupMessagesByRun } from "~/lib/shell/message-run-groups";
import type { MessageRunGroup } from "~/lib/shell/message-run-groups";
import {
  Bell,
  BellRing,
  CheckCheck,
  Inbox,
  RefreshCw,
  RotateCcw,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";

import {
  useMessageCenterStore,
  type MessageKind,
  type MessageRecord,
} from "./message-center-store";
import { FullScreenLayer } from "~/components/studio/fullscreen/FullScreenLayer";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { useHotkey } from "~/components/ui/use-hotkey";

/* 键收成 `MessageKind`（不是 `string`）：新增一档 kind 时编译器会在这里报缺项，
 * 于是「加了一档分档、忘了配图标与色调」不会拖到运行期才显形（此前这里是
 * `Record<string, …>` + 运行时 `?? KIND_META.info!` 兜底，配色表漏一档就静默
 * 退化成 info 那一档）。 */
const KIND_META: Record<MessageKind, { icon: typeof Bell; ring: string; tint: string }> = {
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
  /* 应用服务断开：与「运行中 / 已重启」那几档不同色——它不是一次恢复动作，
   * 是「现在这件事就是坏的」，红色与底部状态栏那一格同调。 */
  offline: {
    icon: WifiOff,
    tint: "text-destructive-strong bg-destructive/15",
    ring: "border-destructive/25",
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

/** 组头：一次启动与下一次启动之间的分隔。每一组**都有**组头（含第一组：第一行
 *  同时也是图例）；「本次启动」用主色 + 实心点标出，更早批次退回弱色。 */
function RunGroupHeader({ group }: { group: MessageRunGroup<MessageRecord> }) {
  return (
    <li
      aria-label={`${group.label}${group.isCurrent ? "（当前）" : ""}`}
      className="flex items-center gap-2.5 px-1 pt-2 pb-1"
    >
      <span className={`h-px flex-1 ${group.isCurrent ? "bg-primary/30" : "bg-border-subtle"}`} />
      <span className="flex shrink-0 items-center gap-1.5">
        {group.isCurrent && (
          <span aria-hidden="true" className="bg-primary size-1.5 shrink-0 rounded-full" />
        )}
        <span
          className={
            group.isCurrent
              ? "text-primary-strong text-2xs font-semibold"
              : "text-ink-muted text-2xs font-medium"
          }
        >
          {group.label}
        </span>
        <span className="text-ink-fainter text-2xs tabular-nums">{fmtTime(group.latestAt)}</span>
        <span className="text-ink-fainter text-2xs tabular-nums">· {group.count} 条</span>
        {/* runId 与 `log/runs/<日期>_<时分秒>-<runId>` 同形：分组头带上它，
            用户想翻日志时不用再去猜是哪一包。 */}
        {group.runId !== null && (
          <span
            className="text-ink-fainter text-3xs font-mono"
            title={`启动标识 ${group.runId}（与 log/runs/ 下的目录名尾段一致）`}
          >
            {group.runId}
          </span>
        )}
      </span>
      <span className={`h-px flex-1 ${group.isCurrent ? "bg-primary/30" : "bg-border-subtle"}`} />
    </li>
  );
}

export function MessageCenterPanel() {
  const open = useMessageCenterStore((s) => s.open);
  const messages = useMessageCenterStore((s) => s.messages);
  const setOpen = useMessageCenterStore((s) => s.setOpen);
  const markAllRead = useMessageCenterStore((s) => s.markAllRead);
  const markRead = useMessageCenterStore((s) => s.markRead);
  const remove = useMessageCenterStore((s) => s.remove);
  const clear = useMessageCenterStore((s) => s.clear);
  const hydrate = useMessageCenterStore((s) => s.hydrate);
  const currentRunId = useMessageCenterStore((s) => s.currentRunId);

  /* 从持久化恢复历史消息。**放在这个组件里是因为它是唯一无条件常驻的挂载点**
   * （根布局挂一次，且下面的 `if (!open) return null` 在所有 hook 之后——
   * 面板关着时 effect 照样跑）。放模块加载期会与 SSR 撞出水合不匹配，见
   * message-center-store 的说明。 */
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const unread = useMemo(() => messages.reduce((n, m) => n + (m.read ? 0 : 1), 0), [messages]);

  /* 按「每一次启动」分组。判据是纯函数（`~/lib/shell/message-run-groups`），
   * 这里只把结果摊平成交错的「组头 + 消息行」——分不分组、哪一组是「本次启动」
   * 都不由视图决定。 */
  const groups = useMemo(
    () => groupMessagesByRun(messages, currentRunId),
    [messages, currentRunId],
  );

  /* Esc 关闭全屏面板。`filterInput: false` —— 用户在消息正文里选中文本后
   * 按 Esc，期望的是关掉面板而不是「因为焦点在文本里所以没反应」。 */
  useHotkey(
    { key: "Escape" },
    () => {
      setOpen(false);
    },
    {
      enabled: open,
      filterInput: false,
    },
  );

  if (!open) {
    return null;
  }

  return (
    <FullScreenLayer
      aria-label="消息中心"
      aria-modal="true"
      className="bg-bg flex flex-col"
      role="dialog"
      zClass={zClass("modal")}
    >
      {/* 顶栏 */}
      <header className="border-border-strong flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <div className="flex items-center gap-2">
          <span className="relative">
            <BellRing className="text-primary-strong" size={16} />
            {unread > 0 && (
              <span className="bg-primary text-3xs absolute -top-1.5 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 font-bold text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </span>
          <span className="text-ink-bright text-sm font-semibold">消息中心</span>
          <span className="text-ink-muted text-xs">
            {messages.length ? `${messages.length} 条 · ${unread} 条未读` : "暂无消息"}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Button
            className="text-ink-soft hover:bg-subtle hover:text-ink h-auto gap-1.5 rounded-md px-2.5 py-1.5 text-xs"
            disabled={unread === 0}
            onClick={markAllRead}
            size="xs"
            variant="ghost"
          >
            <CheckCheck data-icon="inline-start" size={14} />
            全部已读
          </Button>
          <Button
            className="text-ink-soft hover:bg-danger/10 hover:text-danger-strong h-auto gap-1.5 rounded-md px-2.5 py-1.5 text-xs"
            disabled={messages.length === 0}
            onClick={clear}
            size="xs"
            variant="ghost"
          >
            <Trash2 data-icon="inline-start" size={14} />
            清空
          </Button>
          <Button
            aria-label="关闭消息中心"
            className="text-ink-soft hover:bg-subtle hover:text-ink ml-1 rounded-md"
            onClick={() => {
              setOpen(false);
            }}
            size="icon"
            variant="ghost"
          >
            <X data-icon="inline-start" size={16} />
          </Button>
        </div>
      </header>

      {/* 消息列表 */}
      <div className="custom-scrollbar flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <EmptyState
            className="gap-3"
            icon={<Inbox className="opacity-30" size={44} strokeWidth={1.2} />}
            title="暂无系统消息"
            variant="panel"
          />
        ) : (
          <ul className="mx-auto flex w-full max-w-3xl flex-col gap-2.5 px-4 py-5">
            {groups.map((group, groupIndex) => (
              <Fragment key={group.runId ?? `unmarked-${groupIndex}`}>
                <RunGroupHeader group={group} />
                {group.messages.map((m) => {
                  const meta = KIND_META[m.kind];
                  const Icon = meta.icon;
                  return (
                    <li
                      className={`bg-subtle/60 hover:bg-subtle rounded-xl border p-3.5 transition-colors ${
                        m.read ? "border-border-subtle opacity-70" : `${meta.ring} border`
                      }`}
                      key={m.id}
                    >
                      <div className="flex items-start gap-3">
                        {/* 整行「点一下标记已读」用原生 `<Button variant="ghost">` 而不是
                         *  `li` 上的 `onClick`：行内还嵌着删除按钮，按钮套按钮非法；键可达
                         *  语义靠不了「父元素 onClick」（此前键盘用户没有任何路径标记已读）。
                         *  原生 button 免费给 Enter/Space（§16.2.4.57）；`ghost` 的底色/文字
                         *  色由这里接管（§16.2.4.2 第 5 条），行外观与收口前一致。 */}
                        <Button
                          /* `h-auto` 是必须的，不是风格：`size` 缺省档带 `h-8`（32px 定高），
                           * 而这条按钮的内容是多段正文（`whitespace-pre-wrap` 照实换行）；定高
                           * 之下正文溢出、压到下一条消息上，两张卡片叠在一起而检查全绿。 */
                          className="flex h-auto min-w-0 flex-1 items-start justify-start gap-3 rounded-lg p-0 text-left font-normal whitespace-normal hover:bg-transparent"
                          onClick={() => {
                            markRead(m.id);
                          }}
                          variant="ghost"
                        >
                          <span
                            className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg ${meta.tint}`}
                          >
                            <Icon size={14} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                              <h3 className="text-ink-bright text-sm font-semibold">{m.title}</h3>
                              {!m.read && (
                                <Badge size="pill-sm" tone="primary">
                                  新
                                </Badge>
                              )}
                              <time className="text-ink-muted text-2xs ml-auto shrink-0 tabular-nums">
                                {fmtTime(m.time)}
                              </time>
                            </div>
                            <p className="text-ink-soft mt-1 text-xs leading-relaxed wrap-break-word whitespace-pre-wrap">
                              {m.body}
                            </p>
                          </div>
                        </Button>
                        <Button
                          aria-label="删除该消息"
                          className="text-ink-fainter hover:bg-subtle hover:text-ink-soft shrink-0 rounded"
                          onClick={() => {
                            remove(m.id);
                          }}
                          size="icon-xs"
                          variant="ghost"
                        >
                          <Trash2 data-icon="inline-start" size={13} />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </Fragment>
            ))}
          </ul>
        )}
      </div>

      <footer className="border-border-strong text-ink-muted text-2xs flex h-9 shrink-0 items-center justify-between border-t px-4">
        <span>底部状态栏铃铛实时汇总未读消息，点此可全屏查看。</span>
        <Button
          className="bg-subtle text-ink-soft hover:bg-surface-2 hover:text-ink rounded px-2 py-0.5"
          onClick={() => {
            setOpen(false);
          }}
          size="xs"
          variant="secondary"
        >
          关闭 (Esc)
        </Button>
      </footer>
    </FullScreenLayer>
  );
}
