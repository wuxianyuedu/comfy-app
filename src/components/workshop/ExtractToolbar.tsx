"use client";

import React from "react";
import {
  ExtractModelSelect,
  parseChannelOption,
} from "@/components/workshop/ExtractModelSelect";

/** @deprecated 兼容既有 import：通道类型已迁至 ExtractModelSelect */
export type { ExtractChannel } from "@/components/workshop/ExtractModelSelect";

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
  /** 无剧本文本等情况下禁用提取(导入仍可用) */
  extractDisabled?: boolean;
  extractDisabledReason?: string;
  /** 递增时让下拉重新拉取本地/远端模型清单（设置保存后） */
  refreshKey?: number;
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
  extractDisabled = false,
  extractDisabledReason,
  refreshKey = 0,
}: ExtractToolbarProps) {
  const fileRef = React.useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-xl border border-primary-soft bg-primary-soft/30 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex items-center text-xs font-medium text-primary">
          {title}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ExtractModelSelect value={channelValue} onChange={onChannelValueChange} refreshKey={refreshKey} />
        <button
          type="button"
          onClick={onExtract}
          disabled={busy || extractDisabled}
          title={extractDisabled ? extractDisabledReason : undefined}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-40"
        >
          {busy ? "提取中…" : "提取"}
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-primary transition-colors hover:bg-subtle disabled:opacity-40"
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
      {/* 提取过程：模型通道的流式输出（可折叠的原文预览） */}
      {busy && progressText && (
        <details className="mt-2 rounded-lg bg-bg/60 px-3 py-2" open>
          <summary className="cursor-pointer select-none text-[11px] text-primary">
            提取过程
          </summary>
          <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed text-muted-foreground">
            {progressText}
          </pre>
        </details>
      )}
      {statusText && !errorText && <p className="mt-2 text-xs text-primary">{statusText}</p>}
      {errorText && <p className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-xs text-red-700">{errorText}</p>}
      {extractDisabled && !busy && !errorText && (
        <p className="mt-2 text-[11px] text-muted-foreground">{extractDisabledReason ?? "从剧本提取暂不可用"}</p>
      )}
    </div>
  );
}

/** 供调用方把选项值还原为通道（保留导出避免散落解析逻辑） */
export { parseChannelOption };
