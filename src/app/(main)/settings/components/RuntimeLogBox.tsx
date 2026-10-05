"use client";

/**
 * RuntimeLogBox —— 设置页「启动日志」框（ComfyUI / Drizzle Studio / Ollama 共用）。
 *
 * 三个分区此前各自内联了一份 40 行的同款 JSX（标题 + 跟随中徽标 + 刷新按钮 +
 * 固定 `max-h-44` 的滚动框），改口径要改三处。这里收成一处，并把两件事补齐：
 *
 *   1. **切换每次启动**：`log.sessions` 是服务端按会话横幅切出来的（见
 *      `lib/log/log-sessions`），下拉只在真的有多次启动时出现 —— 多次启动
 *      不再混在一条时间线上，用户能回看某一次启动到底输出了什么；
 *   2. **全屏查看**：小窗口只有 176px 高，长输出读起来很憋（用户反馈）。
 *      全屏走 `ui/fullscreen-dialog`（铺满标题行下方的内容区），右上角带同一个
 *      下拉与刷新，因此「全屏看」不是另一套只读视图。
 *
 * 视图只渲染：正文 / 片段 / 会话列表 / 选中项都来自 controller（§17 UI 与逻辑分离）。
 */

import { useRef, useState, type ReactNode } from "react";
import { Maximize2, Minimize2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { StatusDot } from "~/components/ui/status-dot";
import { SelectMenu } from "~/components/ui/select-menu";
import { useScrollFollow } from "~/components/ui/use-scroll-follow";
import { FullScreenDialog } from "~/components/ui/fullscreen-dialog";
import { formatSessionLabel } from "~/lib/log/log-sessions";
import { cn } from "~/lib/utils";

import type { RuntimeLogController } from "../hooks/use-runtime-log-source";
import { AnsiLogText } from "./SettingsPrimitives";

export interface RuntimeLogBoxProps {
  /** 日志文件名（标题里显示，如 `comfyui-runtime.log`）。 */
  fileName: string;
  /** 日志来源：正文 / 片段 / 会话列表 / 选中项 / 跟随态 / 刷新动作。 */
  log: RuntimeLogController;
  /** 空态提示（引导用户点启动按钮或刷新）。 */
  emptyHint: ReactNode;
  /** 外框的补充 class（各分区与上方元素之间的间距不同）。 */
  className?: string;
}

export function RuntimeLogBox({
  fileName,
  log,
  emptyHint,
  className,
}: RuntimeLogBoxProps) {
  const [fullscreen, setFullscreen] = useState(false);
  /* 滚动跟随是纯视觉偏好，留在视图层（三个分区此前各持一份，现已合并）。 */
  const [follow, setFollow] = useState(true);

  const title = `启动日志（${fileName}）`;

  return (
    <>
      {/* 全屏时整块小窗口都不渲染：同一段日志渲染两份既费 DOM、又会出现两个
          同名的会话下拉（读屏器与测试都分不清该操作哪一个）。 */}
      {!fullscreen && (
        <div
          className={cn(
            "border-border bg-surface-1 mb-4 rounded-xl border",
            className,
          )}
        >
          <LogToolbar
            variant="inline"
            title={title}
            log={log}
            follow={follow}
            onFollowChange={setFollow}
            trailing={
              <Hint label="全屏查看">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setFullscreen(true)}
                  aria-label="全屏查看"
                  className="text-ink-muted hover:bg-subtle hover:text-ink-strong rounded-md"
                >
                  <Maximize2 data-icon="inline-start" size={14} />
                </Button>
              </Hint>
            }
          />
          <LogBody
            log={log}
            follow={follow}
            onFollowChange={setFollow}
            emptyHint={emptyHint}
            className="border-border-subtle mx-3 mb-3 max-h-44 rounded-lg border px-3 py-2"
          />
          <LogHint log={log} />
        </div>
      )}

      <FullScreenDialog
        open={fullscreen}
        onOpenChange={setFullscreen}
        label={title}
        className="bg-bg"
      >
        <LogToolbar
          variant="full"
          title={title}
          log={log}
          follow={follow}
          onFollowChange={setFollow}
          trailing={
            <Hint label="退出全屏">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setFullscreen(false)}
                aria-label="退出全屏"
                className="text-ink-muted hover:bg-subtle hover:text-ink-strong rounded-md"
              >
                <Minimize2 data-icon="inline-start" size={16} />
              </Button>
            </Hint>
          }
        />
        <LogBody
          log={log}
          follow={follow}
          onFollowChange={setFollow}
          emptyHint={emptyHint}
          className="border-border-subtle flex-1 border-t px-4 py-3 text-xs"
        />
        <LogHint log={log} />
      </FullScreenDialog>
    </>
  );
}

