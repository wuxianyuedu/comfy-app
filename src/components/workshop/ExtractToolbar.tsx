"use client";

import React from "react";
import { Icon } from "@/components/ui/Icon";

/** 提取通道:①工具(内置规则) ②本地模型(provider=local) ③配置API(provider=remote) */
export type ExtractChannel = "tool" | "local" | "remote";

const CHANNELS: { value: ExtractChannel; label: string; title: string }[] = [
  { value: "tool", label: "工具", title: "内置规则解析剧本结构,不调用模型" },
  { value: "local", label: "本地模型", title: "走 LLM provider=local(Ollama / LM Studio)" },
  { value: "remote", label: "配置 API", title: "走 LLM provider=remote(OpenAI 兼容)" },
];

interface ExtractToolbarProps {
  channel: ExtractChannel;
  onChannelChange: (channel: ExtractChannel) => void;
  /** 提取按钮文案,如「从剧本提取角色」 */
  extractLabel: string;
  onExtract: () => void;
  /** 外部导入文件回调(.md/.txt/.json) */
  onImportFile: (file: File) => void;
  importAccept?: string;
  busy: boolean;
  /** 进行态提示(按钮与状态行共用) */
  busyText?: string;
  /** 成功/结果提示 */
  statusText?: string;
  errorText?: string;
  /** 无剧本文本等情况下禁用提取(导入仍可用) */
  extractDisabled?: boolean;
  extractDisabledReason?: string;
}

/** 剧本提取工具条:通道三选一 + 从剧本提取 + 外部导入,含进行态/结果/错误展示 */
export function ExtractToolbar({
  channel,
  onChannelChange,
  extractLabel,
  onExtract,
  onImportFile,
  importAccept = ".md,.txt,.json",
  busy,
  busyText,
  statusText,
  errorText,
  extractDisabled = false,
  extractDisabledReason,
}: ExtractToolbarProps) {
  const fileRef = React.useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-xl border border-primary-soft bg-primary-soft/30 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="flex items-center text-xs font-medium text-primary">
          <Icon name="sparkles" size={13} className="mr-1 inline align-[-2px]" />
          剧本提取
        </span>
        <div className="flex overflow-hidden rounded-lg border border-border" role="group" aria-label="提取通道">
          {CHANNELS.map((ch) => (
            <button
              key={ch.value}
              type="button"
              title={ch.title}
              onClick={() => onChannelChange(ch.value)}
              className={`px-2.5 py-1 text-xs transition-colors ${
                channel === ch.value ? "bg-primary text-white" : "bg-bg text-muted hover:text-ink"
              }`}
            >
              {ch.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onExtract}
          disabled={busy || extractDisabled}
          title={extractDisabled ? extractDisabledReason : undefined}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-40"
        >
          {busy ? (busyText ?? "提取中…") : extractLabel}
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
      {busy && busyText && <p className="mt-2 text-xs text-primary">{busyText}</p>}
      {statusText && !errorText && <p className="mt-2 text-xs text-primary">{statusText}</p>}
      {errorText && <p className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-xs text-red-700">{errorText}</p>}
      {extractDisabled && !busy && !errorText && (
        <p className="mt-2 text-[11px] text-muted">{extractDisabledReason ?? "从剧本提取暂不可用"}</p>
      )}
    </div>
  );
}
