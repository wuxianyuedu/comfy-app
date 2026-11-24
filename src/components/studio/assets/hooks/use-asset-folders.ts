"use client";

// ── 资产库目录树：逻辑层（规范 17 §17.2 第②层）──────────────────────────
// 目录树的取数（asset.folderTree 分组计数）、空目录声明（localStorage）、
// 新建 / 重命名 / 删除目录与移动资产的动作都在这里；AssetLibrary 视图只消费
// 本 hook 返回的 controller。目录本身不落库：树 = 资产 subdir 前缀 ∪ 声明的
// 空目录（桌包对已有库没有增量建表机制，见诉求单 #4943 的约束说明）。

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { readStorageJson, writeStorageJson } from "~/lib/browser-storage";
import { runAsyncAction } from "~/lib/async-action";
import { normalizeNeedle } from "~/lib/list-filter";
import {
  addDeclaredPath,
  buildFolderTree,
  FOLDER_DECLARATIONS_KEY,
  folderDeclarationKey,
  isValidFolderName,
  joinFolderPath,
  mergeFolderPaths,
  normalizeFolderPath,
  readDeclaredPaths,
  removeDeclaredPath,
  rewriteDeclaredPrefix,
  type FolderDeclarations,
  type FolderNode,
} from "~/lib/media/asset-folders";

import { useToast } from "../../ToastProvider";
import { useTRPC } from "~/trpc/react";
import { ASSET_CATEGORIES, type AssetCategoryKey } from "../asset-categories";

/** 目录树控制器的形状（视图层只认这份契约）。 */
export type AssetFoldersController = {
  /** 各分类的资产总数（分类根角标 = 根级资产 + 全部子目录资产）。 */
  categoryTotals: Record<string, number>;
  /** 新建子目录（挂在 `parentPath` 下；根级传 null）。成功返回新路径。纯本地动作，无需等待。 */
  createFolder: (parentPath: string | null, name: string) => string | null;
  /** 删除空目录（有资产或还有子目录时拒绝并提示）。纯本地动作，无需等待。 */
  deleteFolder: (node: FolderNode) => boolean;
  /** 目录计数查询进行中（树骨架）。 */
  loading: boolean;
  /** 把一条资产移动到目录（根级传空串）。 */
  moveAsset: (assetId: string, targetPath: string) => Promise<boolean>;
  /** 任一目录写操作进行中（按钮禁用）。 */
  pending: boolean;
  /** 重命名目录（目录内资产的 subdir 前缀由服务端一并改写）。 */
  renameFolder: (oldPath: string, newName: string) => Promise<string | null>;
  /** 各分类的目录树（键 = 分类键；count = 目录及其全部后代的资产数）。 */
  treesByCategory: Record<string, Array<FolderNode>>;
};

/**
 * 目录树逻辑。`scope` / `category` / `q` 由页面（useAssetLibrary 的controller）
 * 传入：树角标与列表同口径（同 scope、同关键词过滤）。
 */
