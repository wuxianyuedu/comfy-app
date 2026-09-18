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

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize2, Minimize2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import { StatusDot } from "~/components/ui/status-dot";
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
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setFullscreen(true)}
                title="全屏查看"
                aria-label="全屏查看"
                className="text-ink-muted hover:bg-subtle hover:text-ink-strong rounded-md"
              >
                <Maximize2 size={14} />
              </Button>
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
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setFullscreen(false)}
              title="退出全屏"
              aria-label="退出全屏"
              className="text-ink-muted hover:bg-subtle hover:text-ink-strong rounded-md"
            >
              <Minimize2 size={16} />
            </Button>
          }
        />
        <LogBody
          log={log}
          follow={follow}
          onFollowChange={setFollow}
          emptyHint={emptyHint}
          className="border-border-subtle flex-1 border-t px-4 py-3 text-[12px]"
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
          <span className="text-success-strong inline-flex shrink-0 items-center gap-1.5 text-[10px] font-normal">
            <StatusDot state="up" sizeClass="size-1.5" pulse />
            跟随中
          </span>
        )}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        {/* 只有一次启动时不给下拉：一个选不出别的东西的下拉只是噪声。 */}
        {log.sessions.length > 1 && (
          <select
            value={log.sessionId ?? ""}
            onChange={(event) => log.selectSession(event.target.value)}
            aria-label="切换要查看的启动"
            title="切换要查看的启动"
            className="border-border bg-surface-2 text-ink focus:border-primary max-w-55 truncate rounded-md border px-2 py-0.5 text-[11px] outline-none"
          >
            {log.sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {formatSessionLabel(session)}
              </option>
            ))}
          </select>
        )}
        {!follow && (
          <Button
            size="xs"
            onClick={() => onFollowChange(true)}
            className="h-auto rounded px-2 py-0.5 text-[11px] font-medium"
          >
            恢复自动滚动
          </Button>
        )}
        <Button
          variant="outline"
          size="xs"
          onClick={() => void log.refresh()}
          className="text-muted-foreground h-auto rounded px-2 py-0.5 text-[11px]"
        >
          刷新
        </Button>
        {trailing}
      </div>
    </div>
  );
}

/** 日志正文（带滚动跟随；小窗口与全屏各挂一个实例）。 */
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
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [log.text, follow]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    /* 贴底 32px 内即视为「仍在跟随」：用户上滚一点不该立刻掉出跟随态。 */
    onFollowChange(el.scrollHeight - el.scrollTop - el.clientHeight < 32);
  };

  return (
    <div
      ref={scrollerRef}
      onScroll={onScroll}
      className={`bg-canvas-deep text-ink-field custom-scrollbar overflow-y-auto font-mono text-[11px] leading-relaxed ${className}`}
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
