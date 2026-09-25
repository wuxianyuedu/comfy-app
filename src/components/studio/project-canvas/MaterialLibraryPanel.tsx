"use client";

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
import { MediaThumbnail as MediaThumb } from "~/components/ui/media-thumbnail";
import { textHandler } from "~/lib/form-props";
import { mediaDragSourceProps } from "~/components/ui/media-drag-source";
import { useFilePicker } from "~/components/ui/file-picker";
import { fmtBytes } from "~/lib/format-bytes";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { Spinner } from "~/components/ui/spinner";
import { useState } from "react";

import {
  useMaterialLibrary,
  type MaterialScope,
} from "./hooks/use-material-library";
import type { MaterialItem } from "~/lib/media/materials-client";
import { displayValue } from "~/lib/display-value";

/* 对外类型再导出：历史消费方从本文件 import MaterialItem，保持 API 不变。 */
export type { MaterialItem };

/* ── Types ───────────────────────────────────────────────── */

type DisplayMode = "grid" | "list";

/* ── Helpers（纯展示：格式化与配色，不含业务规则）──────────── */

/** 分类图标底色 + 文件夹渐变——两处**装饰色**都属 §3.6.1 文档化例外，
 *  走 `p71-allow` 例外块而不是硬塞状态语义 token：
 *    · `KIND_STYLE`：image / video / audio / doc 的**分类识别色**——
 *      紫=图、蓝=视频、绿=音频是这套 UI 里"素材类型"的视觉语言（与
 *      历史面板同源），"绿"在这里**不是 success 状态**、是 audio 类型；
 *      没有对应的"媒体类型"语义 token，硬映射会丢信息（三种归同一 token
 *      就无法区分），全塞 status-* 更是把分类装饰错当状态色。
 *    · `FOLDER_ICON_TINT`：文件夹图标黄橙渐变——是"目录容器"的
 *      通用装饰（与 macOS / 资源管理器的文件夹色一脉相承），与状态无关。
 *  两处都是"字面量本身即语义"的形态——同 ANSI SGR 终端 8 色的判据。 */
// p71-allow:start 媒体分类识别色 + 文件夹装饰色——§3.6.1 文档化例外，颜色本身即语义
const KIND_STYLE: Record<string, string> = {
  image: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  video: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  audio: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  doc: "bg-subtle text-ink-soft",
};

/** 文件夹图标块（列表 / 网格两处都用；容器边长/圆角由调用方加）。 */
const FOLDER_ICON_TINT =
  "bg-linear-to-br from-yellow-500/20 to-orange-500/10 text-yellow-700/90 dark:text-yellow-400/80";
// p71-allow:end

function KindIcon({ kind }: { kind: string }) {
  if (kind === "image") return <ImageIcon size={18} strokeWidth={1.8} />;
  if (kind === "video") return <Video size={18} strokeWidth={1.8} />;
  if (kind === "audio") return <Music size={18} strokeWidth={1.8} />;
  return <FileText size={18} strokeWidth={1.8} />;
}

/* ── Component ───────────────────────────────────────────── */

interface MaterialLibraryPanelProps {
  onClose: () => void;
  /** 当前画布项目 id；为空时只能看到共享素材，上传会被禁用。 */
  projectId?: string | null;
  /** 把素材投放到画布（由 ProjectCanvas 实现建节点）。 */
  onUse?: (item: MaterialItem) => void;
}

/**
 * 素材库面板 —— 纯展示层（规范 17 §17.2 第③层）。
 * 状态与网络在 hooks/use-material-library.ts + lib/materials-client.ts，
 * 本文件只渲染 + 上抛事件；对外 props 与导出名保持不变，消费方零改动。
 */
