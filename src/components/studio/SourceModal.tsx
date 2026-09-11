"use client";
import { useEffect, useMemo } from "react";
import { JsonViewer } from "./ui/JsonViewer";
import { overlayClass } from "~/lib/full-screen-layer";

/**
 * 查看源文件弹窗（只读）。
 *
 * 之前这里展示的是 `detail.graph`（`/prompt` 用的可执行图，节点
 * 字典 `{nodeId: {class_type, inputs, ...}}`），并不是磁盘上的源文件内容 —— 用户
 * 点「查看源文件」期望看到的是 ComfyUI 保存的原始 JSON（`last_node_id` /
 * `nodes[]` / `widgets_values` …）。改为直接展示 `rawJson`；纯 API 导入（没有
 * rawJson）的工作流才回退到 graph，并在副标题里写明。
 */
export interface SourceModalData {
  /** 工作流名（标题用） */
  name: string;
  /** 磁盘上的原始导入 JSON（ComfyUI UI 格式）。null 表示纯 API 导入。 */
  source: unknown;
  /** 当前 detail 是否来自子工作流 (drill-in 进 sub) 视图。用于文案区分。 */
  isSubgraph?: boolean;
  /** true = 该工作流没有原始格式，当前展示的是可执行图兜底。 */
  isApiFallback?: boolean;
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
    if (data?.source == null) return "";
    return JSON.stringify(data.source, null, 2);
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
      className={overlayClass("modal", "z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm")}
      onClick={onClose}
    >
      <div
        className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#12101c] shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-white/8 px-5 py-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-100">
              查看源文件 · {data?.name ?? "—"}
              <span
                title={
                  data?.isApiFallback
                    ? "该工作流是纯 API 格式导入，没有原始文件；当前显示的是可执行图"
                    : "ComfyUI 原始 JSON（nodes[] / links[] / widgets_values）"
                }
                className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide ring-1 ${
                  data?.isApiFallback
                    ? "bg-amber-500/20 text-amber-300 ring-amber-500/40"
                    : "bg-cyan-500/20 text-cyan-300 ring-cyan-500/40"
                }`}
              >
                {data?.isApiFallback ? "API 兜底" : "源文件内容"}
              </span>
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {data?.isSubgraph
                ? "当前为子工作流的源文件内容"
                : data?.isApiFallback
                  ? "纯 API 导入，无原始文件 — 显示可执行图作为兜底"
                  : "显示磁盘上的原始导入文件内容，未做任何转换"}
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
        <div className="flex items-center gap-3 border-b border-white/8 px-5 py-2">
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
          ) : data?.source == null ? (
            <p className="px-5 py-3 text-sm text-gray-500">没有可显示的数据</p>
          ) : (
            <JsonViewer
              key="source"
              data={data.source}
              title={data.isApiFallback ? "API 格式（兜底）" : "源文件内容"}
              initialCollapsedDepth={1}
            />
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-white/8 px-5 py-2.5">
          <p className="text-xs text-gray-500">
            下载 = 导出当前 JSON · ⌘/Ctrl+F 在视图内搜索 · 点击 chevron 折叠/展开
          </p>
        </div>
      </div>
    </div>
  );
}
