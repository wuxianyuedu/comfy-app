"use client";

/* ── 消息中心：全屏查看「只看一次就消失」的系统级提示 ─────────────
 * 仅做展示：从共享 store 读 open / messages，把每个消息（更新需重启、
 * dev server 重启等）展开成全屏可读列表。业务规则（谁 push、去重）在
 * 生产方，本组件不 import 逻辑/网络（规范 17 第③层视图）。
 */

import { formatClock, formatDate } from "~/lib/time-format";

import { useMemo, useEffect } from "react";
import { zClass } from "~/lib/shell/overlay-z";
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
const KIND_META: Record<
  MessageKind,
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

export function MessageCenterPanel() {
  const open = useMessageCenterStore((s) => s.open);
  const messages = useMessageCenterStore((s) => s.messages);
  const setOpen = useMessageCenterStore((s) => s.setOpen);
  const markAllRead = useMessageCenterStore((s) => s.markAllRead);
  const markRead = useMessageCenterStore((s) => s.markRead);
  const remove = useMessageCenterStore((s) => s.remove);
  const clear = useMessageCenterStore((s) => s.clear);
  const hydrate = useMessageCenterStore((s) => s.hydrate);

  /* 从持久化恢复历史消息。**放在这个组件里是因为它是唯一无条件常驻的挂载点**
   * （根布局挂一次，且下面的 `if (!open) return null` 在所有 hook 之后——
   * 面板关着时 effect 照样跑）。放模块加载期会与 SSR 撞出水合不匹配，见
   * message-center-store 的说明。 */
  useEffect(() => {
    hydrate();
  }, [hydrate]);

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
          <EmptyState
            variant="panel"
            className="gap-3"
            icon={<Inbox size={44} strokeWidth={1.2} className="opacity-30" />}
            title="暂无系统消息"
          />
        ) : (
          <ul className="mx-auto flex w-full max-w-3xl flex-col gap-2.5 px-4 py-5">
            {messages.map((m) => {
              const meta = KIND_META[m.kind];
              const Icon = meta.icon;
              return (
                <li
                  key={m.id}
                  className={`bg-subtle/60 hover:bg-subtle rounded-xl border p-3.5 transition-colors ${
                    m.read
                      ? "border-border-subtle opacity-70"
                      : `${meta.ring} border`
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* 整行「点一下标记已读」用原生 `<Button variant="ghost">`
                     *  而不是 `li` 上的 `onClick`：这条 `<li>` 里还嵌着一个删除
                     *  按钮，两者不能合成同一个 `<button>`（HTML 里按钮套按钮
                     *  非法），而键可达的语义是不能靠「父元素 onClick」白拿的
                     *  —— 此前键盘用户能 Tab 到删除按钮，却没有任何路径标记已读
                     *  （鼠标点得开、键盘进不来）。原生 `<button>` 的
                     *  Enter/Space 与焦点语义是免费给的，再挂一个
                     *  `simpleKeyHandler` 只是复刻浏览器默认行为（§16.2.4.57）。
                     *  `ghost` 变体的底色/文字色由这里接管（§16.2.4.2 第 5 条），
                     *  行外观与收口前一致。 */}
                    <Button
                      variant="ghost"
                      onClick={() => markRead(m.id)}
                      /* `h-auto` 是必须的，不是风格：`size` 的缺省档带 `h-8`（32px
                       * 定高），而这条按钮的内容是「标题 + 正文」——正文可能是**多段**
                       *（陈旧实例那条就是：正文含换行、`whitespace-pre-wrap` 会照实
                       * 换行）。定高 32px 之下正文溢出按钮盒、穿过 `<li>` 的下沿压到
                       * 下一条消息上，而 `<li>` 的高度仍按 32px 算 ⇒ 画布上两张卡片
                       * 叠在一起，tsc / eslint / 构建全绿。同文件另外两颗按钮也带
                       * `h-auto`，这里此前漏了。 */
                      className="flex h-auto min-w-0 flex-1 items-start justify-start gap-3 rounded-lg p-0 text-left font-normal whitespace-normal hover:bg-transparent"
                    >
                      <span
                        className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg ${meta.tint}`}
                      >
                        <Icon size={14} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <h3 className="text-ink-bright text-sm font-semibold">
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
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => remove(m.id)}
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
