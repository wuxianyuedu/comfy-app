"use client";
import { useEffect, useMemo } from "react";
import { JsonViewer } from "~/components/ui/json-viewer";
import { Button } from "~/components/ui/button";
import { overlayClass } from "~/lib/full-screen-layer";
import { zClass } from "~/lib/shell/overlay-z";

/**
 * 查看源文件弹窗（只读）。
 *
 * 之前这里展示的是 `detail.graph`（`/prompt` 用的可执行图，节点
 * 字典 `{nodeId: {class_type, inputs, ...}}`），并不是磁盘上的源文件内容 —— 用户
 * 点「查看源文件」期望看到的是 ComfyUI 保存的原始 JSON（`last_node_id` /
 * `nodes[]` / `widgets_values` …）。改为直接展示 `rawJson`；纯 API 导入（本来
 * 就没有原件）的工作流才回退到 API 图，并在副标题里写明。
 *
 * 「API 兜底」只是**来源**标签，不是「降级」：两种格式都能执行，这里只是说这一
 * 条工作流的原件是 API 格式。
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

export function SourceModal({
  data,
  loading,
  error,
  onClose,
}: SourceModalProps) {
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
      className={overlayClass(
        "modal",
        `${zClass("modal")} flex items-center justify-center bg-black/25 p-4 backdrop-blur-sm dark:bg-black/60`,
      )}
      onClick={onClose}
    >
      <div
        className="border-border-strong bg-panel flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border shadow-2xl shadow-black/12 dark:shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="border-border-strong flex items-start justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-ink-bright flex items-center gap-2 text-sm font-semibold">
              查看源文件 · {data?.name ?? "—"}
              <span
                title={
                  data?.isApiFallback
                    ? "该工作流的原件就是 API 格式（没有工作流(RAW)原件），当前显示的是它的 API 图"
                    : "ComfyUI 原始 JSON（nodes[] / links[] / widgets_values）"
                }
                className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide ring-1 ${
                  data?.isApiFallback
                    ? "bg-amber-500/20 text-amber-700 ring-amber-500/40 dark:text-amber-300"
                    : "bg-cyan-500/20 text-cyan-700 ring-cyan-500/40 dark:text-cyan-300"
                }`}
              >
                {data?.isApiFallback ? "API 原件" : "RAW 原件"}
              </span>
            </h2>
            <p className="text-ink-muted mt-0.5 text-xs">
              {data?.isSubgraph
                ? "当前为子工作流的源文件内容"
                : data?.isApiFallback
                  ? "API 格式导入，原件即 API 图（两种格式地位同等，都能执行）"
                  : "工作流(RAW)格式导入，显示磁盘上的原始文件内容，未做任何转换"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            className="text-ink-muted hover:text-ink-soft"
            title="关闭"
          >
            ✕
          </Button>
        </div>

        {/* Actions */}
        <div className="border-border-strong flex items-center gap-3 border-b px-5 py-2">
          <span className="flex-1" />
          <Button
            variant="outline"
            size="xs"
            onClick={downloadCurrent}
            disabled={!activeText}
            className="border-border-strong text-ink-soft hover:bg-subtle h-auto rounded-md px-3 py-1.5"
          >
            下载当前
          </Button>
        </div>

        {/* Body — JsonViewer 自带语法着色 / 折叠 / 搜索 / 滚动。 */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {loading ? (
            <p className="text-ink-muted px-5 py-3 text-sm">加载中…</p>
          ) : error ? (
            <p className="px-5 py-3 text-sm text-red-700 dark:text-red-400">
              {error}
            </p>
          ) : data?.source == null ? (
            <p className="text-ink-muted px-5 py-3 text-sm">没有可显示的数据</p>
          ) : (
            <JsonViewer
              key="source"
              data={data.source}
              title={data.isApiFallback ? "API 格式" : "工作流(RAW)格式"}
              initialCollapsedDepth={1}
            />
          )}
        </div>

        {/* Footer */}
        <div className="border-border-strong border-t px-5 py-2.5">
          <p className="text-ink-muted text-xs">
            下载 = 导出当前 JSON · ⌘/Ctrl+F 在视图内搜索 · 点击 chevron
            折叠/展开
          </p>
        </div>
      </div>
    </div>
  );
}
