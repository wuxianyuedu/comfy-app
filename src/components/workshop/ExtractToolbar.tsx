"use client";

import { formatClock } from "~/lib/time-format";
import React from "react";
import {
  ExtractModelSelect,
  parseChannelOption,
} from "~/components/workshop/ExtractModelSelect";
import { Button } from "~/components/ui/button";
import { Disclosure } from "~/components/ui/disclosure";
import { useFilePicker } from "~/components/ui/file-picker";
import type { ExtractLogEntry } from "~/lib/workshop/extraction-log";
import { fetchGenerationLogs } from "~/lib/workshop/generation-log-client";
import type { GenerationLogStage } from "~/lib/workshop/generation-log";
import type { PersistableGenerationLog } from "~/lib/workshop/generation-log-client";

/** @deprecated 兼容既有 import：通道类型已迁至 ExtractModelSelect */
export type { ExtractChannel } from "~/components/workshop/ExtractModelSelect";

/** 提取执行日志的展示样式（按日志类型区分色块，不随组件卸载清空）。
 *  状态色全走语义 token（§4.11.1 / P71）：init→primary（品牌）、
 *  request→info（信息/进行中）、output/result→success（有产物）、
 *  skipped→warning（跳过 = 待办）、error→destructive（失败）。 */
function logBadge(kind: ExtractLogEntry["kind"]): string {
  switch (kind) {
    case "init":
      return "bg-primary-soft text-primary";
    case "request":
      return "bg-info/15 text-info-strong";
    case "output":
      return "bg-success/15 text-success-strong";
    case "result":
      return "bg-success/15 text-success-strong";
    case "skipped":
      return "bg-warning/15 text-warning-strong";
    case "error":
      return "bg-destructive/15 text-destructive";
  }
}

function logBadgeLabel(kind: ExtractLogEntry["kind"]): string {
  switch (kind) {
    case "init":
      return "开始";
    case "request":
      return "模型输入";
    case "output":
      return "模型输出";
    case "result":
      return "完成";
    case "skipped":
      return "跳过";
    case "error":
      return "错误";
  }
}

interface ExtractToolbarProps {
  /** 区块标题，如「从剧本提取角色」 */
  title: string;
  /** 完整下拉选项值（tool | local::<model> | remote::<model>） */
  channelValue: string;
  onChannelValueChange: (value: string) => void;
  onExtract: () => void;
  /** 外部导入文件回调(.md/.txt/.json) */
  onImportFile: (file: File) => void;
  importAccept?: string;
  busy: boolean;
  /** 实时提取过程（本地/远端通道时流式回传的模型输出） */
  progressText?: string;
  /** 成功/结果提示 */
  statusText?: string;
  errorText?: string;
  /** 本次提取的结构化执行日志（模型输入/输出/结果/错误），跑完仍展示 */
  executionLog?: ExtractLogEntry[];
  /** 传了环节名（character / storyboard）就提供「历史」入口：按需拉取
   * log/workshop/ 里落盘的历史日志（跨刷新 / 重启可回看）。 */
  logStage?: GenerationLogStage;
  /** 无剧本文本等情况下禁用提取(导入仍可用) */
  extractDisabled?: boolean;
  extractDisabledReason?: string;
}

/** 剧本提取区块：分组模型下拉（工具/本地/远端）+ 提取按钮 + 外部导入。
 * 选完模型点「提取」即开始；模型通道的提取过程实时展示在下方。 */
