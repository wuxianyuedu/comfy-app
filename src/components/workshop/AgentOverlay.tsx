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
import type {
  WorkshopAgentController,
  AgentToolRun,
} from "./hooks/use-workshop-agent";
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
 * 面板纵向落点：优先在图标**上方**展开（与图标底边对齐），上方放不下就翻到
 * 图标**下方**。
 *
 * 拖动过的入口常落在屏幕中部甚至偏上（用户就是为了不挡内容才拖的），此时只往上
 * 展开会把面板压到一两百像素高；翻到下方则能把它完整铺开。
 *
 * 返回的是**内联样式片段**而不是像素值：算式里只用 `100dvh` 与传入的偏移，
 * 渲染期不读 `window`（理由见调用处注释）。`anchorBottom` 是入口底边距视口
 * 下沿的距离，也就是「图标下方还剩多少」—— 面板翻到下方时占的正是这一段。
 */
export function panelPlacement(
  anchorBottom: number,
  /** 视口高（px）。**必须**由调用处传进来的理由见下方注释 —— 只有
   *  `anchorBottom` 推不出「图标上方还剩多少」。 */
  viewportHeight: number,
): {
  top?: string;
  bottom?: string;
  height: string;
  maxHeight: string;
} {
  /* 图标**上方**还剩多少 = 视口高 − 图标底边距下沿 − 图标直径 − 留白。
   * 放不下 `PANEL_MIN_HEIGHT_PX` 就翻到图标下方。
   *
   * 这个判据**必须**用到视口高：`anchorBottom` 只说「图标下方还剩多少」，
   * 上方的余量 = 视口高 − 图标高 − 它。早先版本误把它当成「上方余量」
   *（越大越宽裕），于是在「图标贴顶、偏移很大」时反而选了向上展开，
   * 把面板压成 144px 高 —— 标题栏与输入框之外什么都看不见。 */
  const spaceAbove =
    viewportHeight - anchorBottom - PANEL_ANCHOR_OFFSET - PANEL_EDGE_GAP_PX;
  if (spaceAbove >= PANEL_MIN_HEIGHT_PX) {
    return {
      bottom: `${anchorBottom}px`,
      height: `${PANEL_HEIGHT_PX}px`,
      maxHeight: `calc(100dvh - ${anchorBottom}px - ${PANEL_EDGE_GAP_PX}px)`,
    };
  }
  /* 翻到下方：顶边落在图标下沿（`100dvh − anchorBottom`）再让开一个间距。
   *
   * 高度上限同样写成 `100dvh` 的算式，**与 `top` 用同一个来源** —— 混用
   *「JS 读到的视口高」与「CSS 的 `dvh`」会在两者不等时（软键盘弹起、
   *  地址栏收放）让面板被 `max-height` 截短或伸出视口，而那种不一致没有任何
   *  东西会报警。`height` 只给自然高度，实际显示高由 `max-height` 收口。 */
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
  controller: WorkshopAgentController;
  /** 浮层入口当前所在位置（距视口右 / 下）—— 展开的对话窗跟着它走，见下方
   *  「面板与入口的相对位置」注释。 */
  anchor: { right: number; bottom: number };
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

  if (!open || viewport === null) return null;

  const visibleMessages =
    messages.length === 0
      ? [{ id: "greeting", role: "assistant" as const, content: GREETING }]
      : messages;

  return (
    <div
      /* 面板与入口的相对位置：入口那一枚图标是锚点，面板从它**左侧**展开
       * （`right` 再加上图标直径与间距）。
       *
       * 两者此前**各写一处固定偏移**（入口 `right-6 bottom-8`、面板
       * `right-6 bottom-6`）—— 用户拖动入口之后，面板倏地跳回右下角、跟入口
       * 脱节；窄窗下面板还会直接贴住视口边。位置**只由入口那一个来源派生**，
       * 这里不再出现第二份「角落偏移」。
       *
       * 纵向由 `panelPlacement()` 判一次（见那个函数的 Why），高度收口交给 CSS
       * 的 `max-height`／`top`／`bottom` 算式 —— 渲染期不读 `window.innerHeight`
       *（SSR 与首帧拿不到真实视口，会 hydrate 出两份不同的内联样式）。
       *
       *   高度：`height` 给自然高度、`max-height` 收口，两者一起读作
       *  「想长到 560px，但不许超出视口」。 */
      style={{
        right: anchor.right + PANEL_ANCHOR_OFFSET,
        ...panelPlacement(anchor.bottom, viewport.height),
      }}
      className={`border-border bg-panel-deep/95 ${zClass("popup")} fixed flex w-[min(440px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-xl`}
    >
      {/* Header */}
      <div className="border-border flex items-center gap-2 border-b px-4 py-3">
        {/* p71-allow:start brand 渐变 · 智能体头像 violet→fuchsia 双色（项目品牌视觉），单档 token 化会失去渐变识别度，见 §3.6.1 */}
        <span className="text-2xs flex size-6 items-center justify-center rounded-full bg-linear-to-br from-violet-500 to-fuchsia-500 font-bold text-white">
          <Icon name="bot" size={13} className="text-white" />
        </span>
        {/* p71-allow:end */}
        <div className="flex-1">
          <h3 className="text-ink u-title">创作指挥 Agent</h3>
          <p className="text-muted-foreground text-3xs">
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
          <Icon data-icon="inline-start" name="x" size={14} />
        </Button>
      </div>

      {/* 工具执行状态面板（有工具跑过时显示在顶部） */}
      {toolRuns.length > 0 && (
        <div className="border-border bg-bg/60 max-h-28 shrink-0 overflow-y-auto border-b px-4 py-2">
          <div className="text-muted-foreground text-3xs mb-1.5 flex items-center gap-1.5 font-medium">
            <Icon name="loader" size={11} className="inline" />
            工作过程
          </div>
          <div className="flex-col gap-1">
            {toolRuns.map((run) => (
              <div key={run.id} className="flex items-center gap-2">
                <span
                  data-slot="agent-tool-status-dot"
                  className={`size-1.5 shrink-0 rounded-full ${TOOL_STATUS_COLOR[run.status]}`}
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
          ref={followRef}
          onScroll={follow.onScroll}
          className="flex-1 gap-3 overflow-y-auto px-4 py-3"
        >
          {visibleMessages.map((msg) => {
            if (msg.role === "user") {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="bg-primary/90 max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-white">
                    {msg.content}
                  </div>
                </div>
              );
            }
            if (msg.role === "tool-run") {
              return (
                <div key={msg.id} className="flex justify-start">
                  <div className="border-border/60 bg-bg/80 text-muted-foreground text-2xs max-w-[85%] rounded-xl border px-3 py-1.5">
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
            className="text-2xs absolute bottom-3 left-1/2 h-auto -translate-x-1/2 rounded-full px-3 py-1 shadow-lg"
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
          ref={taRef}
          value={input}
          onChange={(event) => {
            /* 这一处要在同一个事件里读`scrollHeight` 调整高度，所以不能
             * 直接把`onChange` 换成适配器 —— 取值本身仍走出口。 */
            readTextInput(event, setInput);
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
          className="field-sizing-normal border-border bg-subtle text-ink placeholder:text-muted-foreground/50 focus-visible:border-primary focus-visible:ring-primary/30 min-h-0 flex-1 resize-none rounded-xl px-3 py-2 text-[13px]"
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
            <Icon data-icon="inline-start" name="arrowup" size={14} />
          )}
        </Button>
      </div>
    </div>
  );
}

/**
 * 触发 Agent 浮层打开的浮动入口。
 *
 * 三件事与「一枚悬浮图标」一起给出（少一件这条入口就是碍事的）：
 *
 *   · **只占一枚图标** —— 此前是「图标 + Agent」的胶囊，右下角常驻时正好压在
 *     工坊右栏（生成资源 / 资源库）与内容区的交界上，把「选择生图工作流」这类
 *     控件的右半截盖住。收成 40px 的圆钮后，它让出的横向空间就是那些控件的。
 *   · **可以拖** —— 让它常驻某处就总有挡住东西的时候，`useDraggablePosition`
 *     给出拖动 + 位置记忆（见该 hook 的 Why：位置跟右下角走、跨会话记住、
 *     拖动与点击靠位移阈值分开）。
 *   · **悬停给名字** —— 只剩图标之后，光看一枚机器人图标说不出它是干什么的；
 *     提示由 `Hint` 给（全库唯一出口，规范 16 §16.2.3），不走原生 `title=`。
 *
 * 「被拖动的位置」由调用处透传进来（`WorkshopPipeline` 同时要用它定位浮层
 * 展开后的位置），本组件不自己持有一份。
 */
export function AgentFab({
  elementRef,
  onOpen,
  offset,
  dragging,
  handleProps,
}: {
  /** 挂在按钮上的 ref 回调（由 `useDraggablePosition` 给）——
   *  拖动逻辑靠它知道元素什么时候进的 DOM、也靠它量尺寸夹边界。 */
  elementRef: (el: HTMLButtonElement | null) => void;
  onOpen: () => void;
  /** 距视口右 / 下的偏移；`null` = 还没量到，先不渲染（避免闪一下再跳位）。 */
  offset: { right: number; bottom: number } | null;
  dragging: boolean;
  handleProps: {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  };
}) {
  if (offset === null) return null;
  return (
    <Hint label="创作指挥 Agent（可拖动摆到任意位置）" side="left">
      <Button
        ref={elementRef}
        variant="primary-solid"
        {...handleProps}
        onClick={onOpen}
        style={{ right: offset.right, bottom: offset.bottom }}
        className={`shadow-primary-500/20 ${zClass("popup")} fixed size-10 touch-none rounded-full p-0 shadow-lg ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        aria-label="打开创作指挥 Agent"
      >
        <Icon data-icon="inline-start" name="bot" size={18} />
      </Button>
    </Hint>
  );
}
