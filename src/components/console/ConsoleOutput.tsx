"use client";

// 控制台输出区（视图第③层，纯展示）。
//
// 为什么把「输出」单独一个文件：它是**要跟着输出长**的那一块，贴底、滚动、
// 着色三件事都要在这一块里定；把它们和输入框、预设列表混在一个文件里，
// 改「贴底」时得在一屏 300 行 JSX 里找那三行。
//
// 着色口径（与真实终端一致，且是**唯一**一处判据）：整体的 stdout 用
// `text-ink-strong`，stderr 不单独染色（stderr 不等于错误 —— `pnpm` 的进度条、
// Python 的 warning 全走 stderr，整段染红会让「真的报错」淹在红里）。
// 真正的失败信号是最后那行 `[进程已退出，退出码 N]` 与结论条，它们由调用方给。

import { useRef } from "react";
import { AlertTriangle, CheckCircle2, Terminal } from "lucide-react";

import { Spinner } from "~/components/ui/spinner";
import { useScrollFollow } from "~/components/ui/use-scroll-follow";
import { cn } from "~/lib/utils";

export interface ConsoleOutputProps {
  output: string;
  /** 是否有一条在跑（决定底部的转圈与提示）。 */
  running: boolean;
  /** 空态提示。 */
  emptyHint: string;
  /** 结论条（null = 还没结论）。 */
  verdict: string | null;
  /** 结论是否为成功（决定图标与颜色）。 */
  verdictOk: boolean;
  /** 被停止（而不是失败）：图标与文案换一档。 */
  stopped: boolean;
}

export function ConsoleOutput({
  output,
  running,
  emptyHint,
  verdict,
  verdictOk,
  stopped,
}: ConsoleOutputProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  /* 贴底走全库唯一实现（`ui/use-scroll-follow`，规范 16 §16.2.4.24）：
   * 「用户往上滚会不会被拽回去」此前四个面板各判各的，这里不再写第五份。 */
  const follow = useScrollFollow({
    containerRef: scrollerRef,
    watch: output,
    following: true,
  });

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollerRef}
        onScroll={follow.onScroll}
        className="bg-canvas-deep custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3"
        role="log"
        aria-live="polite"
        aria-label="控制台输出"
      >
        {output ? (
          <pre className="text-ink-strong font-mono text-[12.5px] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap">
            {output}
          </pre>
        ) : (
          <div className="text-ink-fainter flex h-full flex-col items-center justify-center gap-2 text-[13px]">
            {running ? (
              <>
                <Spinner className="size-5 opacity-60" />
                <span>命令已提交，等待输出…</span>
              </>
            ) : (
              <>
                <Terminal size={32} strokeWidth={1.5} className="opacity-30" />
                <span>{emptyHint}</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* 结论条：跑完 / 被停才有。它是「这次到底成没成」的唯一出口
          （硬规则 4：失败路径必须有用户可见出口）—— 只看输出末尾几行
          是判不出成败的。 */}
      {verdict && (
        <div
          data-testid="console-verdict"
          className={cn(
            "flex shrink-0 items-center gap-2 border-t px-4 py-2 text-[12.5px]",
            stopped
              ? "border-border bg-warning/10 text-warning-strong"
              : verdictOk
                ? "border-border bg-success/10 text-success-strong"
                : "border-border bg-destructive/10 text-danger-strong",
          )}
        >
          {stopped ? (
            <AlertTriangle size={14} />
          ) : verdictOk ? (
            <CheckCircle2 size={14} />
          ) : (
            <AlertTriangle size={14} />
          )}
          <span className="min-w-0 truncate" title={verdict}>
            {verdict}
          </span>
        </div>
      )}
    </div>
  );
}
