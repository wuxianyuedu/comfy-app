"use client";

// ── 工坊 Agent 指挥助手浮层 ─────────────────────────────
// 纯展示组件：消费 useWorkshopAgent hook 返回的 controller，
// 渲染「对话消息区 + 工作过程面板 + 输入框」。无业务逻辑。
import React from "react";
import { readTextInput } from "~/lib/form-props";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { StatusDot } from "~/components/ui/status-dot";
import { Textarea } from "~/components/ui/textarea";
import { useScrollFollow } from "~/components/ui/use-scroll-follow";
import type { WorkshopAgentController, AgentToolRun } from "./hooks/use-workshop-agent";
import { zClass } from "~/lib/shell/overlay-z";
import { enterCommit } from "~/components/ui/use-enter-commit";
import { Hint } from "~/components/ui/hint";
import { useViewportSize } from "~/components/ui/use-viewport-size";

const GREETING =
  "你好！我是工坊的创作指挥助手。你可以直接用自然语言告诉我想做什么，我会帮你指挥整个创作流程。\n\n比如：\n• 「帮我写一个海边重逢的温暖短片剧本」\n• 「在现有剧本基础上提取主要角色」\n• 「把分镜规划出来」";

const TOOL_STATUS_LABEL: Record<AgentToolRun["status"], string> = {
  running: "执行中…",
  done: "完成",
  error: "失败",
};

/** 浮层入口图标的直径（`size-10` = 40px）与「入口 ↔ 面板」之间的间距。 */
const PANEL_ANCHOR_OFFSET = 48;

/** 「面板 ↔ 视口上沿 / 下沿」的最小留白（px）。 */
const PANEL_EDGE_GAP_PX = 16;

/** 面板的自然高度（`h-140`），后面几处算式都要引用它。 */
const PANEL_HEIGHT_PX = 560;

/** 「图标上方放得下」的判据（px）：低于它就把面板改从图标下方展开。
 *
 *  320 是「标题栏 + 工具过程 + 至少四五条对话 + 输入框」的读数 —— 再矮就只剩
 *  标题栏和输入框，用户打开面板却读不到任何一句回复，等于把对话藏起来了。 */
const PANEL_MIN_HEIGHT_PX = 320;

/**
 * 面板纵向落点：优先在图标**上方**展开（与图标底边对齐），上方放不下就翻到下方
 *（只往上展开会把面板压到一两百像素高）。返回的是**内联样式片段**：算式只用
 * `100dvh` 与传入偏移，渲染期不读 `window`（理由见调用处注释）。
 */
export function panelPlacement(
  anchorBottom: number,
  /** 视口高（px）。**必须**由调用处传进来的理由见下方注释 —— 只有
   *  `anchorBottom` 推不出「图标上方还剩多少」。 */
  viewportHeight: number,
): {
  bottom?: string;
  height: string;
  maxHeight: string;
  top?: string;
} {
  /* 图标**上方**余量 = 视口高 − 图标底边距下沿 − 图标直径 − 留白；放不下
   * `PANEL_MIN_HEIGHT_PX` 就翻到下方。这个判据必须用视口高：`anchorBottom` 只说
   *「图标下方还剩多少」，误当成上方余量曾在「图标贴顶」时把面板压成 144px 高。 */
  const spaceAbove = viewportHeight - anchorBottom - PANEL_ANCHOR_OFFSET - PANEL_EDGE_GAP_PX;
  if (spaceAbove >= PANEL_MIN_HEIGHT_PX) {
    return {
      bottom: `${anchorBottom}px`,
      height: `${PANEL_HEIGHT_PX}px`,
      maxHeight: `calc(100dvh - ${anchorBottom}px - ${PANEL_EDGE_GAP_PX}px)`,
    };
  }
  /* 翻到下方：顶边落在图标下沿（`100dvh − anchorBottom`）再让开一个间距。
   * 高度上限同样写成 `100dvh` 的算式、**与 `top` 同源** —— 混用 JS 读到的视口高
   * 与 CSS 的 `dvh` 会在两者不等时（软键盘弹起、地址栏收放）把面板截短或伸出视口，
   * 而那种不一致没有任何东西会报警。`height` 只给自然高度，显示高由 `max-height` 收口。 */
  return {
    top: `calc(100dvh - ${anchorBottom - PANEL_ANCHOR_OFFSET}px)`,
    height: `${PANEL_HEIGHT_PX}px`,
    maxHeight: `calc(100dvh - ${anchorBottom}px - ${PANEL_ANCHOR_OFFSET}px - ${PANEL_EDGE_GAP_PX}px)`,
  };
}

const TOOL_STATUS_COLOR: Record<AgentToolRun["status"], string> = {
  running: "bg-warning",
  done: "bg-success",
  error: "bg-destructive",
};

