"use client";

// ── 资源库（项目页签）── 视图层（规范 17 §17.2 第③层）────────────────────────
// 此前「资源库」只是工坊右栏里的一张计数卡（`WorkshopAside`），末尾还写着
// 「素材在画布的素材库导入与管理，这里只做汇总展示」—— 一句自己承认它不是
// 真身的话。本页把它提成与主页 / 画布 / 工坊 / 产出 / 成片并列的项目页签：一个页面
// 看全本项目素材，分类、搜索、上传、删除、拖入画布都在这里做完。
//
// 与画布那块「素材库」抽屉的关系：
//   · 数据与动作同源 —— 都用 `useMaterialLibrary` / `materials-client`，
//     没有第二套网络层（§12.18 复用优先）；
//   · 结果区**同一个组件**（`MaterialLibraryContent`），只是网格列数由本页按
//     宽度传下去（抽屉是 2 / 3 列，这里是 2 / 3 / 5 列）。分类 / 条目 / 空态 /
//     骨架四种形态因此只有一份实现，改一处两边同时生效。
//
// 「加入画布」按钮**有意不挂**：那一动作的语义是「往当前打开的画布上放一个节点」，
// 而本页是独立页签、画布并未挂载 —— 挂一个只能先把用户送去画布再放节点的按钮
// 属于替用户做决定。条目仍带拖拽源（`mediaDragSourceProps`），需要时拖过去即可。

