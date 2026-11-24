"use client";

/**
 * `CharacterLibrary` — 角色库页（ISSUE #5009）：跨项目的二次元角色档案池。
 *
 * 工具行：关键词搜索 + 状态档 + 预置 / 批量生图两个动作 + 生成进度对账；
 * 标签行：按标签分面（当前过滤下的命中数）多选筛选（AND 语义，选得越多越窄）；
 * 网格：竖版立绘卡。取数与业务规则在 `useCharacterLibrary`，本文件只做组合与
 * 弹层编排（规范 17 §17.2 第④层）。
 */
import { useMemo, useState } from "react";
import { History, RefreshCw, Search, Sparkles, Users, Wand2 } from "lucide-react";

import { DocumentFrame } from "~/components/studio/ViewContainer";
import { pageHeaderTitle } from "~/components/studio/NavItems";
import { AuroraBackground } from "~/components/ui/aurora-background";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { EmptyState } from "~/components/ui/empty-state";
import { Input } from "~/components/ui/input";
import { PageHeader } from "~/components/ui/page-header";
import { SelectChip } from "~/components/ui/select-chip";
import { Skeleton } from "~/components/ui/skeleton";
import { compareText } from "~/lib/ordered-set";

import { CharacterCard } from "./CharacterCard";
import { CharacterDetailModal } from "./CharacterDetailModal";
import { CharacterGenerateDialog } from "./CharacterGenerateDialog";
import { CharacterSeedDialog } from "./CharacterSeedDialog";
import { CHARACTER_STATUS_FILTERS } from "./character-status";
import { useCharacterLibrary } from "./hooks/use-character-library";

/** 标签筛选行最多展示几枚（按分面计数取前 N；已选中的恒在）。 */
const TAG_FILTER_LIMIT = 24;