export function ExtractToolbar({
  title,
  channelValue,
  onChannelValueChange,
  onExtract,
  onImportFile,
  importAccept = ".md,.txt,.json",
  busy,
  progressText,
  statusText,
  errorText,
  executionLog,
  logStage,
  extractDisabled = false,
  extractDisabledReason,
}: ExtractToolbarProps) {
  /* 外部导入选择器：隐藏 input + 选完复位收进`ui/file-picker`。 */
  const importPicker = useFilePicker({
    accept: importAccept,
    onPick: onImportFile,
  });

  /* 执行日志历史（跨刷新 / 重启可回看）：点「历史」按需拉取，不做实时轮询。 */
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [history, setHistory] = React.useState<
    PersistableGenerationLog[] | null
  >(null);
  const loadHistory = () => {
    if (!logStage) return;
    setHistoryOpen(true);
    if (history) return;
    void fetchGenerationLogs(logStage, 100).then(setHistory);
  };

  return (
    <div className="border-primary-soft bg-primary-soft/30 rounded-xl border p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-primary flex items-center text-xs font-medium">
          {title}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ExtractModelSelect
          value={channelValue}
          onChange={onChannelValueChange}
        />
        <Button
          variant="primary-solid"
          size="xs"
          onClick={onExtract}
          disabled={busy || extractDisabled}
          title={extractDisabled ? extractDisabledReason : undefined}
          className="h-auto rounded-lg px-3 py-1.5"
        >
          {busy ? "提取中…" : "提取"}
        </Button>
        <Button
          variant="outline"
          size="xs"
          onClick={importPicker.open}
          disabled={busy}
          className="border-border text-primary hover:bg-subtle h-auto rounded-lg px-3 py-1.5"
        >
          外部导入
        </Button>
        <importPicker.Input />
      </div>
      {/* 实时流式输出（提取中单独展示，便于跟随 token 累积） */}
      {busy && progressText && (
        <Disclosure
          defaultOpen
          marker="caret"
          className="text-primary bg-bg/60 mt-2 rounded-lg px-3 py-2 text-[11px]"
          trigger="提取过程"
        >
          <pre className="text-muted-foreground mt-1 max-h-40 overflow-y-auto text-[11px] leading-relaxed break-all whitespace-pre-wrap">
            {progressText}
          </pre>
        </Disclosure>
      )}
      {statusText && !errorText && (
        <p className="text-primary mt-2 text-xs">{statusText}</p>
      )}
      {errorText && (
        <p className="bg-destructive/10 text-destructive mt-2 rounded-lg px-3 py-2 text-xs">
          {errorText}
        </p>
      )}
      {extractDisabled && !busy && !errorText && (
        <p className="text-muted-foreground mt-2 text-[11px]">
          {extractDisabledReason ?? "从剧本提取暂不可用"}
        </p>
      )}

      {/* 结构化执行日志：完整记录一次提取从发起→输入→输出→结果的每一步，
 无论是否还在 busy 都保留展示，方便追溯模型到底做了什么（黑盒透明化）。 */}
      {executionLog && executionLog.length > 0 && (
        /* 「历史」是并列动作而非折叠开关 —— 见`Disclosure` 文件头：
         * 基元 trigger 已是`<button>`，嵌套按钮非法（旧写法靠
         *`stopPropagation` 掩盖），故「开关 + 并列动作」一行排布。 */
        <div className="border-border bg-bg/40 mt-2 rounded-lg border px-3 py-2">
          <div className="text-primary flex items-center gap-2 text-[11px] font-medium">
            <Disclosure
              open={busy ? true : undefined}
              marker="caret"
              panelClassName="text-[11px]"
              trigger={`执行日志（${executionLog.length} 条）`}
            >
              <ul className="mt-2 flex flex-col gap-2">
                {executionLog.map((entry, i) => (
                  <li
                    key={`${entry.ts}-${i}`}
                    className="bg-surface rounded-lg px-2.5 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${logBadge(entry.kind)}`}
                      >
                        {logBadgeLabel(entry.kind)}
                      </span>
                      <span className="text-muted-foreground min-w-0 flex-1 truncate text-[11px] leading-relaxed">
                        {entry.summary}
                      </span>
                      <span className="text-muted-foreground/60 shrink-0 text-[10px]">
                        {formatClock(entry.ts)}
                      </span>
                    </div>
                    {entry.detail && (
                      <pre className="bg-bg/70 text-ink-subtle mt-1.5 max-h-32 overflow-y-auto rounded px-2 py-1.5 text-[10.5px] leading-relaxed break-all whitespace-pre-wrap">
                        {entry.detail}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            </Disclosure>
            {logStage && (
              <Button
                variant="link"
                onClick={() => loadHistory()}
                className="text-muted-foreground hover:text-primary h-auto shrink-0 p-0 text-[10px] font-normal underline underline-offset-2"
              >
                历史
              </Button>
            )}
          </div>
          {logStage && historyOpen && (
            <div className="border-border/60 mt-2 border-t pt-2">
              <p className="text-muted-foreground text-[10px]">
                历史日志（含此前会话，保存在 log/workshop/）
              </p>
              {history === null ? (
                <p className="text-muted-foreground text-[10.5px]">加载中…</p>
              ) : history.length === 0 ? (
                <p className="text-muted-foreground text-[10.5px]">
                  还没有落盘的历史日志。
                </p>
              ) : (
                <ul className="mt-1.5 flex max-h-48 flex-col gap-1.5 overflow-y-auto">
                  {history.map((entry, i) => (
                    <li
                      key={`${entry.ts}-${i}`}
                      className="bg-surface rounded-lg px-2.5 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="bg-primary-soft text-primary rounded px-1.5 py-0.5 text-[10px] font-medium">
                          {entry.kind}
                        </span>
                        <span className="text-muted-foreground min-w-0 flex-1 truncate text-[11px] leading-relaxed">
                          {entry.summary}
                        </span>
                        <span className="text-muted-foreground/60 shrink-0 text-[10px]">
                          {formatClock(entry.ts)}
                        </span>
                      </div>
                      {entry.detail && (
                        <pre className="bg-bg/70 text-ink-subtle mt-1.5 max-h-32 overflow-y-auto rounded px-2 py-1.5 text-[10.5px] leading-relaxed break-all whitespace-pre-wrap">
                          {entry.detail}
                        </pre>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 供调用方把选项值还原为通道（保留导出避免散落解析逻辑） */
export { parseChannelOption };