import { useState } from "react";
import { FolderOpen, LayoutGrid, List, Plus, Search, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { EmptyState } from "~/components/ui/empty-state";
import { Hint } from "~/components/ui/hint";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { useFilePicker } from "~/components/ui/file-picker";
import { MaterialLibraryContent } from "~/components/studio/project-canvas/MaterialLibraryContent";
import type { MaterialScope } from "~/components/studio/project-canvas/hooks/use-material-library";
import { textHandler } from "~/lib/form-props";

import { useResourceLibrary } from "./hooks/use-resource-library";

/** 两个作用域档 —— 顺序与画布抽屉一致（本项目在前）。 */
const SCOPES: Array<{ id: MaterialScope; label: string; hint: string }> = [
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
    onPick: (_first, files) => void library.upload(files),
  });

  /* 前置未满足：本项目档下没有活跃项目时，「本项目」这个档取不到任何东西，
   * 但上传也会一起被禁 —— 与其给一个必然失败的上传按钮，不如说清怎么开始。
   * 「跨项目」档不受此限（它本来就是全部项目 + 共享的合集）。 */
  const needsProject = library.scope === "project" && c.projectId === null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-8 sm:py-10">
        {/* ── 页头：标题 + 说明 + 动作 ── */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-title u-title-page">资源库</h1>
            <p className="text-ink-muted mt-1 text-sm">
              本项目的全部素材 —— 参考图、音效、成片片段等，按分类统一管理，
              可直接拖入画布或工坊使用。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <uploadPicker.Input />
            <Hint label="上传素材" wrap>
              <Button
                variant="primary"
                onClick={uploadPicker.open}
                disabled={library.uploading || needsProject}
                className="h-auto gap-1.5 rounded-lg px-4 py-2"
              >
                {library.uploading ? (
                  <Spinner className="size-4" />
                ) : (
                  <Plus data-icon="inline-start" size={16} strokeWidth={1.8} />
                )}
                上传素材
              </Button>
            </Hint>
          </div>
        </div>

        {/* ── 作用域档 + 搜索 ── */}
        <div className="border-border mb-5 flex flex-wrap items-center gap-3 border-b pb-3">
          {/* 作用域档走 `ToggleGroup`（P77）：2–7 项的「哪一项选中」由基元自己
              打 `aria-pressed` / `data-state`，视图不再手写一份 toggle 契约。
              每档的说明走 `<Hint>`（P82：原生 `title=` 读屏器支持不一致、
              样式也脱离主题 token）。 */}
          <ToggleGroup
            multiple={false}
            value={[library.scope]}
            onValueChange={(values) => {
              const next = values[0];
              if (next === "project" || next === "cross") c.setScope(next);
            }}
            aria-label="素材作用域"
            className="gap-0"
          >
            {SCOPES.map((scope) => (
              <Hint key={scope.id} label={scope.hint} wrap>
                <ToggleGroupItem
                  value={scope.id}
                  className="text-ink-muted hover:text-ink-soft data-[pressed]:text-ink-bright after:bg-primary relative h-auto gap-1.5 rounded-none px-0 pb-2.5 text-[13px] font-medium after:absolute after:inset-x-0 after:-bottom-[13px] after:h-0.5 after:opacity-0 after:transition-opacity after:content-[''] data-[pressed]:bg-transparent data-[pressed]:after:opacity-100"
                >
                  {scope.label}
                  {library.scope === scope.id && c.totalCount > 0 ? (
                    <span className="text-ink-fainter text-[11px] tabular-nums">
                      {c.totalCount}
                    </span>
                  ) : null}
                </ToggleGroupItem>
              </Hint>
            ))}
          </ToggleGroup>

          {/* 显示密度：纯视觉偏好，与业务数据无关（与画布抽屉同一取舍）。 */}
          <div className="bg-subtle ml-auto flex items-center gap-0.5 rounded-lg p-0.5">
            <Hint label="网格视图" accessibleName>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setDisplay("grid")}
                className={`h-auto rounded-md p-1 ${
                  display === "grid"
                    ? "bg-surface-2 text-ink-bright"
                    : "text-ink-muted hover:text-ink-soft"
                }`}
              >
                <LayoutGrid data-icon="inline-start" size={14} />
              </Button>
            </Hint>
            <Hint label="列表视图" accessibleName>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setDisplay("list")}
                className={`h-auto rounded-md p-1 ${
                  display === "list"
                    ? "bg-surface-2 text-ink-bright"
                    : "text-ink-muted hover:text-ink-soft"
                }`}
              >
                <List data-icon="inline-start" size={14} />
              </Button>
            </Hint>
          </div>

          <div className="border-border bg-subtle flex w-full items-center gap-2 rounded-lg border px-3 py-2 sm:w-72">
            <Search size={14} className="text-ink-muted shrink-0" />
            <Input
              type="text"
              value={library.search}
              onChange={textHandler(library.setSearch)}
              placeholder={library.folder ? "在当前分类搜索" : "搜索全部素材"}
              className="text-ink-bright placeholder:text-ink-fainter h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-[12px] focus-visible:ring-0"
            />
            {library.search ? (
              <Hint label="清空" accessibleName>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => library.setSearch("")}
                  className="text-ink-fainter hover:text-ink-soft h-auto shrink-0 p-0 hover:bg-transparent"
                >
                  <X data-icon="inline-start" size={12} strokeWidth={2.5} />
                </Button>
              </Hint>
            ) : null}
          </div>
        </div>

        {/* ── 面包屑：搜索态与分类内都可回落 ── */}
        {!needsProject && (
          <div className="mb-3 flex items-center gap-1.5">
            {library.breadcrumbSegments.map((seg, i) => {
              const isLast = i === library.breadcrumbSegments.length - 1;
              const isCurrent = isLast && !library.searching;
              return (
                <span
                  key={seg.key ?? `seg-${String(i)}`}
                  className="inline-flex items-center"
                >
                  {i > 0 && (
                    <span className="text-ink-fainter mx-1 text-[11px]">/</span>
                  )}
                  {isLast || library.searching ? (
                    <span
                      className={`text-[12px] ${
                        isCurrent
                          ? "text-ink-bright font-medium"
                          : "text-ink-soft"
                      }`}
                    >
                      {seg.label}
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={() => library.enterFolder(seg.key)}
                      className="text-ink-muted hover:text-primary-strong h-auto p-0 text-[12px] font-normal hover:bg-transparent hover:underline"
                    >
                      {seg.label}
                    </Button>
                  )}
                </span>
              );
            })}
          </div>
        )}

        {/* ── 错误条：拉取与动作失败共用一条（控制器已保证动作错误优先）── */}
        {library.error && (
          <div className="border-destructive/30 bg-destructive/10 mb-4 flex items-start gap-2 rounded-lg border px-3 py-2">
            <span className="text-destructive min-w-0 flex-1 text-[12px] wrap-break-word">
              {library.error}
            </span>
            <Button
              variant="ghost"
              onClick={library.refresh}
              className="text-destructive h-auto shrink-0 p-0 text-[12px] underline hover:bg-transparent"
            >
              重试
            </Button>
          </div>
        )}

        {/* ── 结果区 ── */}
        {needsProject ? (
          <EmptyState
            icon={FolderOpen}
            title="还没有打开的项目"
            description="素材按项目归档。先在画布 / 工坊里打开一个项目，这里就会列出它的素材；切换上方「跨项目」也可以先浏览全部项目的素材。"
            minHeightClass="min-h-[300px]"
            action={
              <Button
                variant="outline"
                onClick={() => c.setScope("cross")}
                className="border-border bg-subtle text-ink-bright hover:border-primary/40 hover:text-primary mt-4 h-auto rounded-lg px-4 py-2"
              >
                看跨项目素材
              </Button>
            }
          />
        ) : (
          <MaterialLibraryContent
            c={library}
            display={display}
            onOpenUploadPicker={uploadPicker.open}
            gridColsClass="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
            folderColsClass="grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
          />
        )}
      </div>
    </div>
  );
}
