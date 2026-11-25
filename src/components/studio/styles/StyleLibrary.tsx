"use client";

/**
 * `StyleLibrary` — 风格库页（ISSUE #5069）。
 *
 * 左栏：可搜索的画风列表（复用 Skill 系统的 12 条内置画风种子 + 用户自建），
 * 勾选多个画风做对比；右栏：同一份基础提示词（用户输入 + 动漫角色 + 场景）
 * 套用每个画风分别生图，结果并排展示。画风的新建走 `skill.create`，新增只加
 * 一条数据、不改代码。取数与生成编排都在 `hooks/use-style-library`，本文件
 * 只做组合与弹层（规范 17 §17.2 第④层）。
 */
import { Plus, Search, Sparkles } from "lucide-react";

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
import { SelectMenu } from "~/components/ui/select-menu";
import { Textarea } from "~/components/ui/textarea";
import { Toggle } from "~/components/ui/toggle";
import { cn } from "~/lib/utils";

import {
  useStyleLibrary,
  type NewStyleDraft,
  type StyleItem,
  type StyleResult,
} from "./hooks/use-style-library";
import { ANIME_CHARACTER_PRESETS, SCENE_PRESETS } from "./style-presets";

function StyleRow({
  selected,
  style,
  onToggle,
}: {
  onToggle: (slug: string) => void;
  selected: boolean;
  style: StyleItem;
}) {
  return (
    <Toggle
      aria-label={`选择画风：${style.name}`}
      className="h-auto w-full flex-col items-start gap-0.5 px-3 py-2 text-left whitespace-normal"
      onPressedChange={() => {
        onToggle(style.slug);
      }}
      pressed={selected}
      variant="chip"
    >
      <span className="block w-full truncate text-sm font-medium">{style.name}</span>
      <span className="text-muted-foreground block w-full text-xs leading-snug">
        {style.description}
      </span>
      {style.tags.length > 0 && (
        <span className="text-muted-foreground text-2xs block w-full truncate">
          {style.tags.join(" · ")}
        </span>
      )}
    </Toggle>
  );
}

function ResultCard({ name, result }: { name: string; result?: StyleResult }) {
  return (
    <div className="border-border bg-subtle/40 flex min-w-0 flex-col gap-2 rounded-xl border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{name}</span>
        {result?.status === "pending" && (
          <span className="text-muted-foreground text-xs">生成中…</span>
        )}
        {result?.status === "done" && <span className="text-success-strong text-xs">已完成</span>}
        {result?.status === "failed" && <span className="text-destructive text-xs">失败</span>}
      </div>
      {result?.status === "done" && result.url ? (
        <ViewableImage
          alt={`${name} 画风生成结果`}
          className="max-h-96 w-full object-contain"
          label={`${name} 画风`}
          src={result.url}
        />
      ) : result?.status === "failed" ? (
        <p className="text-muted-foreground text-xs leading-relaxed">
          {result.error ?? "生成失败"}
        </p>
      ) : (
        <div className="bg-muted/60 flex h-48 items-center justify-center rounded-lg">
          <Sparkles aria-hidden="true" className="text-muted-foreground size-6" />
        </div>
      )}
    </div>
  );
}

function NewStyleForm({
  createError,
  creating,
  draft,
  onCancel,
  onChange,
  onSubmit,
}: {
  createError: string;
  creating: boolean;
  draft: NewStyleDraft;
  onCancel: () => void;
  onChange: (patch: Partial<NewStyleDraft>) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="border-border bg-subtle/40 mt-3 flex flex-col gap-2 rounded-xl border p-3">
      <p className="text-sm font-medium">新建画风（写进画风库，所有页面共享）</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <FormField label="画风名字">
          {(a11y) => (
            <Input
              {...a11y}
              onChange={(event) => {
                onChange({ name: event.target.value });
              }}
              placeholder="如：水彩童书风"
              value={draft.name}
            />
          )}
        </FormField>
        <FormField label="画风标识">
          {(a11y) => (
            <Input
              {...a11y}
              onChange={(event) => {
                onChange({ slug: event.target.value });
              }}
              placeholder="watercolor-storybook"
              value={draft.slug}
            />
          )}
        </FormField>
      </div>
      <FormField label="画风说明">
        {(a11y) => (
          <Input
            {...a11y}
            onChange={(event) => {
              onChange({ description: event.target.value });
            }}
            placeholder="一句话说明这种画风"
            value={draft.description}
          />
        )}
      </FormField>
      <FormField label="画风提示词描述">
        {(a11y) => (
          <Textarea
            {...a11y}
            onChange={(event) => {
              onChange({ promptTemplate: event.target.value });
            }}
            placeholder="英文画风词，可用 {subject} 指代主体"
            rows={3}
            value={draft.promptTemplate}
          />
        )}
      </FormField>
      <FormField label="画风负向词">
        {(a11y) => (
          <Input
            {...a11y}
            onChange={(event) => {
              onChange({ negativePrompt: event.target.value });
            }}
            placeholder="选填：这种画风要排除的词"
            value={draft.negativePrompt}
          />
        )}
      </FormField>
      <FormField label="画风标签">
        {(a11y) => (
          <Input
            {...a11y}
            onChange={(event) => {
              onChange({ tags: event.target.value });
            }}
            placeholder="选填：逗号分隔，便于搜索"
            value={draft.tags}
          />
        )}
      </FormField>
      {createError !== "" && <p className="text-destructive text-xs">{createError}</p>}
      <div className="flex gap-2">
        <Button
          disabled={creating}
          onClick={() => {
            onSubmit();
          }}
          size="sm"
        >
          保存画风
        </Button>
        <Button
          onClick={() => {
            onCancel();
          }}
          size="sm"
          variant="outline"
        >
          取消
        </Button>
      </div>
    </div>
  );
}

