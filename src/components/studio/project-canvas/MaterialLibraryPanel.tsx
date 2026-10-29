"use client";

import { ChevronLeft, CircleHelp, Plus, Search, X } from "lucide-react";
import { Hint } from "~/components/ui/hint";
import { textHandler } from "~/lib/form-props";
import { ARTIFACT_ROOT_DIR } from "~/lib/media/output-layout";
import { useFilePicker } from "~/components/ui/file-picker";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { useState } from "react";

import { MaterialLibraryContent } from "./MaterialLibraryContent";
import { BreadcrumbPath } from "~/components/ui/breadcrumb-path";
import { DisplayDensityToggle } from "~/components/ui/display-density-toggle";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";

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
    <aside className="bg-panel border-border-strong flex h-full w-90 shrink-0 flex-col overflow-hidden border-l">
      {/* ── Header ── */}
      <div className="border-border-strong flex items-center gap-2 border-b px-4 py-3">
        <h2 className="text-ink-bright flex-1 text-[15px] font-semibold">
          素材库
        </h2>
        <Hint
          label={`素材保存在 ${ARTIFACT_ROOT_DIR}/materials 下，可直接把文件丢进对应分类目录`}
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
        {/* 显示密度切换 —— 三处逐字相同的孪生对已收口到基元（ISSUE #1925）。 */}
        <DisplayDensityToggle value={display} onChange={setDisplay} />
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

      {/* ── Tabs（下划线页签）──
          此前是手搓的 `<Button variant="ghost">` + 下划线三元：选中档给
          `border-b-2 border-accent`，**未选中档根本没写那条边框** —— 未选中的
          那一枚整体比选中的矮 2px，切来切去文字基线上下跳。这就是「一排里选
          一个」的又一处手搓，与 `project-canvas/HistoryPanel` 的作用域切换
          **逐字同形**（规范 16 §16.2.4.75）。
          改用 `ui/tabs` 的 `line` 档：选中态由 `data-active` 驱动（字色 +
          下划线两层），两枚同高同基线。 */}
      <Tabs
        value={scope}
        onValueChange={(value) =>
          setScope(/* SAFETY: 类型断言已复核 */ value as MaterialScope)
        }
        className="gap-0"
      >
        <TabsList
          variant="line"
          className="border-border-strong h-auto w-full justify-start gap-4 rounded-none border-b px-4 pt-2"
        >
          {[
            {
              id: /* SAFETY: 类型断言已复核 */ "project" as MaterialScope,
              label: "本项目",
            },
            {
              id: /* SAFETY: 类型断言已复核 */ "cross" as MaterialScope,
              label: "跨项目",
            },
          ].map((scopeItem) => (
            <TabsTrigger
              key={scopeItem.id}
              value={scopeItem.id}
              className="h-auto flex-none rounded-none px-0 pb-2.5 text-sm font-medium"
            >
              {scopeItem.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* ── Search + upload ── */}
      <div className="flex items-center gap-2 px-4 py-3">
        <div className="border-border-strong bg-subtle flex flex-1 items-center gap-2 rounded-lg border px-3 py-2">
          <Search size={14} className="text-ink-muted shrink-0" />
          <Input
            type="text"
            value={search}
            onChange={textHandler(setSearch)}
            placeholder={folder ? "在当前分类搜索" : "搜索全部素材"}
            className="text-ink-bright placeholder:text-ink-fainter h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-xs focus-visible:ring-0"
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

      {/* ── Breadcrumb（多级路径，每段独立可点击）──
          走 `~/components/ui/breadcrumb-path`（规范 16 §16.2.4.72）：
          这段渲染与资源库页此前各写一份、class 串逐字相同。 */}
      <div className="flex items-center px-4 pb-2">
        <BreadcrumbPath
          segments={breadcrumbSegments}
          navigable={!searching}
          onNavigate={enterFolder}
        />
        {/* 返回按钮：仅在进入某分类且非搜索时显示 */}
        {showItems && !searching && folder && (
          <Button
            variant="ghost"
            onClick={() => enterFolder(null)}
            className="text-ink-muted hover:bg-subtle hover:text-ink-soft text-2xs ml-auto h-auto shrink-0 gap-1 rounded-md px-2 py-1 font-normal"
          >
            <ChevronLeft data-icon="inline-start" size={11} strokeWidth={2.5} />
            返回
          </Button>
        )}
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="border-destructive/30 bg-destructive/10 mx-4 mb-2 flex items-start gap-2 rounded-lg border px-3 py-2">
          <span className="text-destructive text-2xs min-w-0 flex-1 wrap-break-word">
            {error}
          </span>
          <Button
            variant="ghost"
            onClick={refresh}
            className="text-destructive text-2xs h-auto shrink-0 p-0 underline hover:bg-transparent"
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
