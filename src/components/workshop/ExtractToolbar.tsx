"use client";

import React from "react";
import {
  ExtractModelSelect,
  parseChannelOption,
} from "@/components/workshop/ExtractModelSelect";
import type { ExtractLogEntry } from "@/lib/workshop/extraction-log";
import { fetchGenerationLogs } from "@/lib/workshop/generation-log-client";
import type { GenerationLogStage } from "@/lib/workshop/generation-log";
import type { PersistableGenerationLog } from "@/lib/workshop/generation-log-client";

/** @deprecated 兼容既有 import：通道类型已迁至 ExtractModelSelect */
export type { ExtractChannel } from "@/components/workshop/ExtractModelSelect";

/** 提取执行日志的展示样式（按日志类型区分色块，不随组件卸载清空）。 */
function logBadge(kind: ExtractLogEntry["kind"]): string {
  switch (kind) {
    case "init":
      return "bg-primary-soft text-primary";
    case "request":
      return "bg-indigo-100 text-indigo-800 dark:text-indigo-300";
    case "output":
      return "bg-emerald-100 text-emerald-800 dark:text-emerald-300";
    case "result":
      return "bg-emerald-100 text-emerald-800 dark:text-emerald-300";
    case "skipped":
      return "bg-amber-100 text-amber-800 dark:text-amber-300";
    case "error":
      return "bg-red-100 text-red-800 dark:text-red-300";
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
   *  log/workshop/ 里落盘的历史日志（跨刷新 / 重启可回看）。 */
  logStage?: GenerationLogStage;
  /** 无剧本文本等情况下禁用提取(导入仍可用) */
  extractDisabled?: boolean;
  extractDisabledReason?: string;
}

/** 剧本提取区块：分组模型下拉（工具/本地/远端）+ 提取按钮 + 外部导入。
 *  选完模型点「提取」即开始；模型通道的提取过程实时展示在下方。 */
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
  const fileRef = React.useRef<HTMLInputElement>(null);

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
        <button
          type="button"
          onClick={onExtract}
          disabled={busy || extractDisabled}
          title={extractDisabled ? extractDisabledReason : undefined}
          className="bg-primary rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-40"
        >
          {busy ? "提取中…" : "提取"}
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="border-border text-primary hover:bg-subtle rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
        >
          外部导入
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={importAccept}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImportFile(file);
            // 允许重复选择同一文件
            event.target.value = "";
          }}
        />
      </div>
      {/* 实时流式输出（提取中单独展示，便于跟随 token 累积） */}
      {busy && progressText && (
        <details className="bg-bg/60 mt-2 rounded-lg px-3 py-2" open>
          <summary className="text-primary cursor-pointer text-[11px] select-none">
            提取过程
          </summary>
          <pre className="text-muted-foreground mt-1 max-h-40 overflow-y-auto text-[11px] leading-relaxed break-all whitespace-pre-wrap">
            {progressText}
          </pre>
        </details>
      )}
      {statusText && !errorText && (
        <p className="text-primary mt-2 text-xs">{statusText}</p>
      )}
      {errorText && (
        <p className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-xs text-red-800 dark:text-red-300">
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
        <details
          className="border-border bg-bg/40 mt-2 rounded-lg border px-3 py-2"
          open={busy}
        >
          <summary className="text-primary flex cursor-pointer items-center gap-2 text-[11px] font-medium select-none">
            <span>执行日志（{executionLog.length} 条）</span>
            {logStage && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  loadHistory();
                }}
                className="text-muted-foreground hover:text-primary text-[10px] font-normal underline underline-offset-2"
              >
                历史
              </button>
            )}
          </summary>
          <ul className="mt-2 space-y-2">
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
                    {new Date(entry.ts).toLocaleTimeString()}
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
                <ul className="mt-1.5 max-h-48 space-y-1.5 overflow-y-auto">
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
                          {new Date(entry.ts).toLocaleTimeString()}
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
        </details>
      )}
    </div>
  );
}

/** 供调用方把选项值还原为通道（保留导出避免散落解析逻辑） */
export { parseChannelOption };
