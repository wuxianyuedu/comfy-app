"use client";

// ── 工坊 Agent 指挥助手浮层 ─────────────────────────────
// 纯展示组件：消费 useWorkshopAgent hook 返回的 controller，
// 渲染「对话消息区 + 工作过程面板 + 输入框」。无业务逻辑。
import React from "react";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/page-loading";
import { StatusDot } from "~/components/ui/status-dot";
import { useScrollFollow } from "~/components/ui/use-scroll-follow";
import type {
  WorkshopAgentController,
  AgentToolRun,
} from "./hooks/use-workshop-agent";
import { zClass } from "~/lib/shell/overlay-z";
import { enterCommit } from "~/components/ui/use-enter-commit";

const GREETING =
  "你好！我是工坊的创作指挥助手。你可以直接用自然语言告诉我想做什么，我会帮你指挥整个创作流程。\n\n比如：\n• 「帮我写一个海边重逢的温暖短片剧本」\n• 「在现有剧本基础上提取主要角色」\n• 「把分镜规划出来」";

const TOOL_STATUS_LABEL: Record<AgentToolRun["status"], string> = {
  running: "执行中…",
  done: "完成",
  error: "失败",
};

const TOOL_STATUS_COLOR: Record<AgentToolRun["status"], string> = {
  running: "bg-amber-400",
  done: "bg-emerald-400",
  error: "bg-red-400",
};

