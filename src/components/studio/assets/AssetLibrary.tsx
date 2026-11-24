"use client";

/**
 * `AssetLibrary` — 资产库页（ISSUE #4868 建页；#4943 改为目录树版式）。
 *
 * 左栏：归属两档（公共 / 项目）+ 目录树——7 个固定分类作根，用户子目录
 * 可多级新建 / 重命名 / 删除（空目录），点节点即按「分类 + 目录前缀」过滤；
 * 右栏：搜索 + 方形缩略图网格 + 大小滑块。目录树的取数与目录管理在
 * `useAssetFolders`，列表 / 详情 / 删除在 `useAssetLibrary`，本文件只做
 * 组合与弹层编排（规范 17 §17.2 第④层，不出现取数与业务规则）。
 */
import { useState } from "react";
import { History, Search } from "lucide-react";

import { DocumentFrame } from "~/components/studio/ViewContainer";
import { pageHeaderTitle } from "~/components/studio/NavItems";
import { AuroraBackground } from "~/components/ui/aurora-background";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { EmptyState } from "~/components/ui/empty-state";
import { Input } from "~/components/ui/input";
import { EMBEDDED_SCROLL_MAX_HEIGHT } from "~/components/ui/overlay-max-height";
import { PageHeader } from "~/components/ui/page-header";
import { SelectChip } from "~/components/ui/select-chip";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import { isPathInFolder, rewritePathPrefix, type FolderNode } from "~/lib/media/asset-folders";

import { AssetCard } from "./AssetCard";
import { AssetDetailModal } from "./AssetDetailModal";
import { AssetFolderNameDialog } from "./AssetFolderNameDialog";
import { AssetFolderPickerDialog } from "./AssetFolderPickerDialog";
import { AssetFolderTree } from "./AssetFolderTree";
import { AssetSizeSlider } from "./AssetSizeSlider";
import { useAssetFolders } from "./hooks/use-asset-folders";
import { assetGridStyle, useAssetLibrary } from "./hooks/use-asset-library";

/** 归属两档（「全部」档随目录树改版移除：目录按归属分棵，跨档合并会让目录归属产生歧义）。 */
const SCOPES = [
  { key: "public", label: "公共资产" },
  { key: "project", label: "项目资产" },
] as const;

/** 目录命名弹窗的请求（新建 / 重命名共用一个弹窗）。 */
type FolderNameRequest =
  | { mode: "create"; parentPath: string | null }
  | { mode: "rename"; name: string; path: string };

