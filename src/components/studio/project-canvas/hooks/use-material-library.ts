"use client";

// ── 素材库面板：逻辑层（规范 17 §17.2 第②层）────────────────────────────────
// 承载搜索防抖、列表拉取、上传、删除与错误提示；MaterialLibraryPanel 视图
// 只消费本 hook 返回的 controller，不再自己发请求。

import { useCallback, useEffect, useRef, useState } from "react";

import {
  deleteMaterial,
  fetchMaterials,
  uploadMaterial,
  type MaterialFolder,
  type MaterialItem,
} from "~/lib/media/materials-client";

/** 搜索防抖：有关键字时延迟 250ms 再发请求，逐字输入不打爆后端。 */
const SEARCH_DEBOUNCE_MS = 250;

export type MaterialScope = "project" | "cross";

export interface MaterialLibraryController {
  scope: MaterialScope;
  folder: string | null;
  search: string;
  folders: MaterialFolder[];
  items: MaterialItem[];
  loading: boolean;
  uploading: boolean;
  /**
   * 当前要展示的错误文案；null 表示无错误。
   * 动作错误优先于拉取错误——否则一次后台刷新会把刚报出来的
   * 「上传失败」悄悄吞掉（用户看到提示条闪一下就没了）。
   */
  error: string | null;
  /** 是否处于搜索态。 */
  searching: boolean;
  /** 展示条目视图的条件：搜索中，或已进入某分类。 */
  showItems: boolean;
  /** 面包屑路径段，每段可点击返回该级。 */
  breadcrumbSegments: Array<{ label: string; key: string | null }>;
  fileRef: React.RefObject<HTMLInputElement | null>;
  setScope: (scope: MaterialScope) => void;
  setSearch: (value: string) => void;
  enterFolder: (folder: string | null) => void;
  upload: (files: FileList | null) => Promise<void>;
  remove: (item: MaterialItem) => Promise<void>;
  refresh: () => void;
}

export interface UseMaterialLibraryOptions {
  /** 当前画布项目 id；为空时只能看共享素材，上传会被禁用。 */
  projectId?: string | null;
}

/** 把 unknown 抛值捞成中文消息——失败路径始终有可读文案（硬规则）。 */
function errMsg(e: unknown, fallback: string): string {
  if (typeof e === "object" && e !== null && "message" in e) {
    const m: unknown = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return fallback;
}

export function useMaterialLibrary({
  projectId,
}: UseMaterialLibraryOptions): MaterialLibraryController {
  const [scope, setScopeState] = useState<MaterialScope>("project");
  const [search, setSearch] = useState("");
  /** null = 停在分类列表；非空 = 进入了某个分类 */
  const [folder, setFolder] = useState<string | null>(null);
  const [folders, setFolders] = useState<MaterialFolder[]>([]);
  const [items, setItems] = useState<MaterialItem[]>([]);
  const [loading, setLoading] = useState(true);
  /** 拉取失败的错误（重新拉取成功即消失）。 */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 上传/删除等动作失败的错误（不会被后台刷新吞掉，用户点「重试」才清）。 */
  const [actionError, setActionError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  /** 递增触发重新拉取（上传/删除后刷新）。 */
  const [reloadKey, setReloadKey] = useState(0);

  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    setActionError(null);
    setReloadKey((key) => key + 1);
  }, []);
  const setScope = useCallback((next: MaterialScope) => {
    setScopeState(next);
    // 切换「本项目 / 跨项目」后目录结构变了，退回分类列表避免停在空分类
    setFolder(null);
  }, []);
  const enterFolder = useCallback((next: string | null) => setFolder(next), []);

  /* ── 拉取素材（搜索做防抖）── */
  useEffect(() => {
    let cancelled = false;
    const q = search.trim();

    const run = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const result = await fetchMaterials({
          projectId,
          scope,
          // 搜索优先于 folder：与后端 /api/materials 的取值顺序一致（有 q 时忽略 folder）
          folder: q ? null : folder,
          q: q || undefined,
        });
        if (cancelled) return;
        setFolders(result.folders);
        setItems(result.items);
      } catch (e) {
        if (cancelled) return;
        setLoadError(errMsg(e, "读取素材库失败"));
        setFolders([]);
        setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const t = setTimeout(
      () => {
        void run();
      },
      q ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [projectId, scope, folder, search, reloadKey]);

  /* ── 上传（分类列表页上传时默认丢进「参考素材」）── */
  const upload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const target = folder ?? "ref";
      setUploading(true);
      setActionError(null);
      try {
        for (const file of Array.from(files)) {
          await uploadMaterial(file, { folder: target, projectId });
        }
        refresh();
      } catch (e) {
        setActionError(errMsg(e, "上传失败"));
      } finally {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [folder, projectId, refresh],
  );

  /* ── 删除 ── */
  const remove = useCallback(
    async (item: MaterialItem) => {
      setActionError(null);
      try {
        await deleteMaterial(item.id);
        // 乐观移除，再拉一次校准计数
        setItems((prev) => prev.filter((prev) => prev.id !== item.id));
        refresh();
      } catch (e) {
        setActionError(errMsg(e, "删除失败"));
      }
    },
    [refresh],
  );

  const searching = search.trim().length > 0;
  const showItems = searching || folder !== null;

  const breadcrumbSegments: Array<{ label: string; key: string | null }> =
    searching
      ? [{ label: `搜索结果 · ${items.length}`, key: null }]
      : folder
        ? [
            { label: "全部", key: null },
            {
              label: folders.find((fld) => fld.id === folder)?.name ?? folder,
              key: folder,
            },
          ]
        : [{ label: "全部", key: null }];

  return {
    scope,
    folder,
    search,
    folders,
    items,
    loading,
    uploading,
    error: actionError ?? loadError,
    searching,
    showItems,
    breadcrumbSegments,
    fileRef,
    setScope,
    setSearch,
    enterFolder,
    upload,
    remove,
    refresh,
  };
}
