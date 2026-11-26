"use client";

/**
 * `FaceLibrary` — 角色脸库页（ISSUE #5087）。
 *
 * 左栏：可搜索的动漫脸部形象预设（内置数据 + 标签筛选），可多选后批量生图；
 * 右栏：勾选脸的完整提示词（一键复制）与支持 T2I 的模型，结果并排展示。
 * 取数 / 复制 / 生成都在 `hooks/use-face-library`，本文件只做组合（规范 17 §17.2 第④层）。
 */
import { useState } from "react";
import { Copy, Search, Sparkles } from "lucide-react";

import { AddToAssetLibraryDialog } from "~/components/studio/assets/AddToAssetLibraryDialog";
import {
  buildResearchLibraryTarget,
  ResearchResultCard,
  type ResearchLibraryTarget,
} from "~/components/studio/assets/ResearchResultCard";
import { DocumentFrame } from "~/components/studio/ViewContainer";
import { pageHeaderTitle } from "~/components/studio/NavItems";
import { ModelCascadeSelect } from "~/components/workshop/ModelCascadeSelect";
import { AuroraBackground } from "~/components/ui/aurora-background";
import { Button } from "~/components/ui/button";
import { FormField } from "~/components/ui/form-field";
import { Input } from "~/components/ui/input";
import { EMBEDDED_SCROLL_MAX_HEIGHT } from "~/components/ui/overlay-max-height";
import { PageHeader } from "~/components/ui/page-header";
import { Textarea } from "~/components/ui/textarea";
import { Toggle } from "~/components/ui/toggle";
import { cn } from "~/lib/utils";

import { useFaceLibrary, type FaceResult } from "./hooks/use-face-library";
import type { FacePreset } from "./face-presets";

function FaceRow({
  preset,
  selected,
  onToggle,
}: {
  onToggle: (id: string) => void;
  preset: FacePreset;
  selected: boolean;
}) {
  return (
    <Toggle
      aria-label={`选择脸部形象：${preset.name}`}
      className="h-auto w-full flex-col items-start gap-0.5 px-3 py-2 text-left whitespace-normal"
      onPressedChange={() => {
        onToggle(preset.id);
      }}
      pressed={selected}
      variant="chip"
    >
      <span className="block w-full truncate text-sm font-medium">{preset.name}</span>
      <span className="text-muted-foreground block w-full text-xs leading-snug">
        {preset.description}
      </span>
      <span className="text-muted-foreground text-2xs block w-full truncate">
        {preset.tags.join(" · ")}
      </span>
    </Toggle>
  );
}

export function FaceLibrary() {
  const c = useFaceLibrary();
  const [libraryTarget, setLibraryTarget] = useState<ResearchLibraryTarget>(null);

  const addToLibrary = (result: FaceResult) => {
    setLibraryTarget(buildResearchLibraryTarget(result, "character"));
  };

  return (
    <DocumentFrame
      backdrop={<AuroraBackground />}
      className="px-4 pt-4 pb-6 sm:px-8 sm:pt-5 sm:pb-8"
      width="full"
    >
      <PageHeader srTitle={pageHeaderTitle("face")} />

      <div className="flex flex-col gap-5 lg:flex-row">
        {/* ── 左栏：搜索 + 脸部形象多选 ── */}
        <aside className="w-full shrink-0 lg:w-72">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            />
            <Input
              aria-label="搜索脸部形象提示词"
              className="pl-8"
              onChange={(event) => {
                c.setQuery(event.target.value);
              }}
              placeholder="搜索脸型 / 瞳色 / 气质 / 题材"
              value={c.query}
            />
          </div>
          <div className="text-muted-foreground my-2 flex items-center justify-between text-xs">
            <span>
              已选 {c.selectedIds.length} / {c.filtered.length} 种脸部形象
            </span>
            <span className="flex gap-2">
              <Button
                className="h-auto p-0 text-xs"
                onClick={() => {
                  c.selectAll();
                }}
                variant="ghost"
              >
                全选
              </Button>
              <Button
                className="h-auto p-0 text-xs"
                onClick={() => {
                  c.clearAll();
                }}
                variant="ghost"
              >
                清空
              </Button>
            </span>
          </div>
          <div
            className={cn("flex flex-col gap-1 overflow-y-auto pr-1", EMBEDDED_SCROLL_MAX_HEIGHT)}
          >
            {c.filtered.length === 0 && (
              <p className="text-muted-foreground text-xs">没有匹配的脸，试试别的关键词。</p>
            )}
            {c.filtered.map((preset) => (
              <FaceRow
                key={preset.id}
                onToggle={c.toggleFace}
                preset={preset}
                selected={c.selectedIds.includes(preset.id)}
              />
            ))}
          </div>
        </aside>

        {/* ── 右栏：提示词 + 复制 + 批量生图 ── */}
        <section className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="border-border bg-subtle/40 flex flex-col gap-3 rounded-xl border p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-base font-semibold">
                  {c.selectedPresets.length === 0
                    ? "未选择"
                    : `已选 ${c.selectedPresets.length} 张脸`}
                </p>
                <p className="text-muted-foreground text-xs">
                  {c.selectedPresets.map((preset) => preset.name).join(" · ")}
                </p>
              </div>
              <Button
                disabled={c.prompt === ""}
                onClick={() => {
                  c.copy(c.prompt);
                }}
                size="sm"
                variant="outline"
              >
                <Copy className="size-4" data-icon="inline-start" />
                复制提示词
              </Button>
            </div>

            <FormField label="完整正向提示词（可直接复制到生图工具；多张脸逐行排列）">
              {() => <Textarea readOnly rows={5} value={c.prompt} />}
            </FormField>

            <FormField label="生图模型（只列支持文生图的）" />
            <ModelCascadeSelect
              kind="image"
              modes={["T2I"]}
              onSelectionChange={c.setModelSelection}
              selection={c.modelSelection}
            />

            <div className="flex items-center gap-3">
              <Button
                disabled={c.generating || c.selectedPresets.length === 0}
                onClick={() => {
                  void c.generate();
                }}
              >
                {c.generating ? "生成中…" : `批量生图（${c.selectedPresets.length}）`}
              </Button>
              {c.notice !== "" && <span className="text-destructive text-xs">{c.notice}</span>}
            </div>
          </div>

          {c.selectedPresets.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {c.selectedPresets.map((preset) => (
                <ResearchResultCard
                  id={preset.id}
                  imageLabel={`${preset.name} 脸图`}
                  key={preset.id}
                  name={preset.name}
                  onAddToLibrary={addToLibrary}
                  onCancel={(id) => {
                    void c.cancelOne(id);
                  }}
                  result={c.results[preset.id]}
                />
              ))}
            </div>
          ) : null}

          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Sparkles aria-hidden="true" className="size-3.5" />
            脸部词库与生图链路都与风格库共用；勾选多张脸即可一次入队批量生成。
          </p>
        </section>
      </div>

      <AddToAssetLibraryDialog
        candidate={
          libraryTarget !== null && "candidate" in libraryTarget ? libraryTarget.candidate : null
        }
        onClose={() => {
          setLibraryTarget(null);
        }}
        taskId={libraryTarget !== null && "taskId" in libraryTarget ? libraryTarget.taskId : null}
      />
    </DocumentFrame>
  );
}
