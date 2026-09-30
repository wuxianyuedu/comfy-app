"use client";

import { subscribeAppEvent } from "~/lib/app-events";
import { taskStatusLabel } from "~/lib/task-state";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { AuroraBackground } from "~/components/ui/aurora-background";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { SelectMenu } from "~/components/ui/select-menu";
import { useFlashState } from "~/components/ui/use-flash-state";
import { displayValue } from "~/lib/display-value";
import { downloadText } from "~/lib/browser-io";
import { useCopyFeedback } from "~/components/ui/use-copy-feedback";
import { timeAgo } from "~/lib/time-format";
import { StatusBadge } from "~/components/ui/status-badge";
import {
  ProjectOutputsMetadataSheet,
  TYPE_CHIP,
} from "./ProjectOutputsMetadataSheet";
import {
  getActiveId,
  listProjects,
  type CanvasProject,
} from "~/lib/project-canvas/canvas-store";
import {
  type ProjectOutputImage,
  useProjectOutputs,
} from "./hooks/use-project-outputs";

function taskCover(images: ProjectOutputImage[]): ProjectOutputImage | null {
  const img = images.find((image) => image.mediaType === "image");
  if (img) return img;
  return images[0] ?? null;
}

export function ProjectOutputs() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<CanvasProject[]>([]);
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

  const {
    outputs,
    loading,
    refetch: refetchOutputs,
  } = useProjectOutputs(projectId);

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
      if (c) return c;
    }
    return null;
  }, [outputs]);

  const metaJson = useMemo(() => {
    if (!selected) return "";
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
        savePath: projectId
          ? `public/generated/projects/${projectId}/${selected.id}/`
          : "",
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
    if (!metaJson) return;
    copy(metaJson);
  }, [metaJson, copy]);

  const handleExport = useCallback(() => {
    if (!metaJson || !selected) return;
    downloadText(metaJson, `output-${selected.id}.json`);
  }, [metaJson, selected]);

  if (!projectId) {
    return (
      <div className="h-full overflow-y-auto">
        <AuroraBackground />
        <div className="mx-auto grid min-h-[60vh] max-w-[1100px] place-items-center px-6 text-center">
          <div>
            <p className="text-ink-soft text-lg font-medium">
              还没有打开任何画布项目
            </p>
            <p className="text-ink-muted mt-2 text-sm">
              请先在「画布」中创建或打开一个项目，生成结果会自动归档到项目目录并在这里展示。
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <AuroraBackground />
      <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-8">
        {/* ── Header ── */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="font-title u-title-page">
              {activeProject?.name ?? "未命名项目"}
            </h1>
            <span className="bg-primary/15 text-primary-strong rounded-full px-2.5 py-0.5 text-[11px] font-medium">
              {outputs.length} 个产出
            </span>
          </div>
          <div className="flex items-center gap-2">
            <SelectMenu
              value={projectId}
              onChange={setProjectId}
              options={projects.map((p) => p.id)}
              labels={Object.fromEntries(
                projects.map((p) => [p.id, p.name ?? "未命名项目"]),
              )}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={refetchOutputs}
              className="border-border-strong text-ink-muted hover:text-ink h-auto rounded-lg px-3 py-2"
            >
              ↻ 刷新
            </Button>
          </div>
        </div>

        {/* ── Cover banner ── */}
        {/* p71-allow:start brand violet/fuchsia · 封面横幅与项目徽章（非状态色），见 §3.6.1 */}
        <div className="relative mb-6 h-[180px] overflow-hidden rounded-2xl border border-violet-500/20">
          {cover ? (
            <MediaThumbnail
              src={cover.localPath}
              alt=""
              className="h-full w-full object-cover"
              autoPlay
              loop
            />
          ) : (
            <div className="text-ink-muted grid h-full place-items-center bg-linear-to-br from-violet-500/10 to-fuchsia-500/10 text-sm">
              生成结果将作为封面展示在这里
            </div>
          )}
          <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/30 to-transparent" />
          <div className="absolute bottom-3 left-4">
            <span className="rounded-md bg-violet-500/90 px-2 py-0.5 text-[11px] font-semibold text-white">
              封面
            </span>
            <p className="font-title mt-1.5 text-lg font-bold text-white drop-shadow">
              {activeProject?.name ?? "未命名项目"} · 创作合集
            </p>
          </div>
        </div>
        {/* p71-allow:end */}

        {/* ── Output grid ── */}
        {loading ? (
          <p className="text-ink-muted text-sm">加载中…</p>
        ) : outputs.length === 0 ? (
          <EmptyState
            title="还没有产出"
            description="在画布里跑一次生成，结果会自动归档到本项目目录。"
            minHeightClass="min-h-[280px]"
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {outputs.map((output) => {
              const c = taskCover(output.images);
              const isVideoOut = c?.mediaType === "video";
              const active = selectedId === output.id;
              return (
                <Button
                  key={output.id}
                  variant="ghost"
                  onClick={() => setSelectedId(output.id)}
                  className={`group relative h-auto overflow-hidden rounded-2xl border text-left font-normal transition-all hover:shadow-lg hover:shadow-black/6 dark:shadow-black/30 ${
                    active
                      ? "border-primary-500/70 ring-primary-500/40 ring-1"
                      : "border-border-strong hover:border-ink-fainter"
                  } bg-subtle`}
                >
                  <div className="bg-canvas-deep relative aspect-square w-full">
                    {c ? (
                      <MediaThumbnail
                        src={c.localPath}
                        alt=""
                        className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
                        autoPlay
                        loop
                      />
                    ) : (
                      <div className="text-ink-fainter grid h-full place-items-center text-xs">
                        {output.status === "FAILED" ? "生成失败" : "无预览"}
                      </div>
                    )}

                    {/* p71-allow:start brand violet/fuchsia · 视频产出播放按钮与类型徽章（非状态色） */}
                    {isVideoOut && (
                      <span className="ring-border-strong absolute top-1/2 left-1/2 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-violet-500/90 ring-2">
                        <svg
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="white"
                          aria-hidden
                        >
                          <path d="M6 4 L16 10 L6 16 Z" />
                        </svg>
                      </span>
                    )}
                    {isVideoOut && (
                      <span className="absolute top-2 right-2 rounded-md bg-fuchsia-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        视频
                      </span>
                    )}
                    {/* p71-allow:end */}
                    <StatusBadge
                      status={output.status}
                      label={taskStatusLabel(output.status)}
                      dot={false}
                      className="absolute top-2 left-2 px-2 py-0.5 text-[11px]"
                    />
                  </div>
                  <div className="p-3">
                    <p className="text-ink-soft line-clamp-1 text-xs font-medium">
                      {TYPE_CHIP[output.type] ?? output.type} ·{""}
                      {displayValue(output.seed)}
                    </p>
                    <p className="text-ink-fainter mt-1 text-[11px]">
                      {displayValue(timeAgo(output.createdAt))}
                    </p>
                  </div>
                </Button>
              );
            })}
          </div>
        )}
      </div>

      <ProjectOutputsMetadataSheet
        selected={selected}
        projectId={projectId}
        copyFailed={copyFailed}
        copySucceeded={copied.on}
        onCopy={handleCopy}
        onExport={handleExport}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
