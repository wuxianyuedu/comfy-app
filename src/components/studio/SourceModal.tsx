"use client";
import { useMemo } from "react";
import { Hint } from "~/components/ui/hint";
import { JsonViewer } from "~/components/ui/json-viewer";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { downloadText } from "~/lib/browser-io";
import { displayValue } from "~/lib/display-value";

/* "RAW 原件"格式标签 cyan——是**文件格式类型**的身份色(与"这是 ComfyUI 原始
 * JSON"的事实绑定),不是状态、也不是 info(信息态)。没有 format-* 语义
 * token → §3.6.1 例外块。 */
// p71-allow:start "RAW 原件"格式标签 cyan——文件格式类型身份、非状态、无匹配 token
const RAW_FORMAT_CHIP =
  "rounded bg-cyan-500/20 px-1.5 py-0.5 font-mono text-3xs font-semibold tracking-wide text-cyan-700 ring-1 ring-cyan-500/40 dark:text-cyan-300";
// p71-allow:end

/**
 * 查看源文件弹窗（只读）。
 *
 * 展示的是 ComfyUI 保存的原始 JSON（`last_node_id` / `nodes[]` /
 * `widgets_values` …）—— 也就是库里的 `rawJson` 列。本应用只接受这一种格式，
 * 所以没有「另一种格式的兜底」这回事。
 */
export interface SourceModalData {
  /** 工作流名（标题用） */
  name: string;
  /** 磁盘上的原始导入 JSON（ComfyUI 工作流格式）。 */
  source: unknown;
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
    downloadText(activeText, `${data.name}.json`);
  };

  /* 关闭语义（Esc / 点遮罩）交给 `ui/dialog`：此前手写 Esc 的 keydown
     监听 + 自绘遮罩 `onClick`，焦点也不会锁在弹窗内、关闭后不归还。
     `open={data !== null}` 与调用方的条件渲染同义，多一层兜底。 */
  return (
    <Dialog open={data !== null} onOpenChange={(next) => !next && onClose()}>
      {/* 关闭按钮由下面的 header 自绘 —— 必须关掉基元的内置那枚，
          否则会渲染出两枚重叠的 ✕（见 `ui/dialog` 的 `showCloseButton`）。 */}
      <DialogContent
        aria-label="查看源文件"
        showCloseButton={false}
        className="bg-transparent p-0 ring-0"
        popupClassName="max-w-3xl"
      >
        <div className="border-border-strong bg-panel flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border shadow-2xl shadow-black/12 dark:shadow-black/60">
          {/* Header */}
          <div className="border-border-strong flex items-start justify-between border-b px-5 py-3">
            <div>
              <h2 className="text-ink-bright flex items-center gap-2 text-sm font-semibold">
                查看源文件 · {displayValue(data?.name)}
                <span
                  title="ComfyUI 原始 JSON（nodes[] / links[] / widgets_values）"
                  className={RAW_FORMAT_CHIP}
                >
                  RAW 原件
                </span>
              </h2>
              <p className="text-ink-muted mt-0.5 text-xs">
                {data?.isSubgraph
                  ? "当前为子工作流的源文件内容"
                  : "工作流(RAW)格式导入，显示磁盘上的原始文件内容，未做任何转换"}
              </p>
            </div>
            {/* 唯一的一枚关闭按钮（`DialogContent` 的内置那枚已关掉）。
                按钮内容是「✕」这个字形，accessible name 会算成「✕」——读屏器
                念不出「关闭」，所以名字显式给 `aria-label`，说明文字走 `<Hint>`。 */}
            <Hint label="关闭">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onClose}
                className="text-ink-muted hover:text-ink-soft"
                aria-label="关闭"
              >
                ✕
              </Button>
            </Hint>
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
              <p className="text-destructive px-5 py-3 text-sm">{error}</p>
            ) : data?.source == null ? (
              <p className="text-ink-muted px-5 py-3 text-sm">
                没有可显示的数据
              </p>
            ) : (
              <JsonViewer
                key="source"
                data={data.source}
                title="工作流(RAW)格式"
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
      </DialogContent>
    </Dialog>
  );
}