export function useAssetFolders(input: {
  category: AssetCategoryKey;
  q: string;
  scope: "public" | "project";
}): AssetFoldersController {
  const { category, scope } = input;
  /* 搜索词归一化走唯一出口（P13）：去空白 + 折小写，树角标与列表同口径。 */
  const q = normalizeNeedle(input.q);
  const trpc = useTRPC();
  const toast = useToast();
  const queryClient = useQueryClient();

  const treeQ = useQuery(
    trpc.asset.folderTree.queryOptions({
      scope,
      ...(q === "" ? {} : { q }),
    }),
  );

  /* 空目录声明从 localStorage 恢复（SSR / 隐私模式回落空表）。 */
  const [declarations, setDeclarations] = useState<FolderDeclarations>({});
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- 本地记忆 hydrate（与网格尺寸档同族）
    setDeclarations(readStorageJson<FolderDeclarations>(FOLDER_DECLARATIONS_KEY, {}));
  }, []);

  const persistDeclarations = useCallback((next: FolderDeclarations) => {
    setDeclarations(next);
    writeStorageJson(FOLDER_DECLARATIONS_KEY, next);
  }, []);

  const renameMutation = useMutation(trpc.asset.renameFolder.mutationOptions());
  const moveMutation = useMutation(trpc.asset.updateSubdir.mutationOptions());

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: trpc.asset.folderTree.queryKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.asset.list.queryKey() });
  }, [queryClient, trpc]);

  const declarationKey = folderDeclarationKey(scope, category);
  const { treesByCategory, categoryTotals } = useMemo(() => {
    const entries = treeQ.data?.entries ?? [];
    const trees: Record<string, Array<FolderNode>> = {};
    const totals: Record<string, number> = {};
    for (const cat of ASSET_CATEGORIES) {
      const directCounts = new Map<string, number>();
      let total = 0;
      for (const entry of entries) {
        if (entry.category !== cat.key) {
          continue;
        }
        total += entry.count;
        if (entry.subdir === null || entry.subdir === "") {
          continue;
        }
        directCounts.set(entry.subdir, entry.count);
      }
      const declared = readDeclaredPaths(declarations, folderDeclarationKey(scope, cat.key));
      const paths = mergeFolderPaths([...directCounts.keys()], declared);
      trees[cat.key] = buildFolderTree(
        paths.map((path) => ({ path, count: directCounts.get(path) ?? 0 })),
      );
      totals[cat.key] = total;
    }
    return { treesByCategory: trees, categoryTotals: totals };
  }, [declarations, scope, treeQ.data]);

  const createFolder = useCallback(
    (parentPath: string | null, name: string): string | null => {
      const cleanName = name.trim();
      if (!isValidFolderName(cleanName)) {
        toast.error("目录名不合法：不能为空、不能含 / 、长度不超过 60");
        return null;
      }
      const path = normalizeFolderPath(joinFolderPath(parentPath, cleanName));
      if (path === null) {
        toast.error("目录路径不合法");
        return null;
      }
      const entries = treeQ.data?.entries ?? [];
      const existsInAssets = entries.some(
        (entry) => entry.category === category && entry.subdir === path,
      );
      const declared = readDeclaredPaths(declarations, declarationKey);
      if (existsInAssets || declared.includes(path)) {
        toast.error("同名目录已存在");
        return null;
      }
      persistDeclarations({ ...declarations, [declarationKey]: addDeclaredPath(declared, path) });
      toast.info("已创建目录");
      return path;
    },
    [category, declarationKey, declarations, persistDeclarations, toast, treeQ.data],
  );

  const renameFolder = useCallback(
    async (oldPath: string, newName: string): Promise<string | null> => {
      const cleanName = newName.trim();
      if (!isValidFolderName(cleanName)) {
        toast.error("目录名不合法：不能为空、不能含 / 、长度不超过 60");
        return null;
      }
      const parentPath = oldPath.includes("/") ? oldPath.slice(0, oldPath.lastIndexOf("/")) : "";
      const newPath = normalizeFolderPath(joinFolderPath(parentPath, cleanName));
      if (newPath === null) {
        toast.error("目录路径不合法");
        return null;
      }
      if (newPath === oldPath) {
        return newPath;
      }
      const declared = readDeclaredPaths(declarations, declarationKey);
      if (declared.includes(newPath)) {
        toast.error("同名目录已存在");
        return null;
      }
      const result = await runAsyncAction(
        () =>
          renameMutation.mutateAsync({
            scope,
            category,
            oldPath,
            newPath,
          }),
        {
          report: (kind, detail) => (kind === "ok" ? toast.info(detail) : toast.error(detail)),
          failureText: "重命名目录失败",
          successText: "已重命名目录",
        },
      );
      if (!result.ok) {
        return null;
      }
      persistDeclarations({
        ...declarations,
        [declarationKey]: rewriteDeclaredPrefix(declared, oldPath, newPath),
      });
      invalidate();
      return newPath;
    },
    [
      category,
      declarationKey,
      declarations,
      invalidate,
      persistDeclarations,
      renameMutation,
      scope,
      toast,
    ],
  );

  const deleteFolder = useCallback(
    (node: FolderNode): boolean => {
      if (node.count > 0) {
        toast.error("目录里还有资产，先移走再删除");
        return false;
      }
      if (node.children.length > 0) {
        toast.error("先删除空的下级目录");
        return false;
      }
      const declared = readDeclaredPaths(declarations, declarationKey);
      persistDeclarations({
        ...declarations,
        [declarationKey]: removeDeclaredPath(declared, node.path),
      });
      toast.info("已删除目录");
      return true;
    },
    [declarationKey, declarations, persistDeclarations, toast],
  );

  const moveAsset = useCallback(
    async (assetId: string, targetPath: string): Promise<boolean> => {
      let subdir: string | null = null;
      if (targetPath !== "") {
        subdir = normalizeFolderPath(targetPath);
        if (subdir === null) {
          toast.error("目录路径不合法");
          return false;
        }
      }
      const result = await runAsyncAction(
        () => moveMutation.mutateAsync({ id: assetId, ...(subdir === null ? {} : { subdir }) }),
        {
          report: (kind, detail) => (kind === "ok" ? toast.info(detail) : toast.error(detail)),
          failureText: "移动资产失败",
          successText: "已移动资产",
        },
      );
      if (result.ok) {
        invalidate();
      }
      return result.ok;
    },
    [invalidate, moveMutation, toast],
  );

  return {
    categoryTotals,
    createFolder,
    deleteFolder,
    loading: treeQ.isPending,
    moveAsset,
    pending: renameMutation.isPending || moveMutation.isPending,
    renameFolder,
    treesByCategory,
  };
}