/**
 * 日志框的行头（小窗口与全屏共用一份实现）。
 *
 * 两个形态只差排布（紧凑一行 / 全屏的 48px 行头）与标题字号，控件集合一致：
 * 会话下拉 → 恢复自动滚动 → 刷新 → 调用方给的尾部按钮（全屏 / 退出全屏）。
 */
function LogToolbar({
  variant,
  title,
  log,
  follow,
  onFollowChange,
  trailing,
}: {
  variant: "inline" | "full";
  title: string;
  log: RuntimeLogController;
  follow: boolean;
  onFollowChange: (next: boolean) => void;
  trailing: ReactNode;
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
        <span className="truncate" title={title}>
          {title}
        </span>
        {log.active && (
          <span className="text-success-strong text-3xs inline-flex shrink-0 items-center gap-1.5 font-normal">
            <StatusDot state="up" sizeClass="size-1.5" pulse />
            跟随中
          </span>
        )}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        {/* 只有一次启动时不给下拉：一个选不出别的东西的下拉只是噪声。 */}
        {log.sessions.length > 1 && (
          <SelectMenu
            value={log.sessionId ?? ""}
            onChange={log.selectSession}
            options={log.sessions.map((s) => s.id)}
            labels={Object.fromEntries(
              log.sessions.map((s) => [s.id, formatSessionLabel(s)]),
            )}
            aria-label="切换要查看的启动"
            className="text-2xs max-w-55"
          />
        )}
        {!follow && (
          <Button
            size="xs"
            onClick={() => onFollowChange(true)}
            className="text-2xs h-auto rounded px-2 py-0.5 font-medium"
          >
            恢复自动滚动
          </Button>
        )}
        <Button
          variant="outline"
          size="xs"
          onClick={() => void log.refresh()}
          className="text-muted-foreground text-2xs h-auto rounded px-2 py-0.5"
        >
          刷新
        </Button>
        {trailing}
      </div>
    </div>
  );
}

/** 日志正文（带滚动跟随；小窗口与全屏各挂一个实例）。
 *
 * 贴底与「用户有没有接管滚动」的判据收在 `ui/use-scroll-follow`
 *（规范 16 §16.2.4.24）—— 收口前它在这里手写，另有三处在别处各写一份、
 * 判据还不一样。跟随态由父级持有并传下来：小窗口与全屏是**同一份**跟随态，
 * 两个实例不能各判各的（切进去时应仍是「已暂停」）。 */
function LogBody({
  log,
  follow,
  onFollowChange,
  emptyHint,
  className,
}: {
  log: RuntimeLogController;
  follow: boolean;
  onFollowChange: (next: boolean) => void;
  emptyHint: ReactNode;
  className: string;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const scroller = useScrollFollow({
    containerRef: scrollerRef,
    watch: log.text,
    following: follow,
    onFollowingChange: onFollowChange,
  });

  return (
    <div
      ref={scrollerRef}
      onScroll={scroller.onScroll}
      className={`bg-canvas-deep text-ink-field custom-scrollbar text-2xs overflow-y-auto font-mono leading-relaxed ${className}`}
    >
      {log.text ? (
        <span className="break-all whitespace-pre-wrap">
          <AnsiLogText segments={log.segments} />
        </span>
      ) : (
        <span className="text-muted-foreground">{emptyHint}</span>
      )}
    </div>
  );
}

/**
 * 截断 / 尾窗提示。
 *
 * 「看不到更早的启动」与「这次启动只显示了一段」都必须有用户可见的出口
 * （硬规则 4）：否则用户会以为日志本来就长这样，转头去猜为什么缺内容。
 */
function LogHint({ log }: { log: RuntimeLogController }) {
  const parts: string[] = [];
  if (log.truncated) parts.push("该次启动的输出过长，只显示最近一段。");
  if (log.windowed) parts.push("日志文件较大，更早的启动不在下拉列表里。");
  if (parts.length === 0) return null;
  return (
    <p className="text-ink-fainter px-3 pb-2 text-[10.5px] leading-relaxed">
      {parts.join("")}
    </p>
  );
}
