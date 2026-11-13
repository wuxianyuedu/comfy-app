"use client";

// ── 资源库（项目页签）视图层（规范 17 §17.2 第③层）──
// 从工坊右栏的计数卡提为与主页/画布/工坊/产出/成片并列的项目页签：一个页面看全本项目素材，
// 分类、搜索、上传、删除、拖入画布都在这里。
// 与画布「素材库」抽屉同源：共用 useMaterialLibrary / materials-client，结果区同一个 MaterialLibraryContent
//（抽屉 2/3 列，本页 2/3/5 列），四种形态只有一份实现。「加入画布」有意不挂：本页画布未挂载，条目仍可拖拽。

import { useState } from "react";
import { FolderOpen, Plus, Search, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { EmptyState } from "~/components/ui/empty-state";
import { DocumentFrame } from "~/components/studio/ViewContainer";
import { BreadcrumbPath } from "~/components/ui/breadcrumb-path";
import { DisplayDensityToggle } from "~/components/ui/display-density-toggle";
import { Hint } from "~/components/ui/hint";
import { Input } from "~/components/ui/input";
import { PageHeader } from "~/components/ui/page-header";
import { ViewActions } from "~/components/studio/ViewActions";
import { Spinner } from "~/components/ui/spinner";
import { FilePicker, useFilePicker } from "~/components/ui/file-picker";
import { MaterialLibraryContent } from "~/components/studio/project-canvas/MaterialLibraryContent";
import type { MaterialScope } from "~/components/studio/project-canvas/hooks/use-material-library";
import { textHandler } from "~/lib/form-props";

import { pageHeaderTitle } from "../NavItems";

import { useResourceLibrary } from "./hooks/use-resource-library";

/** 两个作用域档 —— 顺序与画布抽屉一致（本项目在前）。 */
const SCOPES: Array<{ hint: string; id: MaterialScope; label: string }> = [
  { id: "project", label: "本项目", hint: "当前项目的素材 + 共享素材" },
  { id: "cross", label: "跨项目", hint: "所有项目的素材聚合" },
];

export function ResourceLibrary() {
  const c = useResourceLibrary();
  const { library } = c;
  /* 显示密度是纯视觉偏好，与业务数据无关，留在视图层（与画布抽屉同一取舍）。 */
  const [display, setDisplay] = useState<"grid" | "list">("grid");
  /* 素材上传选择器：多选、不限定类型（素材库也收音频 / 视频 / 文档）。 */
  const uploadPicker = useFilePicker({
    multiple: true,
    onPick: (_first, files) => {
      void library.upload(files);
    },
  });

  /* 前置未满足：本项目档下没有活跃项目时，「本项目」这个档取不到任何东西，
   * 但上传也会一起被禁 —— 与其给一个必然失败的上传按钮，不如说清怎么开始。
   * 「跨项目」档不受此限（它本来就是全部项目 + 共享的合集）。 */
  const needsProject = library.scope === "project" && c.projectId === null;

  return (
    <DocumentFrame className="px-4 pt-4 pb-6 sm:px-8 sm:pt-5 sm:pb-8" width="wide">
      {/* ── 页头：动作（屏名由页签给出，说明问号在顶栏标题右侧） ── */}
      <PageHeader srTitle={pageHeaderTitle("library")} />

      {/* 上传挂到顶栏（`ViewActions`）—— 见 `ViewActions` 里那段「屏名由页签
          给出之后，留在屏内那一行只剩右对齐的几颗控件」（ISSUE #1871）。 */}
      <ViewActions>
        <FilePicker {...uploadPicker.inputProps} />
        <Hint label="上传素材" wrap>
          <Button
            className="h-auto gap-1.5 rounded-lg px-4 py-2"
            disabled={library.uploading || needsProject}
            onClick={uploadPicker.open}
            variant="primary"
          >
            {library.uploading ? (
              <Spinner className="size-4" />
            ) : (
              <Plus data-icon="inline-start" size={16} strokeWidth={1.8} />
            )}
            上传素材
          </Button>
        </Hint>
      </ViewActions>

      {/* ── 作用域档 + 搜索 ── */}
      <div className="border-border mb-5 flex flex-wrap items-center gap-3 border-b pb-3">
        {/* 作用域档走 ui/tabs 的 line 档（规范 16 §16.2.4.75），与 MaterialLibraryPanel / HistoryPanel 逐字同形。
            此前手搓 ToggleGroup + after: 下划线：未选中档不画线、靠 after:bottom-[-13px] 硬凑，
            两枚不同高、切换基线上下跳，且 aria-pressed 语义错半格（这排只能选一个）。
            现由 data-active 一处驱动字色 + 下划线两层，两枚同高同基线。 */}
        <Tabs
          className="gap-0"
          onValueChange={(value: unknown) => {
            /* 基元的 `onValueChange` 出参是 `any`：收窄放在这里，
               别拿 `as MaterialScope` 把判据抹掉（§16.2.4.68 的同一取向）。 */
            if (value === "project" || value === "cross") {
              c.setScope(value);
            }
          }}
          value={library.scope}
        >
          <TabsList aria-label="素材作用域" className="gap-3" variant="line">
            {SCOPES.map((scope) => (
              <Hint key={scope.id} label={scope.hint} wrap>
                <TabsTrigger
                  className="h-auto flex-none rounded-none px-0 pb-2.5 text-sm font-medium"
                  value={scope.id}
                >
                  {scope.label}
                  {library.scope === scope.id && c.totalCount > 0 ? (
                    <span className="text-ink-fainter text-2xs tabular-nums">{c.totalCount}</span>
                  ) : null}
                </TabsTrigger>
              </Hint>
            ))}
          </TabsList>
        </Tabs>

        {/* 显示密度：纯视觉偏好，与业务数据无关（与画布抽屉同一取舍）。
            三处逐字相同的孪生对已收口到基元（ISSUE #1925）。 */}
        <DisplayDensityToggle className="ml-auto" onChange={setDisplay} value={display} />

        <div className="border-border bg-subtle flex w-full items-center gap-2 rounded-lg border px-3 py-2 sm:w-72">
          <Search className="text-ink-muted shrink-0" size={14} />
          <Input
            className="text-ink-bright placeholder:text-ink-fainter h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-xs focus-visible:ring-0"
            onChange={textHandler(library.setSearch)}
            placeholder={
              library.folder !== null && library.folder !== "" ? "在当前分类搜索" : "搜索全部素材"
            }
            type="text"
            value={library.search}
          />
          {library.search ? (
            <Hint accessibleName label="清空">
              <Button
                className="text-ink-fainter hover:text-ink-soft h-auto shrink-0 p-0 hover:bg-transparent"
                onClick={() => {
                  library.setSearch("");
                }}
                size="icon-xs"
                variant="ghost"
              >
                <X data-icon="inline-start" size={12} strokeWidth={2.5} />
              </Button>
            </Hint>
          ) : null}
        </div>
      </div>

      {/* ── 面包屑：搜索态与分类内都可回落 ──
          走 `~/components/ui/breadcrumb-path`（规范 16 §16.2.4.72）。 */}
      {!needsProject && (
        <BreadcrumbPath
          className="mb-3"
          navigable={!library.searching}
          onNavigate={library.enterFolder}
          segments={library.breadcrumbSegments}
        />
      )}

      {/* ── 错误条：拉取与动作失败共用一条（控制器已保证动作错误优先）── */}
      {library.error !== null && library.error !== "" && (
        <div className="border-destructive/30 bg-destructive/10 mb-4 flex items-start gap-2 rounded-lg border px-3 py-2">
          <span className="text-destructive min-w-0 flex-1 text-xs wrap-break-word">
            {library.error}
          </span>
          <Button
            className="text-destructive h-auto shrink-0 p-0 text-xs underline hover:bg-transparent"
            onClick={library.refresh}
            variant="ghost"
          >
            重试
          </Button>
        </div>
      )}

      {/* ── 结果区 ── */}
      {needsProject ? (
        <EmptyState
          action={
            <Button
              className="border-border bg-subtle text-ink-bright hover:border-primary/40 hover:text-primary mt-4 h-auto rounded-lg px-4 py-2"
              onClick={() => {
                c.setScope("cross");
              }}
              variant="outline"
            >
              看跨项目素材
            </Button>
          }
          description="素材按项目归档。先在画布 / 工坊里打开一个项目，这里就会列出它的素材；切换上方「跨项目」也可以先浏览全部项目的素材。"
          icon={FolderOpen}
          minHeightClass="min-h-75"
          title="还没有打开的项目"
        />
      ) : (
        <MaterialLibraryContent
          c={library}
          display={display}
          folderColsClass="grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
          gridColsClass="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
          onOpenUploadPicker={uploadPicker.open}
        />
      )}
    </DocumentFrame>
  );
}
