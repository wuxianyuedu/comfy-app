/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Download,
  FileText,
  Folder,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Music,
  Plus,
  Search,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { MediaThumbnail as MediaThumb } from "@/components/studio/ui/MediaThumbnail";

/* ── Types (mirror /api/materials 响应) ─────────────────────── */

interface MaterialFolder {
  id: string;
  name: string;
  count: number;
}

type MaterialKind = "image" | "video" | "audio" | "doc";

interface MaterialItem {
  id: string;
  name: string;
  folder: string;
  folderName: string;
  kind: MaterialKind;
  url: string;
  size: number;
  updatedAt: string;
  scope: string;
}

type MaterialScope = "project" | "cross";
type DisplayMode = "grid" | "list";

/* ── Helpers ───────────────────────────────────────────────── */

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 分类图标底色：图片/视频/音频/文档各一套，和历史记录面板保持同一语言。 */
const KIND_STYLE: Record<MaterialKind, string> = {
  image: "bg-violet-500/10 text-violet-400",
  video: "bg-blue-500/10 text-blue-400",
  audio: "bg-emerald-500/10 text-emerald-400",
  doc: "bg-white/4 text-gray-400",
};

function KindIcon({ kind }: { kind: MaterialKind }) {
  if (kind === "image") return <ImageIcon size={18} strokeWidth={1.8} />;
  if (kind === "video") return <Video size={18} strokeWidth={1.8} />;
  if (kind === "audio") return <Music size={18} strokeWidth={1.8} />;
  return <FileText size={18} strokeWidth={1.8} />;
}

/* ── Component ─────────────────────────────────────────────── */

interface MaterialLibraryPanelProps {
  onClose: () => void;
  /** 当前画布项目 id；为空时只能看到共享素材，上传会被禁用。 */
  projectId?: string | null;
  /** 把素材投放到画布（由 ProjectCanvas 实现建节点）。 */
  onUse?: (item: MaterialItem) => void;
}