export function AgentOverlay({
  controller,
  anchor,
}: {
  /** 浮层入口当前所在位置（距视口右 / 下）—— 展开的对话窗跟着它走，见下方
   *  「面板与入口的相对位置」注释。 */
  anchor: { bottom: number; right: number };
  controller: WorkshopAgentController;
}) {
  const { open, messages, input, busy, error, toolRuns, closeAgent, setInput, send } = controller;
  const taRef = React.useRef<HTMLTextAreaElement>(null);

  /* 面板纵向落点要判「图标上方放不放得下」，这需要视口高（见
   * `panelPlacement` 的 Why）。首帧为 `null` —— 那时先不摆位（先不渲染比按
   * 假高度摆错要好），挂载后立刻量到并落位。 */
  const viewport = useViewportSize();

  /* 对话区跟随底部：贴底与「用户有没有接管滚动」的判据收在
   *`ui/use-scroll-follow`（规范 16 §16.2.4.24）。收口前这里是手写的
   *`scrollTop = scrollHeight` —— 用户往上滚读上一句 AI 回复会被立刻按回
   * 底部（`messages` /`busy` 一变就拉回去），而且**连开关都没有**。
   * 现在上滚即暂停跟随，并给出「回到最新」的可见出口。 */
  const followRef = React.useRef<HTMLDivElement>(null);
  const follow = useScrollFollow({
    containerRef: followRef,
    watch: `${messages.length}:${busy}`,
  });

  if (!open || viewport === null) {
    return null;
  }

  const visibleMessages =
    messages.length === 0
      ? [
          {
            id: "greeting",
            /* SAFETY: 类型断言已复核 */
            role: "assistant" as const,
            content: GREETING,
          },
        ]
      : messages;

  return (
    <div
      className={`border-border bg-panel-deep/95 ${zClass("popup")} fixed flex w-[min(440px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-xl`}
      /* 面板位置**只由入口那一个来源派生**（`right` 再加上图标直径与间距）——
       * 此前两者各写一处固定偏移，用户拖动入口后面板会跳回右下角、跟入口脱节。
       * 纵向由 `panelPlacement()` 判一次，高度收口交给 CSS 的 `max-height`／`top`／
       * `bottom` 算式 —— 渲染期不读 `window.innerHeight`（SSR 与首帧拿不到真实
       * 视口，会 hydrate 出两份不同的内联样式）。 */
      style={{
        right: anchor.right + PANEL_ANCHOR_OFFSET,
        ...panelPlacement(anchor.bottom, viewport.height),
      }}
    >
      {/* Header */}
      <div className="border-border flex items-center gap-2 border-b px-4 py-3">
        <span className="text-2xs u-gradient-brand flex size-6 items-center justify-center rounded-full font-bold text-white">
          <Icon className="text-white" name="bot" size={13} />
        </span>
        <div className="flex-1">
          <h3 className="text-ink u-title">创作指挥 Agent</h3>
          <p className="text-muted-foreground text-xs">用对话指挥完整工坊流程</p>
        </div>
        <Button
          aria-label="关闭 Agent"
          className="text-muted-foreground hover:text-ink"
          onClick={closeAgent}
          size="icon-xs"
          variant="ghost"
        >
          <Icon data-icon="inline-start" name="x" size={14} />
        </Button>
      </div>

      {/* 工具执行状态面板（有工具跑过时显示在顶部） */}
      {toolRuns.length > 0 && (
        <div className="border-border bg-bg/60 max-h-28 shrink-0 overflow-y-auto border-b px-4 py-2">
          <div className="text-muted-foreground text-3xs mb-1.5 flex items-center gap-1.5 font-medium">
            <Icon className="inline" name="loader" size={11} />
            工作过程
          </div>
          <div className="flex-col gap-1">
            {toolRuns.map((run) => (
              <div className="flex items-center gap-2" key={run.id}>
                <span
                  className={`size-1.5 shrink-0 rounded-full ${TOOL_STATUS_COLOR[run.status]}`}
                  data-slot="agent-tool-status-dot"
                  style={
                    run.status === "running"
                      ? { animation: "pulse 1.2s ease-in-out infinite" }
                      : undefined
                  }
                />
                <span className="text-muted-foreground text-2xs min-w-0 flex-1 truncate">
                  {run.summary}
                </span>
                <span className="text-muted-foreground text-3xs shrink-0">
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
          className="flex-1 gap-3 overflow-y-auto px-4 py-3"
          onScroll={follow.onScroll}
          ref={followRef}
        >
          {visibleMessages.map((msg) => {
            if (msg.role === "user") {
              return (
                <div className="flex justify-end" key={msg.id}>
                  <div className="bg-primary/90 max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap text-white">
                    {msg.content}
                  </div>
                </div>
              );
            }
            if (msg.role === "tool-run") {
              return (
                <div className="flex justify-start" key={msg.id}>
                  <div className="border-border/60 bg-bg/80 text-muted-foreground text-2xs max-w-[85%] rounded-xl border px-3 py-1.5">
                    ⚙ {msg.run.summary}
                  </div>
                </div>
              );
            }
            // assistant
            return (
              <div className="flex justify-start" key={msg.id}>
                <div className="bg-subtle text-ink max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </div>
              </div>
            );
          })}

          {busy && (
            <div className="flex justify-start">
              <div className="bg-subtle rounded-2xl px-3 py-2.5">
                <span className="inline-flex gap-1">
                  <StatusDot pulse sizeClass="size-1.5 bg-muted-foreground" state="probing" />
                  <StatusDot
                    className="[animation-delay:0.15s]"
                    pulse
                    sizeClass="size-1.5 bg-muted-foreground"
                    state="probing"
                  />
                  <StatusDot
                    className="[animation-delay:0.3s]"
                    pulse
                    sizeClass="size-1.5 bg-muted-foreground"
                    state="probing"
                  />
                </span>
              </div>
            </div>
          )}
        </div>

        {/* 上滚后的可见出口：不给它，用户只会觉得「AI 不回复了」。 */}
        {!follow.following && (
          <Button
            className="text-2xs absolute bottom-3 left-1/2 h-auto -translate-x-1/2 rounded-full px-3 py-1 shadow-lg"
            onClick={follow.jumpToLatest}
            size="xs"
            variant="primary-solid"
          >
            回到最新
          </Button>
        )}
      </div>

      {error && (
        <p className="border-border bg-destructive/10 text-destructive text-2xs border-t px-4 py-1.5">
          {error}
        </p>
      )}

      {/* Input */}
      <div className="border-border flex items-end gap-2 border-t p-3">
        <Textarea
          onChange={(event) => {
            /* 这一处要在同一个事件里读`scrollHeight` 调整高度，所以不能
             * 直接把`onChange` 换成适配器 —— 取值本身仍走出口。 */
            readTextInput(event, setInput);
            event.target.style.height = "auto";
            event.target.style.height = `${Math.min(event.target.scrollHeight, 80)}px`;
          }}
          ref={taRef}
          value={input}
          /* Shift+Enter 换行、Enter 发送；`ignoreIme` 由出口默认开着 ——
           * 此前这里没判 IME，中文输入法下**候选词未上屏的 Enter 会被当成发送**
           *（把半截拼音发给 AI），见 §16.2.4.29。 */
          {...enterCommit({
            // oxlint-disable-next-line no-void -- reject 由 action 内部捕获
            onCommit: () => void send(),
            excludeShift: true,
          })}
          className="field-sizing-normal border-border bg-subtle text-ink placeholder:text-muted-foreground/50 focus-visible:border-primary focus-visible:ring-primary/30 min-h-0 flex-1 resize-none rounded-xl px-3 py-2 text-sm"
          placeholder="描述你的创作想法… (Enter 发送)"
          rows={1}
        />
        <Button
          aria-label="发送"
          className="shrink-0 rounded-lg"
          disabled={!input.trim() || busy}
          // oxlint-disable-next-line no-void -- reject 由 action 内部捕获
          onClick={() => void send()}
          size="icon-lg"
          variant="primary-solid"
        >
          {busy ? (
            <Spinner className="size-3.5" />
          ) : (
            <Icon data-icon="inline-start" name="arrowup" size={14} />
          )}
        </Button>
      </div>
    </div>
  );
}

/**
 * 触发 Agent 浮层打开的浮动入口：只占一枚圆钮（此前「图标 + Agent」的胶囊会压住工坊右栏控件的右半截）、可以拖（`useDraggablePosition` 给拖动 + 位置记忆）、
 * 悬停由 `Hint` 给名字（全库唯一出口，规范 16 §16.2.3，不走原生 `title=`）；「被拖动的位置」由调用处透传（`WorkshopPipeline` 要用它定位浮层），本组件不自持。
 */
export function AgentFab({
  elementRef,
  onOpen,
  offset,
  dragging,
  handleProps,
}: {
  dragging: boolean;
  /** 挂在按钮上的 ref 回调（由 `useDraggablePosition` 给）——
   *  拖动逻辑靠它知道元素什么时候进的 DOM、也靠它量尺寸夹边界。 */
  elementRef: (el: HTMLButtonElement | null) => void;
  handleProps: {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  };
  /** 距视口右 / 下的偏移；`null` = 还没量到，先不渲染（避免闪一下再跳位）。 */
  offset: { bottom: number; right: number } | null;
  onOpen: () => void;
}) {
  if (offset === null) {
    return null;
  }
  return (
    <Hint label="创作指挥 Agent（可拖动摆到任意位置）" side="left">
      <Button
        ref={elementRef}
        variant="primary-solid"
        {...handleProps}
        aria-label="打开创作指挥 Agent"
        className={`${zClass("popup")} fixed size-10 touch-none rounded-full p-0 shadow-lg shadow-black/25 ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        onClick={onOpen}
        style={{ right: offset.right, bottom: offset.bottom }}
      >
        <Icon data-icon="inline-start" name="bot" size={18} />
      </Button>
    </Hint>
  );
}
