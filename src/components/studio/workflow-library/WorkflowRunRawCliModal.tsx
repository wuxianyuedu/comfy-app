"use client";

/**
 * WorkflowRunRawCliModal —— 工作流库「查看完整 comfy-cli 输出」弹窗。
 *
 * 执行日志面板会把每一行 `[comfy-cli 原始]` 折成一行（并按行数封顶保留），所以本
 * 弹窗是「拿全量」的出口：从 /api/tasks/[id]/raw-cli 取某次任务完整、未截断的
 * comfy-cli stdout/stderr 行并渲染——JSON 负载（`[comfy-cli 原始]` / `stdout`
 * 那些行）走可折叠、带语法高亮的 JsonViewer，其余按原始文本展示。只读：网络调用
 * 收在 lib/comfyui/raw-cli-client（UI/逻辑分离）。
 *
 * 运行期每 1.5s 轮询一次完整输出（服务端上限 5000 行），所以这里刻意不做
 * 「整份重建」—— 三条防线合起来让轮询只在**真的来了新行**时付代价：
 *   1. 逐行解析走 `./raw-cli-lines` 的缓存 → 未变的行保持同一个对象身份；
 *   2. 行组件是 `memo` 的 → 身份没变就不重渲染（连带它内部那棵 JSON 树）；
 *   3. 两轮内容逐字相同时连 setState 都不发（见 `sameRawCliLines`）。
 * 少了任何一条，每 1.5s 都会把整份输出重新解析 + 全部 JsonViewer 重建一遍。
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Copy, FileJson, RefreshCw, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { FieldLabel } from "~/components/ui/field";
import { JsonViewer } from "~/components/ui/json-viewer";
import { useInterval } from "~/components/ui/use-interval";
import { useCopyFeedback } from "~/components/ui/use-copy-feedback";
import { useScrollFollow } from "~/components/ui/use-scroll-follow";
import { fetchRawCli } from "~/lib/comfyui/raw-cli-client";
import {
  parseRawCliLine,
  sameRawCliLines,
  type ParsedCliLine,
} from "./raw-cli-lines";

const TAG_STYLES: Record<string, string> = {
  原始: "text-info-strong",
  stdout: "text-ink-soft",
  stderr: "text-destructive",
};

/**
 * 一行原文的卡片。
 *
 * `memo` 是这里的关键：轮询拿到新数组时，只有**真的新增**的行会换掉 `entry`
 * （其余行由 `parseRawCliLine` 的缓存给出同一个引用），于是旧行连同它内部那棵
 * JsonViewer 树一个都不重建。没有它时每 1.5s 整份输出全量重渲染 —— 大 payload
 * 下就是「这个界面非常卡」的一半来源（另一半是首屏全量展开，见
 * `ui/json-viewer` 里 `collapsed` 那段注释）。
 */
const RawCliLineCard = memo(function RawCliLineCard({
  entry,
}: {
  entry: ParsedCliLine;
}) {
  const tagClass = TAG_STYLES[entry.tag] ?? "text-ink-muted";

  if (entry.kind === "json") {
    return (
      <div className="border-border-subtle bg-card/60 rounded-lg border p-2">
        <div className={`mb-1 font-mono text-[10.5px] uppercase ${tagClass}`}>
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
    <div className="border-border-subtle bg-card/40 rounded-lg border p-2">
      {entry.tag && (
        <div className={`mb-1 font-mono text-[10.5px] uppercase ${tagClass}`}>
          [comfy-cli {entry.tag}]
        </div>
      )}
      <pre className="text-ink-strong font-mono text-[12.5px] leading-snug wrap-break-word whitespace-pre-wrap">
        {entry.text}
      </pre>
    </div>
  );
});

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

  const parsed = useMemo(() => lines.map(parseRawCliLine), [lines]);

  /* `background = true` 是轮询那条路：不翻 `loaded`（它只决定「加载中…」还是
   * 空态文案，每 1.5s 翻一次会让头部提示闪一下、还白搭两次渲染）。 */
  const loadRef = useRef<(background?: boolean) => void>(() => undefined);

  useEffect(() => {
    if (!open || !taskId) return;
    let alive = true;
    const doLoad = (background = false) => {
      if (!alive) return;
      if (!background) setLoaded(false);
      void fetchRawCli(taskId)
        .then((l) => {
          /* 逐字比对后才写 state：内容没变时保持旧数组，整棵列表一次都不重渲染。 */
          if (alive) setLines((prev) => (sameRawCliLines(prev, l) ? prev : l));
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
  useInterval(() => loadRef.current(true), {
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
        aria-label="comfy-cli 完整输出"
        data-testid="wflib-raw-cli-modal"
        showCloseButton={false}
        className="bg-transparent p-0 ring-0"
        popupClassName="w-5xl"
      >
        <div className="border-border bg-panel flex h-[85vh] w-5xl flex-col overflow-hidden rounded-2xl border shadow-2xl shadow-black/12 dark:shadow-black/60">
          {/* Header */}
          <div className="border-border bg-card flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
            <div className="flex min-w-0 items-center gap-2">
              <FileJson size={16} className="text-primary-strong shrink-0" />
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
                <Copy data-icon="inline-start" size={15} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => loadRef.current()}
                title="刷新"
                className="text-ink-muted hover:bg-subtle hover:text-ink-strong rounded-md"
              >
                <RefreshCw data-icon="inline-start" size={15} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onClose}
                title="关闭"
                className="text-ink-muted hover:bg-subtle hover:text-ink-strong rounded-md"
              >
                <X data-icon="inline-start" size={16} />
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
              /* 服务端缓冲只从**尾部**追加、到上限后从头部裁，所以除裁切那一轮外
                 下标与行的对应关系稳定；配上行内 `memo`（按 `entry` 身份跳过），
                 追加新行不会牵连已有卡片。 */
              parsed.map((entry, index) => (
                <RawCliLineCard key={index} entry={entry} />
              ))
            )}
          </div>

          {/* Footer */}
          <div className="border-border bg-card text-ink-muted flex h-9 shrink-0 items-center justify-between border-t px-4 text-[12px]">
            <span>
              {copied ? "已复制全部" : "完整、未经截断的 comfy-cli 输出"}
            </span>
            <FieldLabel className="flex cursor-pointer items-center gap-1.5 select-none">
              <Checkbox
                checked={autoscroll}
                onCheckedChange={(c) => setAutoscroll(c === true)}
                className="cursor-pointer"
              />
              自动滚动
            </FieldLabel>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
