"use client";

import {
  ChevronLeft,
  CircleHelp,
  LayoutGrid,
  List,
  Plus,
  Search,
  X,
} from "lucide-react";
import { Hint } from "~/components/ui/hint";
import { textHandler } from "~/lib/form-props";
import { useFilePicker } from "~/components/ui/file-picker";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { useState } from "react";

import { MaterialLibraryContent } from "./MaterialLibraryContent";

import {
  useMaterialLibrary,
  type MaterialScope,
} from "./hooks/use-material-library";
import type { MaterialItem } from "~/lib/media/materials-client";

/* 对外类型再导出：历史消费方从本文件 import MaterialItem，保持 API 不变。 */
export type { MaterialItem };

/* ── Types ───────────────────────────────────────────────── */

type DisplayMode = "grid" | "list";

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
    uploading,
    error,
    searching,
    showItems,
    breadcrumbSegments,
    setScope,
    setSearch,
    enterFolder,
    upload,
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
        <Hint
          label="素材保存在 public/generated/materials 下，可直接把文件丢进对应分类目录"
          accessibleName
        >
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-ink-muted hover:bg-subtle hover:text-ink-soft rounded-md"
          >
            <CircleHelp data-icon="inline-start" size={14} />
          </Button>
        </Hint>
        {/* 显示密度切换 */}
        <div className="bg-subtle flex items-center gap-0.5 rounded-lg p-0.5">
          <Hint label="网格视图" accessibleName>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setDisplay("grid")}
              className={`h-auto rounded-md p-1 ${display === "grid" ? "bg-surface-2 text-ink-bright" : "text-ink-muted hover:text-ink-soft"}`}
            >
              <LayoutGrid data-icon="inline-start" size={14} />
            </Button>
          </Hint>
          <Hint label="列表视图" accessibleName>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setDisplay("list")}
              className={`h-auto rounded-md p-1 ${display === "list" ? "bg-surface-2 text-ink-bright" : "text-ink-muted hover:text-ink-soft"}`}
            >
              <List data-icon="inline-start" size={14} />
            </Button>
          </Hint>
        </div>
        <Hint label="关闭" accessibleName>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            className="text-ink-muted hover:bg-subtle hover:text-ink-soft rounded-md"
          >
            <X data-icon="inline-start" size={14} />
          </Button>
        </Hint>
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
            <Hint label="清空" accessibleName>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setSearch("")}
                className="text-ink-fainter hover:text-ink-soft h-auto shrink-0 p-0 hover:bg-transparent"
              >
                <X data-icon="inline-start" size={12} strokeWidth={2.5} />
              </Button>
            </Hint>
          )}
        </div>
        <uploadPicker.Input />
        <Hint
          label={
            folder
              ? `上传到「${folders.find((fld) => fld.id === folder)?.name ?? folder}」`
              : "上传到「参考素材」"
          }
          wrap
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={uploadPicker.open}
            disabled={uploading}
            className="text-ink-soft hover:bg-subtle hover:text-ink-bright rounded-lg"
          >
            {uploading ? (
              <Spinner className="size-4" />
            ) : (
              <Plus data-icon="inline-start" size={16} strokeWidth={1.8} />
            )}
          </Button>
        </Hint>
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
            <ChevronLeft data-icon="inline-start" size={11} strokeWidth={2.5} />
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

      <MaterialLibraryContent
        c={c}
        display={display}
        onUse={onUse}
        onOpenUploadPicker={() => uploadPicker.open}
      />
    </aside>
  );
}
