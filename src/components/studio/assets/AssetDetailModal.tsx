"use client";

/**
 * `AssetDetailModal` — 资产详情弹窗（ISSUE #4868）：左侧方形预览 +
 * 右侧「完整生成参数」表。参数随资产入库时快照（`asset.params`），
 * 保证任何时候都能按原样重新生成；「复制参数」把同一份 JSON 送进剪贴板
 * （与历史页「复制去重投」同一落点语义）。
 */
import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { KeyValueRows } from "~/components/ui/key-value-rows";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { ViewableImage } from "~/components/ui/image-viewer";
import { useCopyResult } from "~/components/ui/use-copy-feedback";
import { cn } from "~/lib/utils";

import { assetCategoryLabel, assetScopeLabel, deriveAssetParamRows } from "./asset-categories";
import type { AssetDetail } from "./hooks/use-asset-library";

export function AssetDetailModal({
  asset,
  onClose,
  open,
}: {
  asset: AssetDetail | null;
  onClose: () => void;
  /** 弹层开关：详情 id 非空才开——查询的 pending 态不能当开关（未点开时
   *  React Query 的 disabled 查询恒为 pending，按它算会把弹窗永开）。 */
  open: boolean;
}) {
  const copy = useCopyResult();
  const [copied, setCopied] = useState(false);
  const params = asset?.params ?? null;
  const paramRows = deriveAssetParamRows(params, { workflowName: asset?.workflowName ?? null });
  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
      open={open}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>资产详情</DialogTitle>
          <DialogDescription>
            {asset === null
              ? "正在读取资产…"
              : `${assetCategoryLabel(asset.category)} · ${assetScopeLabel(asset.scope)}`}
          </DialogDescription>
        </DialogHeader>
        {asset === null ? (
          <p className="text-ink-muted py-8 text-center text-sm">读取中…</p>
        ) : (
          <div className="flex flex-col gap-5 sm:flex-row">
            {/* ── 左列：方形预览 + 名称与归属 ── */}
            <div className="flex w-full shrink-0 flex-col gap-2 sm:w-2/5">
              <div className="bg-panel-deep aspect-square w-full overflow-hidden rounded-xl">
                {asset.mediaType === "video" ? (
                  <MediaThumbnail
                    alt={asset.name}
                    autoPlay
                    className="h-full w-full object-cover"
                    loop
                    muted
                    src={asset.localPath}
                  />
                ) : asset.mediaType === "image" ? (
                  <ViewableImage
                    alt={asset.name}
                    className="h-full w-full object-cover"
                    label={asset.name}
                    src={asset.localPath}
                  />
                ) : (
                  <span className="text-ink-fainter flex size-full items-center justify-center text-sm">
                    {asset.mediaType === "audio" ? "音频资产" : "文档资产"}
                  </span>
                )}
              </div>
              <p className="text-ink-strong text-sm font-semibold">{asset.name}</p>
              <p className="text-ink-fainter text-xs">
                {assetCategoryLabel(asset.category)}
                {asset.subdir !== null && asset.subdir !== "" ? ` · ${asset.subdir}` : ""} ·{" "}
                {assetScopeLabel(asset.scope)}
              </p>
              <span
                className={cn(
                  "text-2xs w-fit rounded-full px-2 py-0.5 font-medium",
                  asset.params !== null && asset.params !== undefined
                    ? "bg-success/15 text-success-strong"
                    : "bg-warning-soft text-warning-strong",
                )}
              >
                {asset.params !== null && asset.params !== undefined
                  ? "● 参数完整 · 可复现"
                  : "● 缺生成参数"}
              </span>
            </div>
            {/* ── 右列：完整生成参数 ── */}
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="flex items-center gap-2">
                <p className="text-ink-soft text-sm font-semibold">完整生成参数</p>
                {paramRows.length > 0 && (
                  <span className="bg-success/15 text-success-strong text-2xs rounded-full px-2 py-0.5 font-medium">
                    ● 随时可 1:1 重新生成
                  </span>
                )}
              </div>
              {paramRows.length > 0 ? (
                <KeyValueRows
                  items={paramRows.map((row) => ({ key: row.label, value: row.value }))}
                  layout="rows"
                />
              ) : (
                <p className="text-ink-muted text-sm">
                  这份资产没有保存生成参数（例如手工上传的文件）。
                </p>
              )}
              <p className="text-ink-fainter text-2xs flex items-center gap-1.5">
                <Check aria-hidden className="size-3.5" />
                以上参数随资产一同保存，任何时候都可 1:1 重新生成
              </p>
              {paramRows.length > 0 && (
                <Button
                  className="border-border bg-subtle text-ink-strong hover:bg-surface-2 h-auto w-fit rounded-lg px-3 py-1.5"
                  onClick={() => {
                    void copy(JSON.stringify(params ?? {}, null, 2)).then((ok) => {
                      setCopied(ok);
                    });
                  }}
                  size="xs"
                  variant="outline"
                >
                  <Copy aria-hidden data-icon="inline-start" size={13} />
                  {copied ? "已复制" : "复制参数 JSON"}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