export function AgentOverlay({
  controller,
}: {
  controller: WorkshopAgentController;
}) {
  const {
    open,
    messages,
    input,
    busy,
    error,
    toolRuns,
    closeAgent,
    setInput,
    send,
  } = controller;
  const taRef = React.useRef<HTMLTextAreaElement>(null);

  /* 对话区跟随底部：贴底与「用户有没有接管滚动」的判据收在
   * `ui/use-scroll-follow`（规范 16 §16.2.4.24）。收口前这里是手写的
   * `scrollTop = scrollHeight` —— 用户往上滚读上一句 AI 回复会被立刻按回
   * 底部（`messages` / `busy` 一变就拉回去），而且**连开关都没有**。
   * 现在上滚即暂停跟随，并给出「回到最新」的可见出口。 */
  const followRef = React.useRef<HTMLDivElement>(null);
  const follow = useScrollFollow({
    containerRef: followRef,
    watch: `${messages.length}:${busy}`,
  });

  if (!open) return null;

  const visibleMessages =
    messages.length === 0
      ? [{ id: "greeting", role: "assistant" as const, content: GREETING }]
      : messages;

  return (
    <div
      className={`border-border bg-panel-deep/95 fixed right-6 bottom-6 ${zClass("popup")} flex h-[560px] w-[440px] flex-col overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-xl`}
    >
      {/* Header */}
      <div className="border-border flex items-center gap-2 border-b px-4 py-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-linear-to-br from-violet-500 to-fuchsia-500 text-[11px] font-bold text-white">
          <Icon name="bot" size={13} className="text-white" />
        </span>
        <div className="flex-1">
          <h3 className="text-ink text-[13px] font-semibold">创作指挥 Agent</h3>
          <p className="text-muted-foreground text-[10px]">
            用对话指挥完整工坊流程
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={closeAgent}
          className="text-muted-foreground hover:text-ink"
          aria-label="关闭 Agent"
        >
          <Icon name="x" size={14} />
        </Button>
      </div>

      {/* 工具执行状态面板（有工具跑过时显示在顶部） */}
      {toolRuns.length > 0 && (
        <div className="border-border bg-bg/60 max-h-28 shrink-0 overflow-y-auto border-b px-4 py-2">
          <div className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-[10px] font-medium">
            <Icon name="loader" size={11} className="inline" />
            工作过程
          </div>
          <div className="space-y-1">
            {toolRuns.map((run) => (
              <div key={run.id} className="flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${TOOL_STATUS_COLOR[run.status]}`}
                  style={
                    run.status === "running"
                      ? { animation: "pulse 1.2s ease-in-out infinite" }
                      : undefined
                  }
                />
                <span className="text-muted-foreground min-w-0 flex-1 truncate text-[11px]">
                  {run.summary}
                </span>
                <span className="text-muted-foreground shrink-0 text-[10px]">
                  {TOOL_STATUS_LABEL[run.status]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Messages。`relative` 是给「回到最新」的悬浮按钮当定位上下文 ——
          用户上滚后必须有一个能回到最新的出口（硬规则 4），否则只会觉得
          「消息不刷新了」。 */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={followRef}
          onScroll={follow.onScroll}
          className="flex-1 space-y-3 overflow-y-auto px-4 py-3"
        >
          {visibleMessages.map((msg) => {
            if (msg.role === "user") {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl bg-violet-500/90 px-3.5 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-white">
                    {msg.content}
                  </div>
                </div>
              );
            }
            if (msg.role === "tool-run") {
              return (
                <div key={msg.id} className="flex justify-start">
                  <div className="border-border/60 bg-bg/80 text-muted-foreground max-w-[85%] rounded-xl border px-3 py-1.5 text-[11px]">
                    ⚙ {msg.run.summary}
                  </div>
                </div>
              );
            }
            // assistant
            return (
              <div key={msg.id} className="flex justify-start">
                <div className="bg-subtle text-ink max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </div>
              </div>
            );
          })}

          {busy && (
            <div className="flex justify-start">
              <div className="bg-subtle rounded-2xl px-3 py-2.5">
                <span className="inline-flex gap-1">
                  <StatusDot
                    state="probing"
                    sizeClass="size-1.5 bg-muted-foreground"
                    pulse
                  />
                  <StatusDot
                    state="probing"
                    sizeClass="size-1.5 bg-muted-foreground"
                    pulse
                    className="[animation-delay:0.15s]"
                  />
                  <StatusDot
                    state="probing"
                    sizeClass="size-1.5 bg-muted-foreground"
                    pulse
                    className="[animation-delay:0.3s]"
                  />
                </span>
              </div>
            </div>
          )}
        </div>

        {/* 上滚后的可见出口：不给它，用户只会觉得「AI 不回复了」。 */}
        {!follow.following && (
          <Button
            variant="primary-solid"
            size="xs"
            onClick={follow.jumpToLatest}
            className="absolute bottom-3 left-1/2 h-auto -translate-x-1/2 rounded-full px-3 py-1 text-[11px] shadow-lg"
          >
            回到最新
          </Button>
        )}
      </div>

      {error && (
        <p className="border-border border-t bg-red-500/10 px-4 py-1.5 text-[11px] text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      {/* Input */}
      <div className="border-border flex items-end gap-2 border-t p-3">
        <textarea
          ref={taRef}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            event.target.style.height = "auto";
            event.target.style.height =
              Math.min(event.target.scrollHeight, 80) + "px";
          }}
          /* Shift+Enter 换行、Enter 发送；`ignoreIme` 由出口默认开着 ——
           * 此前这里没判 IME，中文输入法下**候选词未上屏的 Enter 会被当成发送**
           *（把半截拼音发给 AI），见 §16.2.4.29。 */
          {...enterCommit({
            onCommit: () => void send(),
            excludeShift: true,
          })}
          rows={1}
          placeholder="描述你的创作想法… (Enter 发送)"
          className="border-border bg-subtle text-ink placeholder:text-muted-foreground/50 min-w-0 flex-1 resize-none rounded-xl border px-3 py-2 text-[13px] outline-none focus:border-violet-500/40"
        />
        <Button
          variant="primary-solid"
          size="icon-lg"
          onClick={() => void send()}
          disabled={!input.trim() || busy}
          className="shrink-0 rounded-lg"
          aria-label="发送"
        >
          {busy ? (
            <Spinner className="size-3.5" />
          ) : (
            <Icon name="arrowup" size={14} />
          )}
        </Button>
      </div>
    </div>
  );
}

/** 触发 Agent 浮层打开的浮动按钮。 */
export function AgentFab({ onOpen }: { onOpen: () => void }) {
  return (
    <Button
      variant="primary-solid"
      onClick={onOpen}
      className={`shadow-primary-500/20 fixed right-6 bottom-8 ${zClass("popup")} h-auto gap-2 rounded-full px-4 py-2.5 shadow-lg transition-transform hover:scale-105`}
      aria-label="打开创作指挥 Agent"
    >
      <Icon name="bot" size={15} />
      Agent
    </Button>
  );
}
