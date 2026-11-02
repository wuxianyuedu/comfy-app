"use client";

import { subscribeAppEvent } from "~/lib/app-events";
import { taskStatusLabel } from "~/lib/task-state";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useElementBox } from "~/components/ui/use-element-box";
import { Badge } from "~/components/ui/badge";
import { PageHeader } from "~/components/ui/page-header";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { AuroraBackground } from "~/components/ui/aurora-background";
import { DocumentFrame } from "~/components/studio/ViewContainer";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { SelectMenu } from "~/components/ui/select-menu";
import { useFlashState } from "~/components/ui/use-flash-state";
import { displayValue } from "~/lib/display-value";
import { artifactDirDisplay } from "~/lib/media/output-layout";
import { downloadText } from "~/lib/browser-io";
import { useCopyFeedback } from "~/components/ui/use-copy-feedback";
import { timeAgo } from "~/lib/time-format";
import { StatusBadge } from "~/components/ui/status-badge";
import { ProjectOutputsMetadataSheet, TYPE_CHIP } from "./ProjectOutputsMetadataSheet";
import { getActiveId, listProjects, type CanvasProject } from "~/lib/project-canvas/canvas-store";
import {
  type ProjectOutputItem,
  type ProjectOutputImage,
  useProjectOutputs,
} from "./hooks/use-project-outputs";

/** 单张产出卡（从 `outputs.map` 里原样提出 —— 虚拟化只改「哪几行在场」，
 * 不改卡本身的任何形态/行为）。 */
function OutputCard({
  output,
  active,
  onSelect,
}: {
  active: boolean;
  onSelect: (id: string) => void;
  output: ProjectOutputItem;
}) {
  const c = taskCover(output.images);
  const isVideoOut = c?.mediaType === "video";
  return (
    <Button
      className={`group relative h-auto overflow-hidden rounded-2xl border text-left font-normal transition-all hover:shadow-lg hover:shadow-black/6 dark:shadow-black/30 ${
        active
          ? "border-primary-500/70 ring-primary-500/40 ring-1"
          : "border-border-strong hover:border-ink-fainter"
      } bg-subtle`}
      onClick={() => onSelect(output.id)}
      variant="ghost"
    >
      <div className="bg-canvas-deep relative aspect-square w-full">
        {c ? (
          <MediaThumbnail
            alt=""
            autoPlay
            className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
            loop
            src={c.localPath}
          />
        ) : (
          <div className="text-ink-fainter grid h-full place-items-center text-xs">
            {output.status === "FAILED" ? "生成失败" : "无预览"}
          </div>
        )}

        {isVideoOut && (
          <span className="ring-border-strong bg-primary/90 absolute top-1/2 left-1/2 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full ring-2">
            <svg aria-hidden fill="white" height="24" viewBox="0 0 24 24" width="24">
              <path d="M6 4 L16 10 L6 16 Z" />
            </svg>
          </span>
        )}
        {isVideoOut && (
          <span className="text-3xs bg-accent/90 absolute top-2 right-2 rounded-md px-1.5 py-0.5 font-semibold text-white">
            视频
          </span>
        )}
        <StatusBadge
          className="text-2xs absolute top-2 left-2 px-2 py-0.5"
          dot={false}
          label={taskStatusLabel(output.status)}
          status={output.status}
        />
      </div>
      <div className="p-3">
        <p className="text-ink-soft line-clamp-1 text-xs font-medium">
          {TYPE_CHIP[output.type] ?? output.type} ·{displayValue(output.seed)}
        </p>
        <p className="text-ink-fainter text-2xs mt-1">{displayValue(timeAgo(output.createdAt))}</p>
      </div>
    </Button>
  );
}

/**
 * 产出网格的**行级虚拟化**（audit §C.1 F4a / ISSUE #2190）。
 *
 * 产出数随项目历史任务数只增不减、每卡挂一个媒体缩略图（视频那一支还
 * `autoPlay`）—— 全量 `map` 的首屏挂载成本与 DOM 规模都线性上涨，而一屏
 * 看得见的只有个位数张。虚拟项 = **一行 2~4 张卡**（响应式多列 grid 不能
 * 直接照抄 ModelLibrary 那份单列行虚拟器），列数按文档型滚动容器的宽度推
 * （镜像旧 Tailwind 断点：基础 2 / ≥640 3 / ≥1024 4，宽度取 `useElementBox`
 * 的 `ResizeObserver`，窗口缩放跟着重算）。
 *
 * 滚动容器不是 window：文档型的滚动锚在 `DocumentFrame` 里
 * （`[data-document-scroll]`，见 ViewContainer 那一段）—— `closest()` 找到它
 * 交给 `useVirtualizer`；`scrollMargin` 用列表相对该锚的 `offsetTop`
 * （锚自带 `position: relative`，offsetParent 链直通）。
 *
 * 固有取舍（audit 原文「滚出视口即卸载媒体」）：视频缩略图滚出视口即卸载，
 * 滚回来重新起播 —— 这正是虚拟化换来的「不挂载」，不在视图层另加缓存绕它
 * （§12.12 / 硬规则 20）。
 */
