"use client";

/**
 * RuntimeLogBox —— 「启动日志」框（设置页三段 + 侧栏「ComfyUI」页共用）：三个分区此前各自内联
 * 40 行同款 JSX，收成一处，并补齐「切换每次启动」（`log.sessions` 按一次启动一份文件列出）与
 * 「全屏查看」（`ui/fullscreen-dialog`，带同一个下拉与刷新）。视图只渲染，数据来自 controller（§17）；
 * 它住在 `studio/logs` 是因为有两个屏的消费者，留在任一侧都会形成「共用部件 → 某个屏」的反向依赖。 */

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Clock3, Maximize2, Minimize2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { StatusDot } from "~/components/ui/status-dot";
import { SelectMenu } from "~/components/ui/select-menu";
import { useScrollFollow } from "~/components/ui/use-scroll-follow";
import { FullScreenDialog } from "~/components/ui/fullscreen-dialog";
import { cn } from "~/lib/utils";

import { AnsiLogText } from "./AnsiLogText";
import { stripLineTimestamps, stripStreamPrefixes } from "./runtime-log-display";
import type { RuntimeLogController } from "./use-runtime-log-source";

export type RuntimeLogBoxProps = {
  /** 外框的补充 class（各分区与上方元素之间的间距不同）。 */
  className?: string;
  /** 空态提示（引导用户点启动按钮或刷新）。 */
  emptyHint: ReactNode;
  /** 日志文件名（标题里显示，如 `comfyui-runtime.log`）。 */
  fileName: string;
  /**
   * 让小窗口的日志正文吃满更多纵向空间（ComfyUI 页用）——这一页下方本没有别的
   * 内容，用 `max-h-44` 把滚动区压成一条、下面留一大片空白是浪费（ISSUE #4631）。
   * 其它调用点（设置页三段）保持原紧凑高度。
   */
  fill?: boolean;
  /** 日志来源：正文 / 片段 / 会话列表 / 选中项 / 跟随态 / 刷新动作。 */
  log: RuntimeLogController;
};

export function RuntimeLogBox({
  fileName,
  fill = false,
  log,
  emptyHint,
  className,
}: RuntimeLogBoxProps) {
  const [fullscreen, setFullscreen] = useState(false);
  /* 滚动跟随是纯视觉偏好，留在视图层（三个分区此前各持一份，现已合并）。 */
  const [follow, setFollow] = useState(true);
  /* 时间戳显隐同为纯视觉偏好：默认显示（与落盘一致），隐藏只影响展示片段。 */
  const [showTime, setShowTime] = useState(true);

  const title = `启动日志（${fileName}）`;

  return (
    <>
      {/* 全屏时整块小窗口都不渲染：同一段日志渲染两份既费 DOM、又会出现两个
          同名的会话下拉（读屏器与测试都分不清该操作哪一个）。 */}
      {!fullscreen && (
        <div
          className={cn(
            "border-border bg-surface-1 rounded-xl border",
            /* fill：作为弹性列里的一个可伸展块，把页面剩余高度吃满（ComfyUI 页
               重设计稿）。外框自己成为 flex 容器，正文区 `flex-1` 在框内伸展；
               `min-h-0` + `overflow-hidden` 让正文区真能收缩、深色日志面一直铺到
               卡片底缘（用户反馈 #4710：日志和背景高度不匹配）。非 fill 档保持
               原样的下边距。 */
            fill ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "mb-4",
            className,
          )}
        >
          <LogToolbar
            follow={follow}
            log={log}
            onFollowChange={setFollow}
            onShowTimeChange={setShowTime}
            showTime={showTime}
            title={title}
            trailing={
              <Hint label="全屏查看">
                <Button
                  aria-label="全屏查看"
                  className="text-ink-muted hover:bg-subtle hover:text-ink-strong rounded-md"
                  onClick={() => {
                    setFullscreen(true);
                  }}
                  size="icon-sm"
                  variant="ghost"
                >
                  <Maximize2 data-icon="inline-start" size={14} />
                </Button>
              </Hint>
            }
            variant="inline"
          />
          <LogBody
            className={
              fill
                ? /* fill 档：深色日志面从工具条下一直铺到卡片底缘（不内缩、不留
                     卡片底色条），高度吃满卡片剩余空间。 */
                  "border-border-subtle min-h-0 flex-1 border-t px-3 py-2"
                : "border-border-subtle mx-3 mb-3 max-h-44 rounded-lg border px-3 py-2"
            }
            emptyHint={emptyHint}
            follow={follow}
            log={log}
            onFollowChange={setFollow}
            showTime={showTime}
          />
          <LogHint log={log} />
        </div>
      )}

      <FullScreenDialog
        className="bg-bg"
        label={title}
        onOpenChange={setFullscreen}
        open={fullscreen}
      >
        <LogToolbar
          follow={follow}
          log={log}
          onFollowChange={setFollow}
          onShowTimeChange={setShowTime}
          showTime={showTime}
          title={title}
          trailing={
            <Hint label="退出全屏">
              <Button
                aria-label="退出全屏"
                className="text-ink-muted hover:bg-subtle hover:text-ink-strong rounded-md"
                onClick={() => {
                  setFullscreen(false);
                }}
                size="icon-sm"
                variant="ghost"
              >
                <Minimize2 data-icon="inline-start" size={16} />
              </Button>
            </Hint>
          }
          variant="full"
        />
        <LogBody
          className="border-border-subtle flex-1 border-t px-4 py-3 text-xs"
          emptyHint={emptyHint}
          follow={follow}
          log={log}
          onFollowChange={setFollow}
          showTime={showTime}
        />
        <LogHint log={log} />
      </FullScreenDialog>
    </>
  );
}