export function MaterialLibraryPanel({
  onClose,
  projectId,
  onUse,
}: MaterialLibraryPanelProps) {
  const [scope, setScope] = useState<MaterialScope>("project");
  const [display, setDisplay] = useState<DisplayMode>("grid");
  const [search, setSearch] = useState("");
  /** null = 停在分类列表；非空 = 进入了某个分类 */
  const [folder, setFolder] = useState<string | null>(null);

  const [folders, setFolders] = useState<MaterialFolder[]>([]);
  const [items, setItems] = useState<MaterialItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  /** 递增触发重新拉取（上传/删除后刷新） */
  const [reloadKey, setReloadKey] = useState(0);
  const refresh = useCallback(() => setReloadKey((key) => key + 1), []);

  /* ── 拉取素材（搜索做 250ms 防抖）── */
  useEffect(() => {
    let cancelled = false;
    const q = search.trim();

    const run = async () => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (projectId) params.set("projectId", projectId);
      params.set("scope", scope);
      if (q) params.set("q", q);
      else if (folder) params.set("folder", folder);

      try {
        const res = await fetch(`/api/materials?${params.toString()}`);
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d?.error ?? `请求失败 (${res.status})`);
        }
        const d = await res.json();
        if (cancelled) return;
        setFolders(Array.isArray(d.folders) ? d.folders : []);
        setItems(Array.isArray(d.items) ? d.items : []);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? "读取素材库失败");
        setFolders([]);
        setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const t = setTimeout(() => {
      void run();
    }, q ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [projectId, scope, folder, search, reloadKey]);

  /* ── 上传 ── */
  const doUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    // 分类列表页上传时默认丢进「参考素材」
    const target = folder ?? "ref";
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("folder", target);
        if (projectId) fd.append("projectId", projectId);
        else fd.append("shared", "true");
        const res = await fetch("/api/materials", { method: "POST", body: fd });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d?.error ?? `上传失败 (${res.status})`);
        }
      }
      refresh();
    } catch (e: any) {
      setError(e?.message ?? "上传失败");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /* ── 删除 ── */
  const doDelete = async (item: MaterialItem) => {
    setError(null);
    try {
      const res = await fetch(`/api/materials?id=${encodeURIComponent(item.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? `删除失败 (${res.status})`);
      }
      // 乐观移除，再拉一次校准计数
      setItems((prev) => prev.filter((prev) => prev.id !== item.id));
      refresh();
    } catch (e: any) {
      setError(e?.message ?? "删除失败");
    }
  };

  const searching = search.trim().length > 0;
  /** 展示条目视图的条件：搜索中，或已进入某分类 */
  const showItems = searching || folder !== null;

  /* ── 面包屑路径段（支持多级，每段独立可点击）── */
  const breadcrumbSegments: { label: string; key: string | null }[] = searching
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

  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col overflow-hidden border-l border-white/6 bg-(--color-panel)/98 backdrop-blur-md">
      {/* ── Header ── */}
      <div className="flex items-center gap-2 border-b border-white/6 px-4 py-3">
        <h2 className="flex-1 text-[15px] font-semibold text-gray-100">素材库</h2>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-white/6 hover:text-gray-300"
          title="素材保存在 public/generated/materials 下，可直接把文件丢进对应分类目录"
        >
          <CircleHelp size={14} />
        </button>
        {/* 显示密度切换 */}
        <div className="flex items-center gap-0.5 rounded-lg bg-white/4 p-0.5">
          <button
            type="button"
            onClick={() => setDisplay("grid")}
            className={`rounded-md p-1 transition-colors ${display === "grid" ? "bg-white/10 text-gray-200" : "text-gray-500 hover:text-gray-300"}`}
            title="网格视图"
          >
            <LayoutGrid size={14} />
          </button>
          <button
            type="button"
            onClick={() => setDisplay("list")}
            className={`rounded-md p-1 transition-colors ${display === "list" ? "bg-white/10 text-gray-200" : "text-gray-500 hover:text-gray-300"}`}
            title="列表视图"
          >
            <List size={14} />
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-white/6 hover:text-gray-300"
          title="关闭"
        >
          <X size={14} />
        </button>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-4 border-b border-white/6 px-4 pt-2">
        {([
          { id: "project" as MaterialScope, label: "本项目" },
          { id: "cross" as MaterialScope, label: "跨项目" },
        ]).map((scopeItem) => (
          <button
            key={scopeItem.id}
            type="button"
            onClick={() => {
              setScope(scopeItem.id);
              setFolder(null);
            }}
            className={`pb-2.5 text-[13px] font-medium transition-colors ${
              scope === scopeItem.id
                ? "border-b-2 border-(--color-accent) text-gray-100"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {scopeItem.label}
          </button>
        ))}
      </div>

      {/* ── Search + upload ── */}
      <div className="flex items-center gap-2 px-4 py-3">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-white/8 bg-white/3 px-3 py-2">
          <Search size={14} className="shrink-0 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={folder ? "在当前分类搜索" : "搜索全部素材"}
            className="min-w-0 flex-1 bg-transparent text-[12px] text-gray-200 outline-none placeholder:text-gray-600"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="shrink-0 text-gray-600 transition-colors hover:text-gray-300"
              title="清空"
            >
              <X size={12} strokeWidth={2.5} />
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => doUpload(event.target.files)}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-white/6 hover:text-gray-200 disabled:opacity-40"
          title={folder ? `上传到「${folders.find((fld) => fld.id === folder)?.name ?? folder}」` : "上传到「参考素材」"}
        >
          {uploading ? (
            <svg width="16" height="16" viewBox="0 0 24 24" className="animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
              <path d="M21 12a9 9 0 00-9-9" strokeLinecap="round" />
            </svg>
          ) : (
            <Plus size={16} strokeWidth={1.8} />
          )}
        </button>
      </div>

      {/* ── Breadcrumb（多级路径，每段独立可点击）── */}
      <div className="flex items-center px-4 pb-2">
        {breadcrumbSegments.map((seg, i) => {
          const isLast = i === breadcrumbSegments.length - 1;
          const isCurrent = isLast && !searching;
          return (
            <span key={seg.key} className="inline-flex items-center">
              {i > 0 && (
                <span className="mx-1.5 text-[11px] text-gray-600">/</span>
              )}
              {isLast || searching ? (
                /* 最后一段 / 搜索结果：纯展示 */
                <span
                  className={`text-[12px] ${
                    isCurrent ? "text-gray-200 font-medium" : "text-gray-400"
                  }`}
                >
                  {seg.label}
                </span>
              ) : (
                /* 中间段：可点击返回该级 */
                <button
                  type="button"
                  onClick={() => setFolder(seg.key)}
                  className="text-[12px] text-gray-500 transition-colors hover:text-violet-300 hover:underline"
                >
                  {seg.label}
                </button>
              )}
            </span>
          );
        })}
        {/* 返回按钮：仅在进入某分类且非搜索时显示 */}
        {showItems && !searching && folder && (
          <button
            type="button"
            onClick={() => setFolder(null)}
            className="ml-auto flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] text-gray-500 transition-colors hover:bg-white/6 hover:text-gray-300"
          >
            <ChevronLeft size={11} strokeWidth={2.5} />
            返回
          </button>
        )}
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="mx-4 mb-2 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
          <span className="min-w-0 flex-1 break-words text-[11px] text-red-300">{error}</span>
          <button
            type="button"
            onClick={refresh}
            className="shrink-0 text-[11px] text-red-200 underline transition-colors hover:text-red-100"
          >
            重试
          </button>
        </div>
      )}

      {/* ── Content ── */}
      <div className="min-w-0 flex-1 overflow-y-auto px-2 pb-4">
        {loading ? (
          /* Skeleton */
          <div className="space-y-1 px-2 pt-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={`skeleton-${i}`} className="flex items-center gap-3 py-2">
                <div className="h-9 w-9 shrink-0 animate-pulse rounded-lg bg-white/5" />
                <div className="h-3 flex-1 animate-pulse rounded bg-white/5" />
              </div>
            ))}
          </div>
        ) : showItems ? (
          items.length === 0 ? (
            /* 空状态：大图标 + 提示文案 + 操作引导 */
            <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
              {/* 文件夹图标 */}
              <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-2xl border border-white/8 bg-white/2">
                <Folder size={40} strokeWidth={1.2} className="text-gray-600" />
              </div>
              <p className="text-[14px] font-medium text-gray-400">
                {searching ? "没有匹配的素材" : "暂无内容"}
              </p>
              {!searching && (
                <div className="mt-4 space-y-2 text-[12px] text-gray-600">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-2 transition-colors hover:text-violet-400"
                  >
                    <Plus size={14} />
                    点击 + 或右键菜单创建内容
                  </button>
                  <p className="flex items-center gap-2">
                    <Download size={14} strokeWidth={1.8} />
                    也可以从画布拖入素材保存到这里
                  </p>
                </div>
              )}
            </div>
          ) : display === "grid" ? (
            /* 网格视图 */
            <div className="grid grid-cols-2 gap-2 px-1 pt-1">
              {items.map((item) => (
                <div
                  key={item.id}
                  draggable={item.kind === "image" || item.kind === "video"}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(
                      "application/x-comfyapp-media",
                      JSON.stringify({ url: item.url, displayName: item.name, mediaType: item.kind })
                    );
                    event.dataTransfer.effectAllowed = "copy";
                  }}
                  className={`group relative overflow-hidden rounded-lg border border-white/6 bg-white/2 ${
                    item.kind === "image" || item.kind === "video" ? "cursor-grab active:cursor-grabbing" : ""
                  }`}
                >
                  <div className="flex aspect-square items-center justify-center overflow-hidden bg-black/20">
                    {item.kind === "image" || item.kind === "video" ? (
                      <MediaThumb
                        src={item.url}
                        alt={item.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${KIND_STYLE[item.kind]}`}>
                        <KindIcon kind={item.kind} />
                      </div>
                    )}
                  </div>
                  <p className="truncate px-2 py-1.5 text-[11px] text-gray-300">{item.name}</p>
                  {/* hover 操作 */}
                  <div className="absolute right-1 top-1 hidden gap-1 group-hover:flex">
                    {onUse && (
                      <button
                        type="button"
                        onClick={() => onUse(item)}
                        className="flex h-6 w-6 items-center justify-center rounded bg-black/60 text-gray-300 backdrop-blur transition-colors hover:text-white"
                        title="加入画布"
                      >
                        <Plus size={12} strokeWidth={2.5} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => doDelete(item)}
                      className="flex h-6 w-6 items-center justify-center rounded bg-black/60 text-gray-300 backdrop-blur transition-colors hover:text-red-400"
                      title="删除"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* 列表视图 */
            <div className="space-y-0.5">
              {items.map((item) => (
                <div
                  key={item.id}
                  draggable={item.kind === "image" || item.kind === "video"}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(
                      "application/x-comfyapp-media",
                      JSON.stringify({ url: item.url, displayName: item.name, mediaType: item.kind })
                    );
                    event.dataTransfer.effectAllowed = "copy";
                  }}
                  className={`group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-white/4 ${
                    item.kind === "image" || item.kind === "video" ? "cursor-grab active:cursor-grabbing" : ""
                  }`}
                >
                  {item.kind === "image" || item.kind === "video" ? (
                    <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-black/20">
                      <MediaThumb src={item.url} alt={item.name} className="h-full w-full object-cover" />
                    </div>
                  ) : (
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${KIND_STYLE[item.kind]}`}>
                      <KindIcon kind={item.kind} />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-gray-200">{item.name}</p>
                    <p className="mt-0.5 text-[11px] text-gray-600">
                      {searching ? `${item.folderName} · ` : ""}
                      {formatSize(item.size)}
                    </p>
                  </div>
                  <div className="hidden shrink-0 items-center gap-1 pr-1 group-hover:flex">
                    {onUse && (
                      <button
                        type="button"
                        onClick={() => onUse(item)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-white/8 hover:text-gray-200"
                        title="加入画布"
                      >
                        <Plus size={13} strokeWidth={2.5} />
                      </button>
                    )}
                    <a
                      href={item.url}
                      download={item.name}
                      draggable={false}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-white/8 hover:text-gray-200"
                      title="下载"
                    >
                      <Download size={13} />
                    </a>
                    <button
                      type="button"
                      onClick={() => doDelete(item)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-white/8 hover:text-red-400"
                      title="删除"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          /* 分类列表 — 响应 display 网格/列表切换 */
          display === "grid" ? (
            <div className="grid grid-cols-3 gap-2 px-1 pt-1">
              {folders.map((folder) =>
(
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => setFolder(folder.id)}
                  className="group flex flex-col items-center gap-2 rounded-lg border border-white/6 bg-white/2 py-4 transition-colors hover:bg-white/4 hover:border-white/10"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-linear-to-br from-yellow-500/20 to-orange-500/10 text-yellow-400/80">
                    <Folder size={22} strokeWidth={1.8} />
                  </div>
                  <span className="min-w-0 truncate text-center text-[12px] text-gray-300">{folder.name}</span>
                  {folder.count > 0 && (
                    <span className="text-[10px] tabular-nums text-gray-600">{folder.count}</span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-0.5">
              {folders.map((folder) =>
(
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => setFolder(folder.id)}
                  className="group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-white/4"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-yellow-500/20 to-orange-500/10 text-yellow-400/80">
                    <Folder size={18} strokeWidth={1.8} />
                  </div>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-gray-200">{folder.name}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-gray-600">
                    {folder.count > 0 ? folder.count : ""}
                  </span>
                  <ChevronRight size={12} strokeWidth={2.5} className="shrink-0 text-gray-700 group-hover:text-gray-500" />
                </button>
              ))}
            </div>
          )
        )}
      </div>
    </aside>
  );
}
