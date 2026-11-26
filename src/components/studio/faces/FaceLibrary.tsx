"use client";

/**
 * `FaceLibrary` — 角色脸库页（ISSUE #5087）。
 *
 * 左栏：可搜索的动漫脸部形象预设（内置数据 + 标签筛选）；右栏：选中那张脸的
 * 完整提示词（一键复制）与支持 T2I 的模型，直接生成脸图。取数 / 复制 / 生成
 * 都在 `hooks/use-face-library`，本文件只做组合（规范 17 §17.2 第④层）。
 */
import { Copy, Search, Sparkles } from "lucide-react";

import { DocumentFrame } from "~/components/studio/ViewContainer";
import { pageHeaderTitle } from "~/components/studio/NavItems";
import { ModelCascadeSelect } from "~/components/workshop/ModelCascadeSelect";
import { AuroraBackground } from "~/components/ui/aurora-background";
import { Button } from "~/components/ui/button";
import { FormField } from "~/components/ui/form-field";
import { ViewableImage } from "~/components/ui/image-viewer";
import { Input } from "~/components/ui/input";
import { EMBEDDED_SCROLL_MAX_HEIGHT } from "~/components/ui/overlay-max-height";
import { PageHeader } from "~/components/ui/page-header";
import { Textarea } from "~/components/ui/textarea";
import { Toggle } from "~/components/ui/toggle";
import { cn } from "~/lib/utils";

import { useFaceLibrary } from "./hooks/use-face-library";
import type { FacePreset } from "./face-presets";

function FaceRow({
  preset,
  selected,
  onSelect,
}: {
  onSelect: (id: string) => void;
  preset: FacePreset;
  selected: boolean;
}) {
  return (
    <Toggle
      aria-label={`选择脸部形象：${preset.name}`}
      className="h-auto w-full flex-col items-start gap-0.5 px-3 py-2 text-left whitespace-normal"
      onPressedChange={() => {
        onSelect(preset.id);
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

  return (
    <DocumentFrame
      backdrop={<AuroraBackground />}
      className="px-4 pt-4 pb-6 sm:px-8 sm:pt-5 sm:pb-8"
      width="full"
    >
      <PageHeader srTitle={pageHeaderTitle("face")} />

      <div className="flex flex-col gap-5 lg:flex-row">
        {/* ── 左栏：搜索 + 脸部形象列表 ── */}
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
          <div className="text-muted-foreground my-2 text-xs">
            {c.filtered.length} 种脸部形象（数据驱动，新增只加一条预设）
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
                onSelect={c.setSelectedId}
                preset={preset}
                selected={preset.id === c.selectedId}
              />
            ))}
          </div>
        </aside>

        {/* ── 右栏：提示词 + 复制 + 生图 ── */}
        <section className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="border-border bg-subtle/40 flex flex-col gap-3 rounded-xl border p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-base font-semibold">{c.selected?.name ?? "未选择"}</p>
                <p className="text-muted-foreground text-xs">{c.selected?.description ?? ""}</p>
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

            <FormField label="完整正向提示词（可直接复制到生图工具）">
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
                disabled={c.generating || c.selected === null}
                onClick={() => {
                  void c.generate();
                }}
              >
                {c.generating ? "生成中…" : "用这张脸生图"}
              </Button>
              {c.notice !== "" && <span className="text-destructive text-xs">{c.notice}</span>}
            </div>
          </div>

          {c.result.status !== "pending" && (
            <div className="border-border bg-subtle/40 rounded-xl border p-3">
              {c.result.status === "done" && c.result.url ? (
                <ViewableImage
                  alt={`${c.selected?.name ?? "脸部"} 生成结果`}
                  className="max-h-96 w-full object-contain"
                  label="脸部生成结果"
                  src={c.result.url}
                />
              ) : (
                <p className="text-destructive text-xs leading-relaxed">
                  {c.result.error ?? "生成失败"}
                </p>
              )}
            </div>
          )}

          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Sparkles aria-hidden="true" className="size-3.5" />
            脸部词库与生图链路都与风格库共用；「直接用那张图」即在此按需生成。
          </p>
        </section>
      </div>
    </DocumentFrame>
  );
}