/**
 * 日志框的行头（小窗口与全屏共用一份实现）。两个形态只差排布（紧凑一行 / 全屏 48px 行头）与标题
 * 字号，控件集合一致：会话下拉 → 恢复自动滚动 → 时间显隐 → 刷新 → 调用方给的尾部按钮（全屏 / 退出全屏）。
 */
function LogToolbar({
  variant,
  title,
  log,
  follow,
  onFollowChange,
  showTime,
  onShowTimeChange,
  trailing,
}: {
  follow: boolean;
  log: RuntimeLogController;
  onFollowChange: (next: boolean) => void;
  onShowTimeChange: (next: boolean) => void;
  showTime: boolean;
  title: string;
  trailing: ReactNode;
  variant: "inline" | "full";
}) {
  const full = variant === "full";
  return (
    <div
      className={
        full
          ? "border-border bg-card flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4"
          : "flex items-center justify-between gap-2 px-3 py-2"
      }
    >
      <span
        className={
          full
            ? "text-ink flex min-w-0 items-center gap-2 text-[15px] font-semibold"
            : "text-ink/80 flex min-w-0 items-center gap-2 text-sm font-medium"
        }
      >
        <Hint label={title}>
          <span className="truncate">{title}</span>
        </Hint>
        {log.active && (
          <span className="text-success-strong text-3xs inline-flex shrink-0 items-center gap-1.5 font-normal">
            <StatusDot pulse sizeClass="size-1.5" state="up" />
            跟随中
          </span>
        )}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        {/* 只有一次启动时不给下拉：一个选不出别的东西的下拉只是噪声。 */}
        {log.sessions.length > 1 && (
          <SelectMenu
            aria-label="切换要查看的启动"
            className="text-2xs max-w-55"
            /* 文案用服务端给的 `title`：它已含「时刻 · 退出形态 · runId」
             * （由端点的 `formatRunLabel` 拼好）。视图不再自己格式化一遍 ——
             * 两边各拼一次必然有一边先漂（§12.12）。 */
            labels={Object.fromEntries(log.sessions.map((s) => [s.id, s.title]))}
            onChange={log.selectSession}
            options={log.sessions.map((s) => s.id)}
            value={log.sessionId ?? ""}
          />
        )}
        {!follow && (
          <Button
            className="text-2xs h-auto rounded px-2 py-0.5 font-medium"
            onClick={() => {
              onFollowChange(true);
            }}
            size="xs"
          >
            恢复自动滚动
          </Button>
        )}
        {/* 时间戳显隐：落盘原文带时刻，但盯日志正文时它是干扰。开关只改展示，
            不改文件内容 / 滚动跟随（ISSUE #4631）。 */}
        <Hint label={showTime ? "隐藏每行的时间戳" : "显示每行的时间戳"}>
          <Button
            aria-label={showTime ? "隐藏时间戳" : "显示时间戳"}
            className="text-2xs h-auto gap-1 rounded px-2 py-0.5"
            onClick={() => {
              onShowTimeChange(!showTime);
            }}
            size="xs"
            variant="outline"
          >
            <Clock3 aria-hidden data-icon="inline-start" size={12} />
            {showTime ? "隐藏时间" : "显示时间"}
          </Button>
        </Hint>
        <Button
          className="text-muted-foreground text-2xs h-auto rounded px-2 py-0.5"
          onClick={() => {
            void log.refresh();
          }}
          size="xs"
          variant="outline"
        >
          刷新
        </Button>
        {trailing}
      </div>
    </div>
  );
}

