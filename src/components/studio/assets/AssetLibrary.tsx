"use client";

/**
 * `AssetLibrary` — 资产库视图（ISSUE #4868）：
 * 公共 / 项目两档归属 + 七个分类 + 方形缩略图网格 + 右下角悬浮大小滑块。
 * 逻辑在 `hooks/use-asset-library.ts`（规范 17 §17.2 第②层），本文件是容器（第④层）。
 */
import { History, Search } from "lucide-react";

import { DocumentFrame } from "~/components/studio/ViewContainer";
import { pageHeaderTitle } from "~/components/studio/NavItems";
import { AuroraBackground } from "~/components/ui/aurora-background";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { EmptyState } from "~/components/ui/empty-state";
import { Input } from "~/components/ui/input";
import { PageHeader } from "~/components/ui/page-header";
import { SelectChip } from "~/components/ui/select-chip";
import { Skeleton } from "~/components/ui/skeleton";

import { AssetCard } from "./AssetCard";
import { AssetDetailModal } from "./AssetDetailModal";
import { AssetSizeSlider } from "./AssetSizeSlider";
import { ASSET_CATEGORIES, assetCategoryLabel } from "./asset-categories";
import { assetGridStyle, useAssetLibrary } from "./hooks/use-asset-library";

/** 归属三档（全部 / 公共 / 项目）。 */
const SCOPES = [
  { key: "all", label: "全部" },
  { key: "public", label: "公共资产" },
  { key: "project", label: "项目资产" },
] as const;

export function AssetLibrary() {
  const c = useAssetLibrary();
  /* 删除确认的目标行（ConfirmDialog 文案要名字）。 */
  const removeTargetAsset = c.items.find((item) => item.id === c.removeTarget) ?? null;
  /* 「全部」角标 = 各分类计数之和（scope / q 过滤后的口径，与列表行一致）。 */
  const total = c.categoryCounts.reduce((sum, row) => sum + row.count, 0);

  return (
    <DocumentFrame
      backdrop={<AuroraBackground />}
      className="px-4 pt-4 pb-6 sm:px-8 sm:pt-5 sm:pb-8"
      width="wide"
    >
      <PageHeader srTitle={pageHeaderTitle("assets")} />

      {/* ── 工具行：归属分段 + 搜索 ── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div aria-label="按归属筛选" className="flex flex-wrap gap-2" role="radiogroup">
          {SCOPES.map((scopeOption) => (
            <SelectChip
              key={scopeOption.key}
              onClick={() => {
                c.setScope(scopeOption.key);
              }}
              selected={c.scope === scopeOption.key}
              shape="pill"
            >
              <span>{scopeOption.label}</span>
            </SelectChip>
          ))}
        </div>
        <div className="relative ml-auto w-56">
          <Search
            aria-hidden
            className="text-ink-fainter pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
          />
          <Input
            aria-label="搜索资产"
            className="h-8 pl-8 text-xs"
            onChange={(event) => {
              c.setQ(event.target.value);
            }}
            placeholder="搜索名称、提示词…"
            value={c.q}
          />
        </div>
      </div>

      {/* ── 分类行（带计数角标） ── */}
      <div aria-label="按分类筛选" className="mb-5 flex flex-wrap gap-2" role="radiogroup">
        <SelectChip
          onClick={() => {
            c.switchCategory("all");
          }}
          selected={c.category === "all"}
          shape="pill"
        >
          <span>全部</span>
          <span className="text-3xs rounded-full bg-current/8 px-1.5 py-0.5 font-bold">
            {total}
          </span>
        </SelectChip>
        {ASSET_CATEGORIES.map((option) => {
          const count = c.categoryCounts.find((row) => row.category === option.key)?.count ?? 0;
          return (
            <SelectChip
              key={option.key}
              onClick={() => {
                c.switchCategory(option.key);
              }}
              selected={c.category === option.key}
              shape="pill"
            >
              <span>{assetCategoryLabel(option.key)}</span>
              <span className="text-3xs rounded-full bg-current/8 px-1.5 py-0.5 font-bold">
                {count}
              </span>
            </SelectChip>
          );
        })}
      </div>

      {/* ── 资产网格（方形缩略图；列宽随大小滑块走） ── */}
      {c.loading ? (
        <div aria-label="加载中" className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" role="status">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton className="aspect-square rounded-xl" key={i} />
          ))}
        </div>
      ) : c.items.length === 0 ? (
        <EmptyState
          description={c.empty.hint}
          icon={<History className="size-6" />}
          minHeightClass="min-h-75"
          title={c.empty.title}
        />
      ) : (
        <div className="grid gap-3.5" style={assetGridStyle(c.size)}>
          {c.items.map((item) => (
            <AssetCard
              asset={item}
              key={item.id}
              onOpenDetail={c.openDetail}
              onRemove={(target) => {
                c.openRemove(target.id);
              }}
            />
          ))}
        </div>
      )}

      {/* ── 右下角悬浮大小滑块 ── */}
      <AssetSizeSlider onChange={c.setSize} size={c.size} />

      {/* ── 详情弹窗（完整生成参数） ── */}
      <AssetDetailModal asset={c.detail} loading={c.detailLoading} onClose={c.closeDetail} />

      {/* ── 删除确认（非阻塞，与历史页同一纪律） ── */}
      <ConfirmDialog
        confirmLabel="删除"
        danger
        description={
          removeTargetAsset === null
            ? ""
            : `即将删除「${removeTargetAsset.name}」。资产文件将一并从磁盘清除；原任务的产物不受影响。`
        }
        onClose={c.cancelRemove}
        onConfirm={c.confirmRemove}
        open={c.removeTarget !== null}
        title="删除这份资产？"
      />
    </DocumentFrame>
  );
}