export function StyleLibrary() {
  const c = useStyleLibrary();
  const chosen = c.styles.filter((style) => c.selectedSlugs.includes(style.slug));

  return (
    <DocumentFrame
      backdrop={<AuroraBackground />}
      className="px-4 pt-4 pb-6 sm:px-8 sm:pt-5 sm:pb-8"
      width="full"
    >
      <PageHeader srTitle={pageHeaderTitle("style")} />

      <div className="flex flex-col gap-5 lg:flex-row">
        {/* ── 左栏：画风搜索 + 多选 ── */}
        <aside className="w-full shrink-0 lg:w-72">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search
                aria-hidden="true"
                className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              />
              <Input
                aria-label="搜索画风提示词"
                className="pl-8"
                onChange={(event) => {
                  c.setSearch(event.target.value);
                }}
                placeholder="搜索画风 / 提示词 / 标签"
                value={c.search}
              />
            </div>
            <Button
              aria-label="新建画风"
              onClick={() => {
                c.setDraftOpen(!c.draftOpen);
              }}
              size="icon"
              variant="outline"
            >
              <Plus className="size-4" data-icon="inline-start" />
            </Button>
          </div>

          <div className="text-muted-foreground my-2 flex items-center justify-between text-xs">
            <span>
              已选 {chosen.length} / {c.styles.length} 种画风
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

          {c.draftOpen && (
            <NewStyleForm
              createError={c.createError}
              creating={c.creating}
              draft={c.draft}
              onCancel={() => {
                c.setDraftOpen(false);
              }}
              onChange={(patch) => {
                c.setDraft({ ...c.draft, ...patch });
              }}
              onSubmit={() => {
                void c.createStyle();
              }}
            />
          )}

          <div
            className={cn("flex flex-col gap-1 overflow-y-auto pr-1", EMBEDDED_SCROLL_MAX_HEIGHT)}
          >
            {c.loading && <p className="text-muted-foreground text-xs">正在读取画风…</p>}
            {!c.loading && c.loadError !== "" && (
              <p className="text-destructive text-xs">{c.loadError}</p>
            )}
            {!c.loading && c.loadError === "" && c.styles.length === 0 && (
              <p className="text-muted-foreground text-xs">
                没有匹配的画风，试试别的关键词或新建一个。
              </p>
            )}
            {c.styles.map((style) => (
              <StyleRow
                key={style.slug}
                onToggle={c.toggleStyle}
                selected={c.selectedSlugs.includes(style.slug)}
                style={style}
              />
            ))}
          </div>
        </aside>

        {/* ── 右栏：同一份提示词 + 多画风对比 ── */}
        <section className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="border-border bg-subtle/40 flex flex-col gap-3 rounded-xl border p-4">
            <FormField label="基础提示词">
              {(a11y) => (
                <Textarea
                  {...a11y}
                  onChange={(event) => {
                    c.setUserPrompt(event.target.value);
                  }}
                  placeholder="描述你想要的画面主体与动作"
                  rows={3}
                  value={c.userPrompt}
                />
              )}
            </FormField>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="动漫角色形象">
                {(a11y) => (
                  <SelectMenu
                    {...a11y}
                    fullWidth
                    labels={Object.fromEntries(
                      ANIME_CHARACTER_PRESETS.map((preset) => [preset.id, preset.name]),
                    )}
                    onChange={c.setCharacterId}
                    options={ANIME_CHARACTER_PRESETS.map((preset) => preset.id)}
                    popoverMinWidth={240}
                    value={c.characterId}
                  />
                )}
              </FormField>
              <FormField label="场景">
                {(a11y) => (
                  <SelectMenu
                    {...a11y}
                    fullWidth
                    labels={Object.fromEntries(
                      SCENE_PRESETS.map((preset) => [preset.id, preset.name]),
                    )}
                    onChange={c.setSceneId}
                    options={SCENE_PRESETS.map((preset) => preset.id)}
                    popoverMinWidth={240}
                    value={c.sceneId}
                  />
                )}
              </FormField>
            </div>
            {/* 级联选择器自带「选择模型」的 aria-label，这里只借 FormField 的标签行。 */}
            <FormField label="生图模型（只列支持文生图的）" />
            <ModelCascadeSelect
              kind="image"
              modes={["T2I"]}
              onSelectionChange={c.setModelSelection}
              selection={c.modelSelection}
            />
            {c.preview !== "" && (
              <p className="text-muted-foreground bg-muted/50 rounded-lg px-3 py-2 text-xs leading-relaxed">
                拼好的基础提示词：{c.preview}
              </p>
            )}
            <div className="flex items-center gap-3">
              <Button
                disabled={c.generating || chosen.length === 0}
                onClick={() => {
                  void c.generate();
                }}
              >
                {c.generating ? "生成中…" : "生成画风对比"}
              </Button>
              {c.notice !== "" && <span className="text-destructive text-xs">{c.notice}</span>}
            </div>
          </div>

          {chosen.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {chosen.map((style) => (
                <ResultCard key={style.slug} name={style.name} result={c.results[style.slug]} />
              ))}
            </div>
          )}
        </section>
      </div>
    </DocumentFrame>
  );
}
