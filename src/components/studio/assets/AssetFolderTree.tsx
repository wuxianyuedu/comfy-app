"use client";

/**
 * `AssetFolderTree` — 资产库左侧的目录树（ISSUE #4943）。
 *
 * 7 个固定分类作为根节点（不可增删改名，点击 = 选中该分类）；分类下挂用户
 * 自建的多级子目录，点击目录 = 选中（过滤右侧网格）并展开/收起。目录行的
 * 悬停动作：新建子目录 / 重命名 / 删除（删除只对「空且无下级」的目录开放，
 * 判据由逻辑层把关，这里只负责把不该点的藏起来）。
 *
 * 折叠交互与 a11y 走 `Disclosure`、缩进与引导线走 `TreeChildren`
 * （树形三基元复用，与 workshop 的模型树同款手法）；本文件只管渲染与回调
 * （规范 17 §17.2 第③层：不出现取数与业务规则）。
 */
import { Folder, FolderPlus, Pencil, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Disclosure } from "~/components/ui/disclosure";
import { Skeleton } from "~/components/ui/skeleton";
import { TreeChildren } from "~/components/ui/tree-rows";
import { useExpansionSet } from "~/components/ui/expansion-set";
import { cn } from "~/lib/utils";
import type { FolderNode } from "~/lib/media/asset-folders";

import { ASSET_CATEGORIES, assetCategoryLabel } from "./asset-categories";

export type AssetFolderTreeProps = {
  /** 当前选中的分类键。 */
  category: string;
  /** 各分类的资产总数（根节点角标）。 */
  categoryTotals: Record<string, number>;
  loading: boolean;
  /** 打开「新建子目录」弹窗（parentPath = null 表示挂在分类根下）。 */
  onCreateFolder: (parentPath: string | null) => void;
  /** 打开「删除目录」确认。 */
  onDeleteFolder: (node: FolderNode) => void;
  /** 打开「重命名目录」弹窗。 */
  onRenameFolder: (path: string, name: string) => void;
  onSelectCategory: (category: string) => void;
  onSelectFolder: (path: string | null) => void;
  /** 当前选中的目录路径（null = 分类根）。 */
  subdirPath: string | null;
  /** 各分类的目录树（键 = 分类键，来自逻辑层）。 */
  treesByCategory: Record<string, Array<FolderNode>>;
};

/** 计数角标（与旧分类 chip 的角标同款形态）。 */
function CountBadge({ count }: { count: number }) {
  return (
    <span className="text-3xs shrink-0 rounded-full bg-current/8 px-1.5 py-0.5 font-bold tabular-nums">
      {count}
    </span>
  );
}