export function CharacterLibrary() {
  const c = useCharacterLibrary();
  const [seedOpen, setSeedOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  /** 详情里点「重新生图」时记录目标角色（弹窗标题与单发语义用）。 */
  const [regenerateTargetId, setRegenerateTargetId] = useState<string | null>(null);

  const removeTargetCharacter = c.items.find((item) => item.id === c.removeTarget) ?? null;
  const regenerateTarget = c.items.find((item) => item.id === regenerateTargetId) ?? null;

  /** 状态角标总和 = 角色库总量（当前用户）。 */
  const total = useMemo(
    () => Object.values(c.statusCounts).reduce((sum, n) => sum + n, 0),
    [c.statusCounts],
  );

  /** 标签筛选行：分面前 N 名 ∪ 已选中（选中的即便这轮计数为 0 也要能取消）。 */
  const tagChips = useMemo(() => {
    const names = new Set<string>(c.selectedTags);
    for (const facet of c.tagFacets.slice(0, TAG_FILTER_LIMIT)) {
      names.add(facet.tag);
    }
    const countOf = (tag: string) => c.tagFacets.find((facet) => facet.tag === tag)?.count ?? 0;
    return [...names]
      .map((tag) => ({ count: countOf(tag), tag }))
      .sort((left, right) => right.count - left.count || compareText(left.tag, right.tag));
  }, [c.selectedTags, c.tagFacets]);

  return (
    <DocumentFrame
      backdrop={<AuroraBackground />}
      className="px-4 pt-4 pb-6 sm:px-8 sm:pt-5 sm:pb-8"
      width="wide"
    >
      <PageHeader srTitle={pageHeaderTitle("characters")} />

      {/* ── 工具行：搜索 + 状态档 + 动作 ── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-56">
          <Search
            aria-hidden
            className="text-ink-fainter pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
          />
          <Input
            aria-label="搜索角色"
            className="h-8 pl-8 text-xs"
            onChange={(event) => {
              c.setQ(event.target.value);
            }}
            placeholder="搜索名字、原型、描述…"
            value={c.q}
          />
        </div>
        <div aria-label="按状态筛选" className="flex flex-wrap gap-1.5" role="radiogroup">
          {CHARACTER_STATUS_FILTERS.map((option) => (
            <SelectChip
              key={option.key}
              onClick={() => {
                c.setStatus(option.key);
              }}
              selected={c.status === option.key}
              shape="pill"
            >
              <span>
                {option.label}
                {option.key !== "all" && c.statusCounts[option.key] !== undefined
                  ? ` ${c.statusCounts[option.key]}`
                  : ""}
              </span>
            </SelectChip>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {c.generating ? (
            <Button onClick={c.syncNow} size="sm" type="button" variant="outline">
              <RefreshCw aria-hidden className="size-3.5" data-icon="inline-start" />
              同步进度（每 5 秒自动）
            </Button>
          ) : null}
          <Button
            onClick={() => {
              setSeedOpen(true);
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            <Sparkles aria-hidden className="size-3.5" data-icon="inline-start" />
            预置角色
          </Button>
          <Button
            onClick={() => {
              setRegenerateTargetId(null);
              setGenerateOpen(true);
            }}
            size="sm"
            type="button"
          >
            <Wand2 aria-hidden className="size-3.5" data-icon="inline-start" />
            批量生图
          </Button>
        </div>
      </div>

      {/* ── 标签筛选行（多选 AND；空态不占位）── */}
      {tagChips.length > 0 ? (
        <div
          aria-label="按标签筛选"
          className="custom-scrollbar mb-4 flex flex-wrap gap-1.5 overflow-y-auto"
        >
          {tagChips.map((chip) => (
            <SelectChip
              key={chip.tag}
              onClick={() => {
                c.toggleTag(chip.tag);
              }}
              selected={c.selectedTags.includes(chip.tag)}
              shape="pill"
            >
              <span>
                {chip.tag}
                {chip.count > 0 ? ` ${chip.count}` : ""}
              </span>
            </SelectChip>
          ))}
        </div>
      ) : null}

      <p className="text-ink-fainter text-2xs mb-3">
        共 {total} 个角色
        {c.selectedTags.length > 0 ? ` · 已按 ${c.selectedTags.length} 枚标签取交集` : ""}
      </p>

      {/* ── 角色网格 ── */}
      {c.loading ? (
        <div aria-label="加载中" className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" role="status">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton className="aspect-3/4 rounded-xl" key={index} />
          ))}
        </div>
      ) : c.items.length === 0 ? (
        <EmptyState
          action={
            <Button
              onClick={() => {
                setSeedOpen(true);
              }}
              size="sm"
              type="button"
            >
              <Users aria-hidden className="size-3.5" data-icon="inline-start" />
              预置一批角色
            </Button>
          }
          description={c.empty.hint}
          icon={<History className="size-6" />}
          minHeightClass="min-h-75"
          title={c.empty.title}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {c.items.map((item) => (
            <CharacterCard
              character={item}
              key={item.id}
              onOpenDetail={c.openDetail}
              onRemove={(target) => {
                c.openRemove(target.id);
              }}
            />
          ))}
        </div>
      )}

      {/* ── 预置角色弹窗 ── */}
      <CharacterSeedDialog
        onClose={() => {
          setSeedOpen(false);
        }}
        onSubmit={(count) => {
          void c.seed(count).then((ok) => {
            if (ok) {
              setSeedOpen(false);
            }
          });
        }}
        open={seedOpen}
        pending={c.seeding}
      />

      {/* ── 批量生图弹窗（工作流选择 + 本批数量）── */}
      <CharacterGenerateDialog
        onClose={() => {
          setGenerateOpen(false);
          setRegenerateTargetId(null);
        }}
        onlyCharacterName={regenerateTarget?.name ?? null}
        onSubmit={(workflowId, limit) => {
          void c.enqueueGeneration(workflowId, limit).then((ok) => {
            if (ok) {
              setGenerateOpen(false);
              setRegenerateTargetId(null);
            }
          });
        }}
        open={generateOpen}
        pending={c.enqueuing}
        workflows={c.workflows}
        workflowsLoading={c.workflowsLoading}
      />

      {/* ── 角色详情弹窗（完整描述 + 全部标签 + 候选立绘）── */}
      <CharacterDetailModal
        character={c.detail}
        onClose={() => {
          setRegenerateTargetId(null);
          c.refresh();
        }}
        onRegenerate={(id) => {
          setRegenerateTargetId(id);
          setGenerateOpen(true);
        }}
        onRemove={(id) => {
          c.openRemove(id);
        }}
        open={c.detailId !== null}
        regenerating={c.enqueuing}
      />

      {/* ── 角色删除确认（非阻塞，与资产库同一纪律）── */}
      <ConfirmDialog
        confirmLabel="删除"
        danger
        description={
          removeTargetCharacter === null
            ? ""
            : `即将删除「${removeTargetCharacter.name}」。角色立绘文件将一并从磁盘清除；来源任务不受影响。`
        }
        onClose={c.cancelRemove}
        onConfirm={c.confirmRemove}
        open={c.removeTarget !== null}
        title="删除这个角色？"
      />
    </DocumentFrame>
  );
}