export function MaterialLibraryPanel({
  onClose,
  projectId,
  onUse,
}: MaterialLibraryPanelProps) {
  const c = useMaterialLibrary({ projectId });
  /* 显示密度（网格/列表）是纯视觉偏好，与业务数据无关，留在视图层。 */
  const [display, setDisplay] = useState<DisplayMode>("grid");
  const {
    scope,
    folder,
    search,
    folders,
    items,
    loading,
    uploading,
    error,
    searching,
    showItems,
    breadcrumbSegments,
    setScope,
    setSearch,
    enterFolder,
    upload,
    remove,
    refresh,
  } = c;
  /* 素材上传选择器：多选、无类型限制（素材库也收音频/视频）。 */
  const uploadPicker = useFilePicker({
    multiple: true,
    onPick: (_first, files) => void upload(files),
  });

  return (
    <aside className="bg-panel/98 border-border-strong flex h-full w-[360px] shrink-0 flex-col overflow-hidden border-l backdrop-blur-md">
      {/* ── Header ── */}
      <div className="border-border-strong flex items-center gap-2 border-b px-4 py-3">
        <h2 className="text-ink-bright flex-1 text-[15px] font-semibold">
          素材库
        </h2>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-ink-muted hover:bg-subtle hover:text-ink-soft rounded-md"
          title="素材保存在 public/generated/materials 下，可直接把文件丢进对应分类目录"
        >
          <CircleHelp size={14} />
        </Button>
        {/* 显示密度切换 */}
        <div className="bg-subtle flex items-center gap-0.5 rounded-lg p-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setDisplay("grid")}
            className={`h-auto rounded-md p-1 ${display === "grid" ? "bg-surface-2 text-ink-bright" : "text-ink-muted hover:text-ink-soft"}`}
            title="网格视图"
          >
            <LayoutGrid size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setDisplay("list")}
            className={`h-auto rounded-md p-1 ${display === "list" ? "bg-surface-2 text-ink-bright" : "text-ink-muted hover:text-ink-soft"}`}
            title="列表视图"
          >
            <List size={14} />
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          className="text-ink-muted hover:bg-subtle hover:text-ink-soft rounded-md"
          title="关闭"
        >
          <X size={14} />
        </Button>
      </div>

      {/* ── Tabs ── */}
      <div className="border-border-strong flex gap-4 border-b px-4 pt-2">
        {[
          { id: "project" as MaterialScope, label: "本项目" },
          { id: "cross" as MaterialScope, label: "跨项目" },
        ].map((scopeItem) => (
          <Button
            key={scopeItem.id}
            variant="ghost"
            onClick={() => {
              setScope(scopeItem.id);
            }}
            className={`h-auto rounded-none px-0 pb-2.5 text-[13px] font-medium hover:bg-transparent ${
              scope === scopeItem.id
                ? "border-accent text-ink-bright border-b-2"
                : "text-ink-muted hover:text-ink-soft"
            }`}
          >
            {scopeItem.label}
          </Button>
        ))}
      </div>

      {/* ── Search + upload ── */}
      <div className="flex items-center gap-2 px-4 py-3">
        <div className="border-border-strong bg-subtle flex flex-1 items-center gap-2 rounded-lg border px-3 py-2">
          <Search size={14} className="text-ink-muted shrink-0" />
          <Input
            type="text"
            value={search}
            onChange={textHandler(setSearch)}
            placeholder={folder ? "在当前分类搜索" : "搜索全部素材"}
            className="text-ink-bright placeholder:text-ink-fainter h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-[12px] focus-visible:ring-0"
          />
          {search && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setSearch("")}
              className="text-ink-fainter hover:text-ink-soft h-auto shrink-0 p-0 hover:bg-transparent"
              title="清空"
            >
              <X size={12} strokeWidth={2.5} />
            </Button>
          )}
        </div>
        <uploadPicker.Input />
        <Button
          variant="ghost"
          size="icon"
          onClick={uploadPicker.open}
          disabled={uploading}
          className="text-ink-soft hover:bg-subtle hover:text-ink-bright rounded-lg"
          title={
            folder
              ? `上传到「${folders.find((fld) => fld.id === folder)?.name ?? folder}」`
              : "上传到「参考素材」"
          }
        >
          {uploading ? (
            <Spinner className="size-4" />
          ) : (
            <Plus size={16} strokeWidth={1.8} />
          )}
        </Button>
      </div>

      {/* ── Breadcrumb（多级路径，每段独立可点击）── */}
      <div className="flex items-center px-4 pb-2">
        {breadcrumbSegments.map((seg, i) => {
          const isLast = i === breadcrumbSegments.length - 1;
          const isCurrent = isLast && !searching;
          return (
            <span key={seg.key} className="inline-flex items-center">
              {i > 0 && (
                <span className="text-ink-fainter mx-1.5 text-[11px]">/</span>
              )}
              {isLast || searching ? (
                /* 最后一段 / 搜索结果：纯展示 */
                <span
                  className={`text-[12px] ${
                    isCurrent ? "text-ink-bright font-medium" : "text-ink-soft"
                  }`}
                >
                  {seg.label}
                </span>
              ) : (
                /* 中间段：可点击返回该级 */
                <Button
                  variant="ghost"
                  onClick={() => enterFolder(seg.key)}
                  className="text-ink-muted hover:text-primary-strong h-auto p-0 text-[12px] font-normal hover:bg-transparent hover:underline"
                >
                  {seg.label}
                </Button>
              )}
            </span>
          );
        })}
        {/* 返回按钮：仅在进入某分类且非搜索时显示 */}
        {showItems && !searching && folder && (
          <Button
            variant="ghost"
            onClick={() => enterFolder(null)}
            className="text-ink-muted hover:bg-subtle hover:text-ink-soft ml-auto h-auto shrink-0 gap-1 rounded-md px-2 py-1 text-[11px] font-normal"
          >
            <ChevronLeft size={11} strokeWidth={2.5} />
            返回
          </Button>
        )}
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="border-destructive/30 bg-destructive/10 mx-4 mb-2 flex items-start gap-2 rounded-lg border px-3 py-2">
          <span className="text-destructive min-w-0 flex-1 text-[11px] break-words">
            {error}
          </span>
          <Button
            variant="ghost"
            onClick={refresh}
            className="text-destructive h-auto shrink-0 p-0 text-[11px] underline hover:bg-transparent"
          >
            重试
          </Button>
        </div>
      )}

      {/* ── Content ── */}
      <div className="min-w-0 flex-1 overflow-y-auto px-2 pb-4">
        {loading ? (
          /* Skeleton */
          <div className="flex-col gap-1 px-2 pt-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={`skeleton-${i}`}
                className="flex items-center gap-3 py-2"
              >
                <Skeleton className="bg-subtle h-9 w-9 shrink-0 rounded-lg" />
                <Skeleton className="bg-subtle h-3 flex-1 rounded" />
              </div>
            ))}
          </div>
        ) : showItems ? (
          items.length === 0 ? (
            /* 空状态：大图标 + 提示文案 + 操作引导 */
            <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
              {/* 文件夹图标 */}
              <div className="border-border-strong bg-subtle mb-5 flex h-20 w-20 items-center justify-center rounded-2xl border">
                <Folder
                  size={40}
                  strokeWidth={1.2}
                  className="text-ink-fainter"
                />
              </div>
              <p className="text-ink-soft text-[14px] font-medium">
                {searching ? "没有匹配的素材" : "暂无内容"}
              </p>
              {!searching && (
                <div className="text-ink-fainter mt-4 flex-col gap-2 text-[12px]">
                  <Button
                    variant="ghost"
                    onClick={uploadPicker.open}
                    className="hover:text-primary-strong flex h-auto items-center gap-2 font-normal hover:bg-transparent"
                  >
                    <Plus size={14} />
                    点击 + 或右键菜单创建内容
                  </Button>
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
                  {...mediaDragSourceProps({
                    url: item.url,
                    displayName: item.name,
                    kind: item.kind,
                    className:
                      "group border-border-strong bg-subtle relative overflow-hidden rounded-lg border",
                  })}
                >
                  <div className="bg-canvas-deep flex aspect-square items-center justify-center overflow-hidden">
                    {item.kind === "image" || item.kind === "video" ? (
                      <MediaThumb
                        src={item.url}
                        alt={item.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div
                        className={`flex h-12 w-12 items-center justify-center rounded-lg ${KIND_STYLE[item.kind]}`}
                      >
                        <KindIcon kind={item.kind} />
                      </div>
                    )}
                  </div>
                  <p className="text-ink-soft truncate px-2 py-1.5 text-[11px]">
                    {item.name}
                  </p>
                  {/* hover 操作 */}
                  <div className="absolute top-1 right-1 hidden gap-1 group-hover:flex">
                    {onUse && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onUse(item)}
                        className="text-ink-soft rounded bg-black/60 backdrop-blur hover:bg-black/60 hover:text-white"
                        title="加入画布"
                      >
                        <Plus size={12} strokeWidth={2.5} />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => void remove(item)}
                      className="text-ink-soft hover:text-destructive rounded bg-black/60 backdrop-blur hover:bg-black/60"
                      title="删除"
                    >
                      <Trash2 size={12} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* 列表视图 */
            <div className="flex flex-col gap-0.5">
              {items.map((item) => (
                <div
                  key={item.id}
                  {...mediaDragSourceProps({
                    url: item.url,
                    displayName: item.name,
                    kind: item.kind,
                    className:
                      "hover:bg-subtle group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors",
                  })}
                >
                  {item.kind === "image" || item.kind === "video" ? (
                    <div className="bg-canvas-deep h-9 w-9 shrink-0 overflow-hidden rounded-lg">
                      <MediaThumb
                        src={item.url}
                        alt={item.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ) : (
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${KIND_STYLE[item.kind]}`}
                    >
                      <KindIcon kind={item.kind} />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-ink-bright truncate text-[13px]">
                      {item.name}
                    </p>
                    <p className="text-ink-fainter mt-0.5 text-[11px]">
                      {searching ? `${item.folderName} ·` : ""}
                      {displayValue(fmtBytes(item.size))}
                    </p>
                  </div>
                  <div className="hidden shrink-0 items-center gap-1 pr-1 group-hover:flex">
                    {onUse && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => onUse(item)}
                        className="text-ink-muted hover:bg-subtle hover:text-ink-bright rounded-md"
                        title="加入画布"
                      >
                        <Plus size={13} strokeWidth={2.5} />
                      </Button>
                    )}
                    <a
                      href={item.url}
                      download={item.name}
                      draggable={false}
                      className="text-ink-muted hover:bg-subtle hover:text-ink-bright flex h-7 w-7 items-center justify-center rounded-md transition-colors"
                      title="下载"
                    >
                      <Download size={13} />
                    </a>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => void remove(item)}
                      className="text-ink-muted hover:bg-subtle hover:text-destructive rounded-md"
                      title="删除"
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : /* 分类列表 — 响应 display 网格/列表切换 */
        display === "grid" ? (
          <div className="grid grid-cols-3 gap-2 px-1 pt-1">
            {folders.map((folder) => (
              <Button
                key={folder.id}
                variant="ghost"
                onClick={() => enterFolder(folder.id)}
                className="border-border-strong bg-subtle hover:bg-surface-2 hover:border-ink-fainter group flex h-auto flex-col items-center gap-2 rounded-lg border py-4 font-normal transition-colors"
              >
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-xl ${FOLDER_ICON_TINT}`}
                >
                  <Folder size={22} strokeWidth={1.8} />
                </div>
                <span className="text-ink-soft min-w-0 truncate text-center text-[12px]">
                  {folder.name}
                </span>
                {folder.count > 0 && (
                  <span className="text-ink-fainter text-[10px] tabular-nums">
                    {folder.count}
                  </span>
                )}
              </Button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {folders.map((folder) => (
              <Button
                key={folder.id}
                variant="ghost"
                onClick={() => enterFolder(folder.id)}
                className="hover:bg-subtle group flex h-auto w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left font-normal transition-colors"
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${FOLDER_ICON_TINT}`}
                >
                  <Folder size={18} strokeWidth={1.8} />
                </div>
                <span className="text-ink-bright min-w-0 flex-1 truncate text-[13px]">
                  {folder.name}
                </span>
                <span className="text-ink-fainter shrink-0 text-[11px] tabular-nums">
                  {folder.count > 0 ? folder.count : ""}
                </span>
                <ChevronRight
                  size={12}
                  strokeWidth={2.5}
                  className="text-ink-fainter group-hover:text-ink-muted shrink-0"
                />
              </Button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