export function AssetLibrary() {
  const c = useAssetLibrary();
  const folders = useAssetFolders({ category: c.category, q: c.q, scope: c.scope });

  /* 删除确认的目标行（ConfirmDialog 文案要名字）。 */
  const removeTargetAsset = c.items.find((item) => item.id === c.removeTarget) ?? null;

  /* 目录弹层状态：命名（新建 / 重命名）、删除确认、移动资产。 */
  const [folderNameRequest, setFolderNameRequest] = useState<FolderNameRequest | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<FolderNode | null>(null);
  const [moveTargetId, setMoveTargetId] = useState<string | null>(null);
  const moveTargetAsset = c.items.find((item) => item.id === moveTargetId) ?? null;

  /** 命名弹窗提交：新建 / 重命名各走逻辑层的对应动作；成功即关弹窗。 */
  const submitFolderName = async (name: string): Promise<boolean> => {
    if (folderNameRequest === null) {
      return false;
    }
    if (folderNameRequest.mode === "create") {
      return folders.createFolder(folderNameRequest.parentPath, name) !== null;
    }
    const newPath = await folders.renameFolder(folderNameRequest.path, name);
    /* 当前选中的目录若在改名子树里，选中态跟随新路径，避免「选中项凭空消失」。 */
    if (
      newPath !== null &&
      c.subdirPath !== null &&
      isPathInFolder(c.subdirPath, folderNameRequest.path)
    ) {
      c.selectFolder(rewritePathPrefix(c.subdirPath, folderNameRequest.path, newPath));
    }
    return newPath !== null;
  };

  return (
    <DocumentFrame
      backdrop={<AuroraBackground />}
      className="px-4 pt-4 pb-6 sm:px-8 sm:pt-5 sm:pb-8"
      /* #5002：目录树要贴齐内容区左边距 —— wide 档的 1200px 居中列在宽屏
       * 左侧留大片空白；full 档不封顶，只留容器自己的 px-* 内边距。 */
      width="full"
    >
      <PageHeader srTitle={pageHeaderTitle("assets")} />

      <div className="flex gap-5">
        {/* ── 左栏：归属两档 + 目录树 ── */}
        <aside className="w-56 shrink-0">
          <div aria-label="按归属筛选" className="mb-3 flex flex-wrap gap-2" role="radiogroup">
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
          {/* 目录树的滚动上限走共享档（design-md 契约：浮层/内嵌滚动高度不写vh字面量）。 */}
          <div
            className={cn("custom-scrollbar overflow-y-auto pr-1 pb-2", EMBEDDED_SCROLL_MAX_HEIGHT)}
          >
            <AssetFolderTree
              category={c.category}
              categoryTotals={folders.categoryTotals}
              loading={folders.loading}
              onCreateFolder={(parentPath) => {
                setFolderNameRequest({ mode: "create", parentPath });
              }}
              onDeleteFolder={setFolderToDelete}
              onRenameFolder={(path, name) => {
                setFolderNameRequest({ mode: "rename", name, path });
              }}
              onSelectCategory={c.switchCategory}
              onSelectFolder={c.selectFolder}
              subdirPath={c.subdirPath}
              treesByCategory={folders.treesByCategory}
            />
          </div>
        </aside>

        {/* ── 右栏：搜索 + 资产网格（方形缩略图；列宽随大小滑块走） ── */}
        <section className="min-w-0 flex-1">
          <div className="relative mb-4 w-56">
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

          {c.loading ? (
            <div
              aria-label="加载中"
              className="grid grid-cols-2 gap-3.5 lg:grid-cols-4"
              role="status"
            >
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
                  onMove={(target) => {
                    setMoveTargetId(target.id);
                  }}
                  onOpenDetail={c.openDetail}
                  onRemove={(target) => {
                    c.openRemove(target.id);
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ── 右下角悬浮大小滑块 ── */}
      <AssetSizeSlider onChange={c.setSize} size={c.size} />

      {/* ── 详情弹窗（完整生成参数） ── */}
      <AssetDetailModal asset={c.detail} onClose={c.closeDetail} open={c.detailId !== null} />

      {/* ── 资产删除确认（非阻塞，与历史页同一纪律） ── */}
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

      {/* ── 目录删除确认（只对空目录开放，判据在逻辑层） ── */}
      <ConfirmDialog
        confirmLabel="删除"
        danger
        description={
          folderToDelete === null
            ? ""
            : `即将删除空目录「${folderToDelete.name}」。目录里没有资产，删除不影响任何文件。`
        }
        onClose={() => {
          setFolderToDelete(null);
        }}
        onConfirm={() => {
          if (folderToDelete === null) {
            return;
          }
          const ok = folders.deleteFolder(folderToDelete);
          if (ok && c.subdirPath === folderToDelete.path) {
            c.selectFolder(null);
          }
          setFolderToDelete(null);
        }}
        open={folderToDelete !== null}
        title="删除这个目录？"
      />

      {/* ── 新建 / 重命名目录命名弹窗（条件挂载：每次打开都是新表单） ── */}
      {folderNameRequest !== null && (
        <AssetFolderNameDialog
          initialName={folderNameRequest.mode === "rename" ? folderNameRequest.name : ""}
          onClose={() => {
            setFolderNameRequest(null);
          }}
          onSubmit={submitFolderName}
          pending={folders.pending}
          title={folderNameRequest.mode === "rename" ? "重命名目录" : "新建子目录"}
        />
      )}

      {/* ── 移动资产到目录的选择弹窗 ── */}
      <AssetFolderPickerDialog
        assetName={moveTargetAsset?.name ?? ""}
        currentPath={moveTargetAsset?.subdir ?? null}
        onClose={() => {
          setMoveTargetId(null);
        }}
        onSelect={(path) => folders.moveAsset(moveTargetAsset?.id ?? "", path)}
        open={moveTargetId !== null}
        pending={folders.pending}
        tree={folders.treesByCategory[c.category] ?? []}
      />
    </DocumentFrame>
  );
}