function VirtualizedOutputGrid({
  outputs,
  selectedId,
  onSelect,
}: {
  onSelect: (id: string) => void;
  outputs: Array<ProjectOutputItem>;
  selectedId: string | null;
}) {
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [boxRef, box] = useElementBox();

  /* 找文档型滚动锚（列表的祖先）。列表挂上后找一次即可 —— 锚不随滚动换。 */
  const setListEl = useCallback(
    (el: HTMLDivElement | null) => {
      listRef.current = el;
      boxRef(el);
      setScrollEl(el?.closest<HTMLElement>("[data-document-scroll]") ?? null);
    },
    [boxRef],
  );

  const width = box?.clientWidth ?? 0;
  const cols = width >= 1024 ? 4 : width >= 640 ? 3 : 2;
  const GAP = 16;
  /* 卡片文字区（p-3 + 两行文本 + 边框）的固定高度预算：卡片本体是
   * aspect-square，行高 = 卡宽 + 这一段 —— 量不出宽度时给个保守初值。 */
  const CARD_TEXT_H = 92;
  const cardW = width > 0 ? (width - GAP * (cols - 1)) / cols : 160;
  const rowH = cardW + CARD_TEXT_H;

  const rows = useMemo(() => {
    const out: Array<{ items: Array<ProjectOutputItem>; start: number }> = [];
    for (let i = 0; i < outputs.length; i += cols) {
      out.push({ start: i, items: outputs.slice(i, i + cols) });
    }
    return out;
  }, [outputs, cols]);

  const scrollMargin = listRef.current?.offsetTop ?? 0;
  // 与 ModelLibrary 同一条误报豁免：virtualizer 的读数只在本组件 render 内消费，
  // 不外传给被 memo 的子组件，不存在该规则担心的「跨组件陈旧 UI」风险。
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => rowH + GAP,
    overscan: 3,
    gap: GAP,
    scrollMargin,
  });
  /* 量测未就绪（挂载首帧 / ResizeObserver 不可用的 jsdom）⇒ 全量渲染兜底 ——
   * 与 ModelLibrary 的 `measured` 守卫同一条形状：虚拟器在无读数的环境里
   * `getVirtualItems()` 是空的，直接用会把网格渲染成一片空白。 */
  const measured = (scrollEl?.clientHeight ?? 0) > 0 && width > 0;

  if (!measured) {
    return (
      <div
        aria-label="项目产出"
        ref={setListEl}
        role="list"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gap: GAP,
        }}
      >
        {outputs.map((output) => (
          <OutputCard
            active={selectedId === output.id}
            key={output.id}
            onSelect={onSelect}
            output={output}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      aria-label="项目产出"
      ref={setListEl}
      role="list"
      style={{
        position: "relative",
        height: virtualizer.getTotalSize(),
        width: "100%",
      }}
    >
      {virtualizer.getVirtualItems().map((vi) => {
        const row = rows[vi.index];
        if (!row) {
          return null;
        }
        return (
          <div
            data-index={vi.index}
            key={vi.key}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              display: "grid",
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gap: GAP,
              transform: `translateY(${vi.start}px)`,
            }}
          >
            {row.items.map((output) => (
              <OutputCard
                active={selectedId === output.id}
                key={output.id}
                onSelect={onSelect}
                output={output}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function taskCover(images: Array<ProjectOutputImage>): ProjectOutputImage | null {
  const img = images.find((image) => image.mediaType === "image");
  if (img) {
    return img;
  }
  return images[0] ?? null;
}

export function ProjectOutputs() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Array<CanvasProject>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /* 「已复制 ✓」的一次性反馈：亮 1.5s 自动复位（连点/卸载由 hook 收口）。 */
  const copied = useFlashState();

  const refreshProjects = useCallback(() => {
    setProjects(listProjects());
  }, []);

  useEffect(() => {
    const sync = () => {
      setProjectId(getActiveId());
      refreshProjects();
    };
    sync();
    return subscribeAppEvent("comfyapp:canvas-store-changed", sync);
  }, [refreshProjects]);

  const { outputs, loading, refetch: refetchOutputs } = useProjectOutputs(projectId);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projects, projectId],
  );

  const selected = useMemo(
    () => outputs.find((output) => output.id === selectedId) ?? null,
    [outputs, selectedId],
  );

  // 封面：最新产出里最有代表性的图（优先图像，其次视频首帧）。
  const cover = useMemo(() => {
    for (const o of outputs) {
      const c = taskCover(o.images);
      if (c) {
        return c;
      }
    }
    return null;
  }, [outputs]);

  const metaJson = useMemo(() => {
    if (!selected) {
      return "";
    }
    return JSON.stringify(
      {
        id: selected.id,
        workflowName: selected.workflowName,
        type: selected.type,
        status: selected.status,
        prompt: selected.prompt,
        negativePrompt: selected.negativePrompt,
        seed: selected.seed,
        size: selected.size,
        sampler: selected.sampler,
        steps: selected.steps,
        cfg: selected.cfg,
        checkpoint: selected.checkpoint,
        referenceImages: selected.referenceImages,
        createdAt: selected.createdAt,
        files: selected.images.map((image) => ({
          localPath: image.localPath,
          mediaType: image.mediaType,
          seed: image.seed,
          width: image.width,
          height: image.height,
        })),
        /* 相对应用根的落点，形状来自布局那一处（组件里抄字面量 = 搬一次根就说错话）。 */
        savePath:
          projectId !== null && projectId !== "" ? artifactDirDisplay(selected.id, projectId) : "",
      },
      null,
      2,
    );
  }, [selected, projectId]);

  /* 复制的成败都交给出口（规范 16 §16.2.4.43）：成功亮一下按钮，失败也亮 ——
   * 此前这里`if (!ok) return;` 把失败整个吞掉，按钮一动不动，用户以为成了。 */
  const [copyFailed, setCopyFailed] = useState(false);
  const copy = useCopyFeedback({
    onSuccess: () => {
      setCopyFailed(false);
      copied.flash();
    },
    onFailure: () => setCopyFailed(true),
  });
  const handleCopy = useCallback(() => {
    if (!metaJson) {
      return;
    }
    copy(metaJson);
  }, [metaJson, copy]);

  const handleExport = useCallback(() => {
    if (!metaJson || !selected) {
      return;
    }
    downloadText(metaJson, `output-${selected.id}.json`);
  }, [metaJson, selected]);

  if (projectId === null || projectId === "") {
    return (
      <DocumentFrame
        backdrop={<AuroraBackground />}
        className="grid min-h-[60vh] place-items-center px-6 text-center"
        width="medium"
      >
        <div>
          <p className="text-ink-soft text-lg font-medium">还没有打开任何画布项目</p>
          <p className="text-ink-muted mt-2 text-sm">
            请先在「画布」中创建或打开一个项目，生成结果会自动归档到项目目录并在这里展示。
          </p>
        </div>
      </DocumentFrame>
    );
  }

  return (
    <DocumentFrame
      backdrop={<AuroraBackground />}
      className="px-4 pt-4 pb-6 sm:px-8 sm:pt-5 sm:pb-8"
      width="medium"
    >
      {/* ── Header ──
          这一屏的标题是**项目名**（数据），不是屏名 —— 所以走 `title` 而不是在
          旁边再挂一个「产出」（屏名已经在页签上了，重复一遍是 ISSUE #1423 那族
          「一屏两名」）。数量徽标 + 项目切换器同理进 `extra` / `actions`。 */}
      <PageHeader
        actions={
          <>
            <SelectMenu
              labels={Object.fromEntries(projects.map((p) => [p.id, p.name ?? "未命名项目"]))}
              onChange={setProjectId}
              options={projects.map((p) => p.id)}
              value={projectId}
            />
            <Button
              className="border-border-strong text-ink-muted hover:text-ink h-auto rounded-lg px-3 py-2"
              onClick={refetchOutputs}
              size="sm"
              variant="outline"
            >
              ↻ 刷新
            </Button>
          </>
        }
        className="mb-5"
        extra={
          <Badge className="mt-1" size="pill-md" tone="primary">
            {outputs.length} 个产出
          </Badge>
        }
        title={activeProject?.name ?? "未命名项目"}
      />

      {/* ── Cover banner ── */}
      <div className="border-primary/20 relative mb-6 h-45 overflow-hidden rounded-2xl border">
        {cover ? (
          <MediaThumbnail
            alt=""
            autoPlay
            className="h-full w-full object-cover"
            loop
            src={cover.localPath}
          />
        ) : (
          <div className="text-ink-muted from-primary/10 to-accent/20 grid h-full place-items-center bg-linear-to-br text-sm">
            生成结果将作为封面展示在这里
          </div>
        )}
        <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/30 to-transparent" />
        <div className="absolute bottom-3 left-4">
          <span className="text-2xs bg-primary/90 rounded-md px-2 py-0.5 font-semibold text-white">
            封面
          </span>
          <p className="font-title mt-1.5 text-lg font-bold text-white drop-shadow">
            {activeProject?.name ?? "未命名项目"} · 创作合集
          </p>
        </div>
      </div>

      {/* ── Output grid ── */}
      {loading ? (
        <p className="text-ink-muted text-sm">加载中…</p>
      ) : outputs.length === 0 ? (
        <EmptyState
          description="在画布里跑一次生成，结果会自动归档到本项目目录。"
          minHeightClass="min-h-70"
          title="还没有产出"
        />
      ) : (
        <VirtualizedOutputGrid onSelect={setSelectedId} outputs={outputs} selectedId={selectedId} />
      )}

      <ProjectOutputsMetadataSheet
        copyFailed={copyFailed}
        copySucceeded={copied.on}
        onClose={() => setSelectedId(null)}
        onCopy={handleCopy}
        onExport={handleExport}
        projectId={projectId}
        selected={selected}
      />
    </DocumentFrame>
  );
}
