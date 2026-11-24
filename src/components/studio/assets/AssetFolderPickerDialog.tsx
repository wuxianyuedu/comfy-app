"use client";

/**
 * `AssetFolderPickerDialog` — 把资产移动到目录的选择弹窗（ISSUE #4943）。
 * 目录树摊平成带缩进的行列表（`flattenFolderTree` + `indentClass`，与树形
 * 基元同源），「分类根目录」是第一个选项；资产当前所在目录禁选。
 */
import { Folder, FolderInput } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { indentClass } from "~/components/ui/tree-rows";
import { cn } from "~/lib/utils";
import { flattenFolderTree, type FolderNode } from "~/lib/media/asset-folders";

export function AssetFolderPickerDialog({
  assetName,
  currentPath,
  onClose,
  onSelect,
  open,
  pending,
  tree,
}: {
  assetName: string;
  /** 资产当前所在目录路径（null = 分类根；该选项禁选）。 */
  currentPath: string | null;
  onClose: () => void;
  /** 选择目标目录；返回 true 表示移动成功（弹窗随之关闭）。 */
  onSelect: (path: string) => Promise<boolean>;
  open: boolean;
  pending: boolean;
  /** 当前分类的目录树。 */
  tree: Array<FolderNode>;
}) {
  const rows = flattenFolderTree(tree);
  const choose = async (path: string) => {
    if (pending) {
      return;
    }
    const ok = await onSelect(path);
    if (ok) {
      onClose();
    }
  };

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
      open={open}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>移动资产</DialogTitle>
          <DialogDescription>
            把「{assetName}」移动到其他目录（含其子目录也会随资产落位展示）。
          </DialogDescription>
        </DialogHeader>
        <div
          aria-label="选择目标目录"
          className="flex max-h-72 flex-col gap-0.5 overflow-y-auto"
          role="radiogroup"
        >
          <Button
            aria-checked={currentPath === null}
            className={cn(
              "w-full justify-start",
              currentPath === null && "pointer-events-none opacity-50",
            )}
            disabled={pending}
            onClick={() => {
              void choose("");
            }}
            role="radio"
            size="xs"
            variant={currentPath === null ? "secondary" : "ghost"}
          >
            <Folder aria-hidden className="size-3.5" data-icon="inline-start" />
            分类根目录
          </Button>
          {rows.map((node) => {
            const current = node.path === currentPath;
            return (
              <Button
                aria-checked={current}
                className={cn(
                  "w-full justify-start",
                  indentClass(node.depth + 1),
                  current && "pointer-events-none opacity-50",
                )}
                disabled={pending}
                key={node.path}
                onClick={() => {
                  void choose(node.path);
                }}
                role="radio"
                size="xs"
                variant={current ? "secondary" : "ghost"}
              >
                <Folder aria-hidden className="size-3.5" data-icon="inline-start" />
                <span className="min-w-0 flex-1 truncate text-left">{node.name}</span>
              </Button>
            );
          })}
        </div>
        <div className="flex items-center justify-end">
          <Button onClick={onClose} size="xs" variant="outline">
            取消
          </Button>
        </div>
        <p className="text-ink-fainter text-2xs flex items-center gap-1.5">
          <FolderInput aria-hidden className="size-3.5" />
          移动后资产的分类归属不变，只改目录落位。
        </p>
      </DialogContent>
    </Dialog>
  );
}