/** 日志正文（带滚动跟随；小窗口与全屏各挂一个实例）。贴底与「用户有没有接管滚动」的判据收在
 * `ui/use-scroll-follow`（规范 16 §16.2.4.24）——收口前这里手写，另有三处各写一份、判据还不一样。
 * 跟随态由父级持有并传下来：小窗口与全屏是**同一份**跟随态，两个实例不能各判各的。 */
function LogBody({
  log,
  follow,
  onFollowChange,
  showTime,
  emptyHint,
  className,
}: {
  className: string;
  emptyHint: ReactNode;
  follow: boolean;
  log: RuntimeLogController;
  onFollowChange: (next: boolean) => void;
  showTime: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const scroller = useScrollFollow({
    containerRef: scrollerRef,
    watch: log.text,
    following: follow,
    onFollowingChange: onFollowChange,
  });
  /* 展示变换只动渲染片段：时间戳按开关剥离；流前缀（[out]/[err]）恒剥——
      Python 的 INFO 也走 stderr，满屏 [err] 是噪声（ISSUE #4699）。
      `watch` 仍用原文，故跟随判据不受影响。 */
  const segments = useMemo(() => {
    const withoutTime = showTime ? log.segments : stripLineTimestamps(log.segments);
    return stripStreamPrefixes(withoutTime);
  }, [log.segments, showTime]);

  return (
    <div
      className={`bg-canvas-deep text-ink-field custom-scrollbar text-2xs overflow-y-auto font-mono leading-relaxed ${className}`}
      onScroll={scroller.onScroll}
      ref={scrollerRef}
    >
      {log.text ? (
        <span className="break-all whitespace-pre-wrap">
          <AnsiLogText segments={segments} />
        </span>
      ) : (
        <span className="text-muted-foreground">{emptyHint}</span>
      )}
    </div>
  );
}

/**
 * 截断 / 尾窗提示。「看不到更早的启动」与「这次启动只显示了一段」都必须有用户可见的出口
 * （硬规则 4）：否则用户会以为日志本来就长这样，转头去猜为什么缺内容。
 * 流前缀（[out]/[err]）的常驻说明已随上游 #4699 在展示层剥离前缀后撤掉。
 */
function LogHint({ log }: { log: RuntimeLogController }) {
  const parts: Array<string> = [];
  if (log.truncated) {
    parts.push("该次启动的输出过长，只显示最近一段。");
  }
  /* 列表被上限裁过：说清「还有更早的」而不是让用户以为「只启动过这些次」。
   * 一次启动一份文件之后同一天可能攒几十份，这条提示比过去更常出现。 */
  if (log.sessions.length < log.total) {
    parts.push(`该服务一共启动过 ${log.total} 次，下拉只列最近 ${log.sessions.length} 次。`);
  }
  return (
    <>
      {/* 流前缀（[out]/[err]）已在展示层剥离（ISSUE #4699）：Python 的 INFO 也走
          stderr，满屏 [err] 是噪声、且常被误读成「在报错」。落盘原文仍带标记，
          导出 / 排查不受影响；崩溃行的 `[exit]` 保留（见 lifecycle-exit）。
          （合并注：此前本检出加过 `hideStream` 按页隐藏该行 —— 上游 #4699 直接
          剥离后该开关失去对象，随冲突解决一并移除。） */}
      {parts.length > 0 ? (
        <p className="text-ink-fainter text-2xs px-3 pb-2 leading-relaxed">{parts.join("")}</p>
      ) : null}
    </>
  );
}
