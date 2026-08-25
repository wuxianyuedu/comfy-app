"use client";
import { useEffect, useMemo } from "react";
import { JsonViewer } from "./JsonViewer";

/**
 * 查看 JSON 源文件弹窗（单一格式）。
 *
 * 2026-08-25 简化：工作流现在只有一种格式（可执行 graph），移除原先的
 * RAW / API 双 tab 与「节点画布」tab，仅展示 graph 一份 JSON。下载也只导出
 * 这一种格式。
 */
export interface SourceModalData {
  /** 工作流名（标题、副标题都用） */
  name: string;
  /** 单一格式 — 可执行 graph（`{ [nodeId]: { class_type, inputs, widgets_values, ... } }`） */
  graph: unknown;
  /** 当前 detail 是否来自子工作流 (drill-in 进 sub) 视图。用于文案区分。 */
  isSubgraph?: boolean;
}

export interface SourceModalProps {
  data: SourceModalData | null;
  /** 仓库已经加载好的视图 — 等待期间显示 loading */
  loading?: boolean;
  /** 加载/解析失败时显示 */
  error?: string;
  onClose: () => void;
}

export function SourceModal({ data, loading, error, onClose }: SourceModalProps) {
  const activeText = useMemo(() => {
    if (!data) return "";
    return JSON.stringify(data.graph ?? null, null, 2);
  }, [data]);

  const downloadCurrent = () => {
    if (!data || !activeText) return;
    const blob = new Blob([activeText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* Esc 关闭（即便焦点在 JsonViewer 搜索框也关闭）。 */
  useEffect(() => {
    if (!data) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [data, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#12101c] shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-white/[0.08] px-5 py-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-100">
              查看源文件 · {data?.name ?? "—"}
              <span
                title="单一格式：detail.graph —— ComfyUI /prompt 用的执行图（节点字典 {nodeId: {class_type, inputs, widgets_values}}）"
                className="rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/40"
              >
                JSON
              </span>
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {data?.isSubgraph
                ? "当前为子工作流的可执行格式（节点字典视图）"
                : "该工作流为单一格式 — 显示可执行 JSON 视图"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 transition-colors hover:text-gray-300"
            title="关闭"
          >
            ✕
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 border-b border-white/[0.08] px-5 py-2">
          <span className="flex-1" />
          <button
            type="button"
            onClick={downloadCurrent}
            disabled={!activeText}
            className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/5 disabled:opacity-40"
          >
            下载当前
          </button>
        </div>

        {/* Body — JsonViewer 自带语法着色 / 折叠 / 搜索 / 滚动。 */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {loading ? (
            <p className="px-5 py-3 text-sm text-gray-500">加载中…</p>
          ) : error ? (
            <p className="px-5 py-3 text-sm text-red-400">{error}</p>
          ) : !data ? (
            <p className="px-5 py-3 text-sm text-gray-500">没有可显示的数据</p>
          ) : (
            <JsonViewer
              key="single"
              data={data.graph as never}
              title="JSON 格式"
              initialCollapsedDepth={1}
            />
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-white/[0.08] px-5 py-2.5">
          <p className="text-xs text-gray-500">
            下载 = 导出当前 JSON · ⌘/Ctrl+F 在视图内搜索 · 点击 chevron 折叠/展开
          </p>
        </div>
      </div>
    </div>
  );
}
