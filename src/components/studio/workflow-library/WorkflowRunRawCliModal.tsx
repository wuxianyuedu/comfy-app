"use client";

/**
 * WorkflowRunRawCliModal — work-flow library"view full comfy-cli output" dialog.
 *
 * The execution-log panel folds each`[comfy-cli 原始]` line into one row (and
 * caps how many it keeps by row count), so this dialog is the"get everything"
 * exit: it fetches the COMPLETE, untruncated comfy-cli stdout/stderr lines for a
 * task from
 * /api/tasks/[id]/raw-cli and renders them: JSON payloads (the`[comfy-cli
 * 原始]` /`stdout` lines) go through the collapsible, syntax-highlighted
 * JsonViewer; everything else is shown as raw text. View-only: the network
 * call lives in lib/comfyui/raw-cli-client (UI/logic separation).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, FileJson, RefreshCw, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { JsonViewer } from "~/components/ui/json-viewer";
import { useInterval } from "~/components/ui/use-interval";
import { useCopyFeedback } from "~/components/ui/use-copy-feedback";
import { useScrollFollow } from "~/components/ui/use-scroll-follow";
import { fetchRawCli } from "~/lib/comfyui/raw-cli-client";
import { parseCliJsonLine, splitCliLogLine } from "~/lib/log/log-cli-json";

type ParsedLine =
  | { kind: "json"; tag: string; value: unknown }
  | { kind: "text"; tag: string; text: string };

/**
 * 把一行拆成「JSON 载荷」或「原文」：判据与解析都走`~/lib/log/log-cli-json`
 * 的唯一口径（日志面板的折叠行用的是同一份），两处不会分叉。
 */
function parseLine(line: string): ParsedLine {
  const json = parseCliJsonLine(line);
  if (json) return { kind: "json", tag: json.tag, value: json.value };
  const split = splitCliLogLine(line);
  if (!split) return { kind: "text", tag: "", text: line };
  return { kind: "text", tag: split.tag, text: split.payload };
}

const TAG_STYLES: Record<string, string> = {
  原始: "text-cyan-700 dark:text-cyan-400",
  stdout: "text-slate-600 dark:text-slate-300",
  stderr: "text-rose-700 dark:text-rose-400",
};

export interface WorkflowRunRawCliModalProps {
  /** 当前查看的运行；无则禁用入口。 */
  taskId: string | null;
  /** 是否仍在运行（运行期每 1.5s 轮询刷新）。 */
  running?: boolean;
  open: boolean;
  onClose: () => void;
}

export function WorkflowRunRawCliModal({
  taskId,
  running = false,
  open,
  onClose,
}: WorkflowRunRawCliModalProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [autoscroll, setAutoscroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const parsed = useMemo(() => lines.map(parseLine), [lines]);

  const loadRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!open || !taskId) return;
    let alive = true;
    const doLoad = () => {
      if (!alive) return;
      setLoaded(false);
      void fetchRawCli(taskId)
        .then((l) => {
          if (alive) setLines(l);
        })
        .catch(() => undefined)
        .finally(() => {
          if (alive) setLoaded(true);
        });
    };
    loadRef.current = doLoad;
    doLoad();
    return () => {
      alive = false;
    };
  }, [open, taskId]);

  /* 运行期按需轮询刷新完整输出（统一走 useInterval，不自写 setInterval）。 */
  useInterval(() => loadRef.current(), {
    ms: running ? 1500 : null,
    immediate: false,
  });

  const scroller = useScrollFollow({
    containerRef: scrollerRef,
    watch: `${lines.length}:${open}`,
    following: autoscroll,
    onFollowingChange: setAutoscroll,
  });

  const copy = useCopyFeedback({
    onSuccess: () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    },
    onFailure: "silent",
  });

  if (!open) return null;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        data-testid="wflib-raw-cli-modal"
        showCloseButton={false}
        className="bg-transparent p-0 ring-0"
        popupClassName="w-5xl"
      >
        <div className="border-border bg-panel flex h-[85vh] w-5xl flex-col overflow-hidden rounded-2xl border shadow-2xl shadow-black/12 dark:shadow-black/60">
          {/* Header */}
          <div className="border-border bg-card flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
            <div className="flex min-w-0 items-center gap-2">
              <FileJson
                size={16}
                className="shrink-0 text-violet-700 dark:text-violet-400"
              />
              <span className="text-ink truncate text-[15px] font-semibold">
                comfy-cli 完整输出
              </span>
              <span className="text-ink-faint text-[11px]">
                {!loaded ? "加载中…" : `${lines.length} 行`}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => copy(lines.join("\n"))}
                title="复制全部"
                className="text-ink-muted hover:bg-subtle hover:text-ink-strong rounded-md"
              >
                <Copy size={15} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  setLoaded(false);
                  void fetchRawCli(taskId ?? "")
                    .then((l) => setLines(l))
                    .catch(() => undefined)
                    .finally(() => setLoaded(true));
                }}
                title="刷新"
                className="text-ink-muted hover:bg-subtle hover:text-ink-strong rounded-md"
              >
                <RefreshCw size={15} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onClose}
                title="关闭"
                className="text-ink-muted hover:bg-subtle hover:text-ink-strong rounded-md"
              >
                <X size={16} />
              </Button>
            </div>
          </div>

          {/* Body */}
          <div
            ref={scrollerRef}
            onScroll={scroller.onScroll}
            className="custom-scrollbar bg-panel-deep/60 flex-1 gap-3 overflow-y-auto p-3"
          >
            {lines.length === 0 ? (
              <div className="text-ink-fainter flex h-full flex-col items-center justify-center gap-2 text-[13px]">
                {!loaded ? (
                  "加载中…"
                ) : (
                  <>
                    <FileJson
                      size={32}
                      strokeWidth={1.5}
                      className="opacity-30"
                    />
                    <span>
                      暂无完整输出（旧任务或服务端重启后内存缓冲已清空）
                    </span>
                  </>
                )}
              </div>
            ) : (
              parsed.map((entry, index) => {
                const tagClass = TAG_STYLES[entry.tag] ?? "text-ink-muted";
                if (entry.kind === "json") {
                  return (
                    <div
                      key={index}
                      className="border-border-subtle bg-card/60 rounded-lg border p-2"
                    >
                      <div
                        className={`mb-1 font-mono text-[10.5px] uppercase ${tagClass}`}
                      >
                        [comfy-cli {entry.tag}]
                      </div>
                      <JsonViewer
                        data={entry.value}
                        title="comfy-cli 输出"
                        initialCollapsedDepth={2}
                      />
                    </div>
                  );
                }
                return (
                  <div
                    key={index}
                    className="border-border-subtle bg-card/40 rounded-lg border p-2"
                  >
                    {entry.tag && (
                      <div
                        className={`mb-1 font-mono text-[10.5px] uppercase ${tagClass}`}
                      >
                        [comfy-cli {entry.tag}]
                      </div>
                    )}
                    <pre className="text-ink-strong font-mono text-[12.5px] leading-snug wrap-break-word whitespace-pre-wrap">
                      {entry.text}
                    </pre>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="border-border bg-card text-ink-muted flex h-9 shrink-0 items-center justify-between border-t px-4 text-[12px]">
            <span>
              {copied ? "已复制全部" : "完整、未经截断的 comfy-cli 输出"}
            </span>
            <label className="flex cursor-pointer items-center gap-1.5 select-none">
              <Checkbox
                checked={autoscroll}
                onCheckedChange={(c) => setAutoscroll(c === true)}
                className="cursor-pointer"
              />
              自动滚动
            </label>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