export function AssetFolderTree({
  category,
  categoryTotals,
  loading,
  onDeleteFolder,
  onCreateFolder,
  onRenameFolder,
  onSelectCategory,
  onSelectFolder,
  subdirPath,
  treesByCategory,
}: AssetFolderTreeProps) {
  /* 展开表态（键 = 目录路径）。缺键默认展开：折叠是「先看别的」的临时动作。 */
  const expansion = useExpansionSet();

  /** 目录行（递归）。点击整行 = 选中该目录并切换展开。 */
  const renderFolder = (node: FolderNode, depth: number): ReactNode => {
    const open = expansion.map[node.path] ?? true;
    const selected = subdirPath === node.path;
    const deletable = node.count === 0 && node.children.length === 0;
    return (
      <Disclosure
        className={cn(
          "rounded-md pr-1 text-xs font-medium",
          selected
            ? "bg-primary-soft text-primary-strong"
            : "text-ink-muted hover:bg-subtle hover:text-ink",
        )}
        key={node.path}
        marker="chevron"
        onOpenChange={(nextOpen) => {
          onSelectFolder(node.path);
          expansion.set(node.path, nextOpen);
        }}
        open={open}
        rootClassName="group/folder-row flex items-center gap-1"
        trailing={
          <span
            aria-label={`${node.name} 的目录操作`}
            className={cn(
              "flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity",
              "group-focus-within/folder-row:opacity-100 group-hover/folder-row:opacity-100",
            )}
            role="group"
          >
            <Button
              aria-label={`在 ${node.name} 下新建子目录`}
              className="text-ink-faint hover:text-primary-strong size-6 rounded-md"
              onClick={() => {
                onCreateFolder(node.path);
              }}
              size="icon-xs"
              variant="ghost"
            >
              <FolderPlus aria-hidden className="size-3.5" data-icon="inline-start" />
            </Button>
            <Button
              aria-label={`重命名目录 ${node.name}`}
              className="text-ink-faint hover:text-primary-strong size-6 rounded-md"
              onClick={() => {
                onRenameFolder(node.path, node.name);
              }}
              size="icon-xs"
              variant="ghost"
            >
              <Pencil aria-hidden className="size-3.5" data-icon="inline-start" />
            </Button>
            {deletable && (
              <Button
                aria-label={`删除空目录 ${node.name}`}
                className="text-ink-faint hover:text-danger-strong size-6 rounded-md"
                onClick={() => {
                  onDeleteFolder(node);
                }}
                size="icon-xs"
                variant="ghost"
              >
                <Trash2 aria-hidden className="size-3.5" data-icon="inline-start" />
              </Button>
            )}
          </span>
        }
        trigger={
          <span className="flex min-w-0 flex-1 items-center gap-1.5" data-folder-path={node.path}>
            <Folder aria-hidden className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left">{node.name}</span>
            <CountBadge count={node.count} />
          </span>
        }
      >
        <TreeChildren className="flex flex-col gap-0.5" depth={depth + 1}>
          {node.children.map((child) => renderFolder(child, depth + 1))}
          <CreateFolderRow
            onCreate={() => {
              onCreateFolder(node.path);
            }}
          />
        </TreeChildren>
      </Disclosure>
    );
  };

  return (
    <nav aria-label="资产目录树" className="flex flex-col gap-1">
      {loading
        ? null
        : ASSET_CATEGORIES.map((cat) => {
            const selected = category === cat.key && subdirPath === null;
            const folders = treesByCategory[cat.key] ?? [];
            return (
              <div key={cat.key}>
                {/* 分类根：固定节点，点击 = 选中该分类（回到它的根目录）。 */}
                <Button
                  aria-current={selected ? "true" : undefined}
                  className={cn(
                    "h-auto w-full justify-start gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-semibold",
                    selected
                      ? "bg-primary-soft text-primary-strong hover:bg-primary-soft"
                      : "text-ink hover:bg-subtle",
                  )}
                  data-category={cat.key}
                  onClick={() => {
                    onSelectCategory(cat.key);
                  }}
                  variant="ghost"
                >
                  <Folder aria-hidden className="size-3.5 shrink-0" data-icon="inline-start" />
                  <span className="min-w-0 flex-1 truncate">{assetCategoryLabel(cat.key)}</span>
                  <CountBadge count={categoryTotals[cat.key] ?? 0} />
                </Button>
                <TreeChildren className="flex flex-col gap-0.5" depth={1}>
                  {folders.map((node) => renderFolder(node, 1))}
                  <CreateFolderRow
                    onCreate={() => {
                      onCreateFolder(null);
                    }}
                  />
                </TreeChildren>
              </div>
            );
          })}
      {loading && (
        <div aria-label="目录加载中" className="flex flex-col gap-2 px-2 py-1" role="status">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton className="h-5 w-full rounded-md" key={i} />
          ))}
        </div>
      )}
    </nav>
  );
}

/** 目录列表末尾的「新建子目录」虚线行。 */
function CreateFolderRow({ onCreate }: { onCreate: () => void }) {
  return (
    <Button
      className="text-ink-fainter hover:border-primary-500/40 hover:text-primary-strong hover:border-border h-auto w-full justify-center gap-1 rounded-md border border-dashed border-transparent px-2 py-1"
      onClick={onCreate}
      size="xs"
      variant="ghost"
    >
      <FolderPlus aria-hidden className="size-3" data-icon="inline-start" />
      新建子目录
    </Button>
  );
}
