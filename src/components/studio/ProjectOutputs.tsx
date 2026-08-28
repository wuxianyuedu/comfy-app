"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MediaThumbnail as MediaThumb } from "@/components/studio/MediaThumbnail";
import { AuroraBackground } from "@/components/studio/AuroraBackground";
import { getActiveId, listProjects, type CanvasProject } from "@/components/studio/project-canvas/canvas-store";
import { api } from "~/trpc/react";

interface OutputImage {
  id: string;
  localPath: string;
  mediaType: string;
  seed: string | null;
  width: number | null;
  height: number | null;
  isCover: boolean;
}

interface OutputItem {
  id: string;
  type: string;
  status: string;
  workflowName: string | null;
  prompt: string | null;
  negativePrompt: string | null;
  seed: string | null;
  size: string | null;
  sampler: string | null;
  steps: number | null;
  cfg: number | null;
  checkpoint: string | null;
  referenceImages: string[];
  createdAt: string;
  images: OutputImage[];
}

const TYPE_CHIP: Record<string, string> = {
  TXT2IMG: "文生图",
  IMG2IMG: "图生图",
  INPAINT: "局部重绘",
  HIRERES: "高清放大",
  VIDEO: "视频",
};

const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  SUCCEEDED: { label: "已完成", cls: "bg-emerald-500/15 text-emerald-400" },
  FAILED: { label: "失败", cls: "bg-red-500/15 text-red-400" },
  CANCELLED: { label: "已取消", cls: "bg-white/10 text-gray-400" },
  QUEUED: { label: "排队中", cls: "bg-white/10 text-gray-300" },
  RUNNING: { label: "生成中", cls: "bg-violet-500/20 text-violet-300" },
};

/** 参考图路径可能是 ComfyUI input 文件名（如 abc.png）或绝对 url 路径
 *  （如 /api/generated/.../img_0.png）。前者走 /api/images 代理预览。 */
function refSrc(v: string): string {
  if (v.startsWith("/")) return v;
  return `/api/images?filename=${encodeURIComponent(v)}&type=input`;
}

function taskCover(images: OutputImage[]): OutputImage | null {
  const img = images.find((image) => image.mediaType === "image");
  if (img) return img;
  return images[0] ?? null;
}

function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

