"use client";

/**
 * 调研页（脸库 / 风格库）生成结果卡的**唯一实现**（ISSUE #5114）。
 * 两页的卡结构完全相同——图片 + 状态 + 取消 + 加入资产库；差异只有分类
 * （character / style）与图片说明文案，由调用处传进来。共享件里不碰任何一侧的
 * 取数或传输层（规范 17 §17.2 / §18.4）。
 */
import { FolderPlus, Sparkles } from "lucide-react";

import { Button } from "~/components/ui/button";
import { ViewableImage } from "~/components/ui/image-viewer";

import type { AssetCandidate } from "./hooks/use-asset-library";
import type { AssetCategoryKey } from "./asset-categories";

/** 两页结果的最小公共形状（各自的 Result 是它的超集）。 */
export type ResearchResultMeta = {
  error?: string;
  modelName?: string;
  negativePrompt?: string;
  prompt?: string;
  status: "pending" | "cancelling" | "cancelled" | "done" | "failed";
  taskId?: string;
  url?: string;
};

/** 入库弹窗的目标：本地带 taskId，远端带 URL + 提示词等元数据。 */
export type ResearchLibraryTarget = { candidate: AssetCandidate } | { taskId: string } | null;

/** 把一格生成结果折成弹窗目标；分类由调用页决定（脸 = character / 画风 = style）。 */
export function buildResearchLibraryTarget(
  result: ResearchResultMeta,
  category: AssetCategoryKey,
): ResearchLibraryTarget {
  if (result.taskId !== undefined) {
    return { taskId: result.taskId };
  }
  if (result.url === undefined) {
    return null;
  }
  return {
    candidate: {
      category,
      ...(result.modelName === undefined ? {} : { modelName: result.modelName }),
      ...(result.negativePrompt === undefined ? {} : { negativePrompt: result.negativePrompt }),
      prompt: result.prompt ?? "",
      sourceUrl: result.url,
    },
  };
}

export function ResearchResultCard({
  id,
  imageLabel,
  name,
  onAddToLibrary,
  onCancel,
  result,
}: {
  id: string;
  imageLabel: string;
  name: string;
  onAddToLibrary: (result: ResearchResultMeta) => void;
  onCancel: (id: string) => void;
  result?: ResearchResultMeta;
}) {
  const running = result?.status === "pending" || result?.status === "cancelling";
  return (
    <div className="border-border bg-subtle/40 flex min-w-0 flex-col gap-2 rounded-xl border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{name}</span>
        {result?.status === "pending" && (
          <span className="text-muted-foreground text-xs">生成中…</span>
        )}
        {result?.status === "cancelling" && (
          <span className="text-muted-foreground text-xs">取消中…</span>
        )}
        {result?.status === "cancelled" && (
          <span className="text-muted-foreground text-xs">已取消</span>
        )}
        {result?.status === "done" && <span className="text-success-strong text-xs">已完成</span>}
        {result?.status === "failed" && <span className="text-destructive text-xs">失败</span>}
      </div>
      {running ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            aria-label={`取消生成：${name}`}
            disabled={result.taskId === undefined || result.status === "cancelling"}
            onClick={() => {
              onCancel(id);
            }}
            size="xs"
            variant="outline"
          >
            取消生成
          </Button>
          {result.taskId === undefined ? (
            <span className="text-muted-foreground text-2xs">远端通道不可取消</span>
          ) : null}
        </div>
      ) : null}
      {result?.status === "done" && result.url ? (
        <>
          <ViewableImage
            alt={`${name} 生成结果`}
            className="max-h-96 w-full object-contain"
            label={imageLabel}
            src={result.url}
          />
          <Button
            aria-label={`把「${name}」加入资产库`}
            onClick={() => {
              onAddToLibrary(result);
            }}
            size="xs"
            variant="outline"
          >
            <FolderPlus aria-hidden data-icon="inline-start" size={14} />
            加入资产库
          </Button>
        </>
      ) : result?.status === "failed" ? (
        <p className="text-muted-foreground text-xs leading-relaxed">
          {result.error ?? "生成失败"}
        </p>
      ) : (
        <div className="bg-muted/60 flex h-48 items-center justify-center rounded-lg">
          <Sparkles aria-hidden="true" className="text-muted-foreground size-6" />
        </div>
      )}
    </div>
  );
}