export function ProjectOutputs() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<CanvasProject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refreshProjects = useCallback(() => {
    setProjects(listProjects());
  }, []);

  useEffect(() => {
    const sync = () => {
      setProjectId(getActiveId());
      refreshProjects();
    };
    sync();
    window.addEventListener("comfyapp:canvas-store-changed", sync);
    return () => window.removeEventListener("comfyapp:canvas-store-changed", sync);
  }, [refreshProjects]);

  const outputsQ = api.project.outputs.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId }
  );
  const outputs = (outputsQ.data?.outputs ?? []).map((output) => ({ ...output, createdAt: String(output.createdAt) })) as OutputItem[];
  const loading = outputsQ.isLoading;

  const activeProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projects, projectId]
  );

  const selected = useMemo(
    () => outputs.find((output) => output.id === selectedId) ?? null,
    [outputs, selectedId]
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
        files: selected.images.map((image) =>({          localPath: image.localPath,
          mediaType: image.mediaType,
          seed: image.seed,
          width: image.width,
          height: image.height,
        })),
        savePath: projectId ? `public/generated/projects/${projectId}/${selected.id}/` : "",
      },
      null,
      2
    );
  }, [selected, projectId]);

  const handleCopy = useCallback(() => {
    if (!metaJson) return;
    navigator.clipboard?.writeText(metaJson).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => undefined
    );
  }, [metaJson]);

  const handleExport = useCallback(() => {
    if (!metaJson || !selected) return;
    const blob = new Blob([metaJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `output-${selected.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [metaJson, selected]);

  if (!projectId) {
    return (
      <div className="h-full overflow-y-auto">
        <AuroraBackground />
        <div className="mx-auto grid min-h-[60vh] max-w-[1100px] place-items-center px-6 text-center">
          <div>
            <p className="text-lg font-medium text-gray-300">还没有打开任何画布项目</p>
            <p className="mt-2 text-sm text-gray-500">
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
            <h1 className="font-title text-xl font-bold text-gray-100">
              {activeProject?.name ?? "未命名项目"}
            </h1>
            <span className="rounded-full bg-violet-500/15 px-2.5 py-0.5 text-[11px] font-medium text-violet-300">
              {outputs.length} 个产出
            </span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-gray-300 outline-none focus:border-violet-500/40"
            >
              {projects.map((project) =>
(
                <option key={project.id} value={project.id} className="bg-[var(--color-node)]">
                  {project.name ?? "未命名项目"}
                </option>
              ))}
            </select>
            <button
              onClick={() => outputsQ.refetch()}
              className="rounded-lg border border-white/10 px-3 py-2 text-xs text-gray-400 hover:text-gray-200"
            >
              ↻ 刷新
            </button>
          </div>
        </div>

        {/* ── Cover banner ── */}
        <div className="relative mb-6 h-[180px] overflow-hidden rounded-2xl border border-violet-500/20">
          {cover ? (
            <MediaThumb
              src={cover.localPath}
              alt=""
              className="h-full w-full object-cover"
              autoPlay
              loop
            />
          ) : (
            <div className="grid h-full place-items-center bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 text-sm text-gray-500">
              生成结果将作为封面展示在这里
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
          <div className="absolute bottom-3 left-4">
            <span className="rounded-md bg-violet-500/90 px-2 py-0.5 text-[11px] font-semibold text-white">
              封面
            </span>
            <p className="mt-1.5 font-title text-lg font-bold text-white drop-shadow">
              {activeProject?.name ?? "未命名项目"} · 创作合集
            </p>
          </div>
        </div>

        {/* ── Output grid ── */}
        {loading ? (
          <p className="text-sm text-gray-500">加载中…</p>
        ) : outputs.length === 0 ? (
          <div className="grid min-h-[280px] place-items-center rounded-2xl border border-dashed border-white/[0.08] text-gray-500">
            <div className="text-center">
              <p className="text-lg font-medium text-gray-300">还没有产出</p>
              <p className="mt-1 text-sm">在画布里跑一次生成，结果会自动归档到本项目目录。</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {outputs.map((output) =>
{
              const c = taskCover(output.images);
              const isVideoOut = c?.mediaType === "video";
              const st = STATUS_CHIP[output.status] ?? STATUS_CHIP.QUEUED;
              const active = selectedId === output.id;
              return (
                <button
                  key={output.id}
                  type="button"
                  onClick={() => setSelectedId(output.id)}
                  className={`group relative overflow-hidden rounded-2xl border text-left transition-all hover:shadow-lg hover:shadow-black/30 ${
                    active
                      ? "border-violet-400/70 ring-1 ring-violet-400/40"
                      : "border-white/[0.06] hover:border-white/[0.14]"
                  } bg-white/[0.02]`}
                >
                  <div className="relative aspect-square w-full bg-[#111118]">
                    {c ? (
                      <MediaThumb
                        src={c.localPath}
                        alt=""
                        className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
                        autoPlay
                        loop
                      />
                    ) : (
                      <div className="grid h-full place-items-center text-xs text-gray-600">
                        {output.status === "FAILED" ? "生成失败" : "无预览"}
                      </div>
                    )}

                    {isVideoOut && (
                      <span className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-violet-500/90 ring-2 ring-white/90">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="white" aria-hidden>
                          <path d="M6 4 L16 10 L6 16 Z" />
                        </svg>
                      </span>
                    )}
                    {isVideoOut && (
                      <span className="absolute right-2 top-2 rounded-md bg-fuchsia-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        视频
                      </span>
                    )}
                    <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${st!.cls}`}>
                      {st!.label}
                    </span>
                  </div>
                  <div className="p-3">
                    <p className="line-clamp-1 text-xs font-medium text-gray-300">
                      {TYPE_CHIP[output.type] ?? output.type} · {output.seed ?? "—"}
                    </p>
                    <p className="mt-1 text-[11px] text-gray-600">{timeAgo(output.createdAt)}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Metadata drawer ── */}
      {selected && (
        <>
          <div
            className="fixed inset-0 z-[80] bg-black/50"
            onClick={() => setSelectedId(null)}
          />
          <aside className="fixed right-0 top-0 z-[90] flex h-full w-[380px] max-w-[90vw] flex-col overflow-hidden border-l border-white/10 bg-[var(--color-node)] shadow-2xl">
            {/* head */}
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
              <div className="flex items-center gap-2">
                <h3 className="font-title text-sm font-bold text-gray-100">
                  产出 #{selected.id.slice(-4)}
                </h3>
                <span className="rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-300">
                  {TYPE_CHIP[selected.type] ?? selected.type}
                </span>
              </div>
              <button
                onClick={() => setSelectedId(null)}
                className="text-gray-500 hover:text-gray-200"
                aria-label="关闭"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
              {/* reference images */}
              <section>
                <p className="mb-2 text-xs font-semibold text-gray-400">参考图</p>
                {selected.referenceImages.length ? (
                  <div className="grid grid-cols-4 gap-2">
                    {selected.referenceImages.map((image, index) => (
                      <div
                        key={image}
                        className="aspect-square overflow-hidden rounded-lg border border-white/[0.06] bg-[var(--color-panel-deep)]"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={refSrc(image)}
                          alt={`参考图 ${index + 1}`}
                          className="h-full w-full object-cover"
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-600">本次生成无参考图（纯文生图）。</p>
                )}
                <p className="mt-1.5 text-[10.5px] text-gray-600">
                  参考图随产出一起保存到项目目录，复现时可一键还原。
                </p>
              </section>

              {/* prompts */}
              <section className="space-y-2">
                <div>
                  <p className="mb-1 text-xs font-semibold text-gray-400">正向提示词</p>
                  <div className="max-h-28 overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 text-[12px] leading-relaxed text-gray-300">
                    {selected.prompt ?? "—"}
                  </div>
                </div>
                {selected.negativePrompt && (
                  <div>
                    <p className="mb-1 text-xs font-semibold text-gray-400">反向提示词</p>
                    <div className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 text-[12px] leading-relaxed text-gray-400">
                      {selected.negativePrompt}
                    </div>
                  </div>
                )}
              </section>

              {/* params table */}
              <section>
                <p className="mb-2 text-xs font-semibold text-gray-400">参数</p>
                <div className="overflow-hidden rounded-lg border border-white/[0.06]">
                  {[
                    ["Seed", selected.seed ?? "—"],
                    ["模型", selected.checkpoint ?? "—"],
                    ["采样器", selected.sampler ?? "—"],
                    ["步数", selected.steps != null ? String(selected.steps) : "—"],
                    ["CFG", selected.cfg != null ? String(selected.cfg) : "—"],
                    ["尺寸", selected.size ?? "—"],
                    ["时间", timeAgo(selected.createdAt)],
                  ].map(([k, v], i) => (
                    <div
                      key={k}
                      className={`flex items-center justify-between px-3 py-2 text-[12px] ${
                        i % 2 === 0 ? "bg-white/[0.02]" : ""
                      }`}
                    >
                      <span className="text-gray-500">{k}</span>
                      <span className="font-mono text-gray-200">{v}</span>
                    </div>
                  ))}
                </div>
              </section>

              {/* source */}
              <section>
                <p className="mb-1 text-xs font-semibold text-gray-400">来源</p>
                <p className="text-[12px] text-gray-300">
                  工作流：{selected.workflowName ?? "—"}
                </p>
              </section>
            </div>

            {/* footer actions */}
            <div className="border-t border-white/[0.06] p-4">
              <div className="flex gap-2">
                <button
                  onClick={handleCopy}
                  className="flex-1 rounded-lg bg-violet-500/90 px-3 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-violet-500"
                >
                  {copied ? "已复制 ✓" : "复制元数据"}
                </button>
                <button
                  onClick={handleExport}
                  className="flex-1 rounded-lg border border-white/10 px-3 py-2 text-[12px] text-gray-300 transition-colors hover:bg-white/[0.06]"
                >
                  导出 JSON
                </button>
              </div>
              <p className="mt-2 text-[10.5px] text-gray-600">
                文件已保存至{" "}
                <span className="font-mono text-gray-500">
                  public/generated/projects/{projectId}/{selected.id}/
                </span>
              </p>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
