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
import { Gauge, History, RefreshCw, Search, Sparkles, UserPlus, Users, Wand2 } from "lucide-react";

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
import { CharacterEditDialog, type CharacterFormValues } from "./CharacterEditDialog";
import { CharacterGenerateDialog } from "./CharacterGenerateDialog";
import { CharacterSeedDialog } from "./CharacterSeedDialog";
import { CHARACTER_STATUS_FILTERS } from "./character-status";
import { useCharacterLibrary } from "./hooks/use-character-library";

/** 标签筛选行最多展示几枚（按分面计数取前 N；已选中的恒在）。 */
const TAG_FILTER_LIMIT = 24;

/** 详情候选删除确认（从页面函数拆出，守住函数长度硬闸）。 */
type PortraitDeleteConfirmProps = {
  count: number;
  deleting: boolean;
  name: string | null;
  onClose: () => void;
  onConfirm: () => void;
  open: boolean;
};

function PortraitDeleteConfirm({
  count,
  deleting,
  name,
  onClose,
  onConfirm,
  open,
}: PortraitDeleteConfirmProps) {
  return (
    <ConfirmDialog
      confirmLabel="删除选中"
      danger
      description={`将从「${name ?? "该角色"}」删除 ${count} 张候选立绘；主立绘与来源任务不受影响。`}
      onClose={onClose}
      onConfirm={onConfirm}
      open={open}
      pending={deleting}
      title="删除选中的候选立绘？"
    />
  );
}

/** 批量打分后发现低分立绘的提示条（从页面拆出，守住函数长度硬闸）。 */
function QualityWarning({
  count,
  onRegenerate,
  regenerating,
}: {
  count: number;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  return (
    <div className="border-warning-strong/30 bg-warning-soft mb-3 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2">
      <span className="text-ink-strong text-xs">
        {count} 张立绘质量有问题（纯色 / 空白 / 低分辨率等），建议重新生成。
      </span>
      <Button
        disabled={regenerating}
        onClick={onRegenerate}
        size="xs"
        type="button"
        variant="outline"
      >
        {regenerating ? "重新生成中…" : "重生成问题立绘"}
      </Button>
    </div>
  );
}

/** 生图弹窗的显式目标：详情重跑发该角色，选择模式发勾选项，否则空（全部待生成）。 */
function resolveGenerateTargetIds(
  regenerateTargetId: string | null,
  selecting: boolean,
  selected: Array<string>,
): Array<string> {
  if (regenerateTargetId !== null) {
    return [regenerateTargetId];
  }
  return selecting ? selected : [];
}

export function CharacterLibrary() {
  const c = useCharacterLibrary();
  const [seedOpen, setSeedOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  /** 详情里点「重新生图」时记录目标角色（弹窗标题与单发语义用）。 */
  const [regenerateTargetId, setRegenerateTargetId] = useState<string | null>(null);
  /** 手工建档弹窗：editTargetId 非空 = 编辑该角色（初值在 editInitial）；
   *  null = 新建。初值在点「编辑」那一刻从详情行固化，不随后续刷新漂。 */
  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const [editInitial, setEditInitial] = useState<CharacterFormValues | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  /** 选择模式：勾选后卡片出现 checkbox，批量生图只对选中角色入队。 */
  const [selectingCharacters, setSelectingCharacters] = useState(false);
  /** 详情候选删除的 ConfirmDialog 开关（沿用角色库的非阻塞确认纪律）。 */
  const [portraitDeleteOpen, setPortraitDeleteOpen] = useState(false);

  const removeTargetCharacter = c.items.find((item) => item.id === c.removeTarget) ?? null;
  const regenerateTarget = c.items.find((item) => item.id === regenerateTargetId) ?? null;
  const generateTargetIds = resolveGenerateTargetIds(
    regenerateTargetId,
    selectingCharacters,
    c.selectedCharacterIds,
  );

  /** 手工建档提交：编辑走 update（只改档案三字段，名字锁定），新建走 create。 */
  const submitEdit = async (values: CharacterFormValues): Promise<boolean> => {
    const ok =
      editTargetId === null
        ? await c.createCharacter(values)
        : await c.updateCharacter(editTargetId, {
            archetype: values.archetype,
            description: values.description,
            gender: values.gender,
          });
    if (ok) {
      setEditOpen(false);
      setEditTargetId(null);
    }
    return ok;
  };

  /** 打开「编辑」：初值取自当前详情行（详情弹窗开着 ⇒ 数据已在）。 */
  const openEdit = (id: string) => {
    const row = c.detail;
    if (row === null || row.id !== id) {
      return;
    }
    setEditTargetId(id);
    setEditInitial({
      archetype: row.archetype,
      description: row.description,
      gender: row.gender,
      name: row.name,
    });
    setEditOpen(true);
  };

  /** 打开「新建」。 */
  const openCreate = () => {
    setEditTargetId(null);
    setEditInitial(null);
    setEditOpen(true);
  };

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
          <SelectChip
            onClick={() => {
              if (selectingCharacters) {
                c.clearCharacterSelection();
              }
              setSelectingCharacters((prev) => !prev);
            }}
            selected={selectingCharacters}
            shape="pill"
          >
            <span>
              {selectingCharacters ? `已选 ${c.selectedCharacterIds.length} 个角色` : "选择角色"}
            </span>
          </SelectChip>
          {c.generating ? (
            <Button onClick={c.syncNow} size="sm" type="button" variant="outline">
              <RefreshCw aria-hidden className="size-3.5" data-icon="inline-start" />
              同步进度（每 5 秒自动）
            </Button>
          ) : null}
          <Button
            disabled={c.scoring}
            onClick={() => {
              void c.scoreAllQuality();
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            <Gauge aria-hidden className="size-3.5" data-icon="inline-start" />
            {c.scoring ? "打分中…" : "质量打分"}
          </Button>
          <Button onClick={openCreate} size="sm" type="button" variant="outline">
            <UserPlus aria-hidden className="size-3.5" data-icon="inline-start" />
            新建角色
          </Button>
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
            disabled={selectingCharacters && c.selectedCharacterIds.length === 0}
            onClick={() => {
              setRegenerateTargetId(null);
              setGenerateOpen(true);
            }}
            size="sm"
            type="button"
          >
            <Wand2 aria-hidden className="size-3.5" data-icon="inline-start" />
            {selectingCharacters ? `批量生图（${c.selectedCharacterIds.length}）` : "批量生图"}
          </Button>
        </div>
      </div>

      {/* ── 质量问题提示条：批量打分后发现低分立绘 ── */}
      {c.flaggedCount !== null && c.flaggedCount > 0 ? (
        <QualityWarning
          count={c.flaggedCount}
          onRegenerate={() => {
            void c.regenerateFlagged();
          }}
          regenerating={c.regenerating}
        />
      ) : null}

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
              cancellingGeneration={c.isCancelBusy(item.id)}
              character={item}
              key={item.id}
              onCancelGeneration={(id) => {
                void c.cancelOne(id);
              }}
              onOpenDetail={c.openDetail}
              onRemove={(target) => {
                c.openRemove(target.id);
              }}
              onToggleSelection={c.toggleCharacterSelection}
              selected={c.selectedCharacterIds.includes(item.id)}
              selectionMode={selectingCharacters}
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
        onSubmit={(workflowId, limit, ids) => {
          void c.enqueueGeneration(workflowId, limit, ids).then((ok) => {
            if (ok) {
              setGenerateOpen(false);
              setRegenerateTargetId(null);
            }
          });
        }}
        open={generateOpen}
        pending={c.enqueuing}
        targetIds={generateTargetIds}
        workflows={c.workflows}
        workflowsLoading={c.workflowsLoading}
      />

      {/* ── 角色详情弹窗（完整描述 + 全部标签 + 候选立绘）── */}
      <CharacterDetailModal
        cancellingGeneration={c.isCancelBusy(c.detailId ?? "")}
        character={c.detail}
        deletingPortraits={c.deletingPortraits}
        history={c.history}
        historyLoading={c.historyLoading}
        onCancelGeneration={(id) => {
          void c.cancelOne(id);
        }}
        onClose={() => {
          c.closeDetail();
          setPortraitDeleteOpen(false);
        }}
        onDeleteSelectedPortraits={() => {
          setPortraitDeleteOpen(true);
        }}
        onEdit={openEdit}
        onRegenerate={(id) => {
          setRegenerateTargetId(id);
          setGenerateOpen(true);
        }}
        onRemove={(id) => {
          c.openRemove(id);
        }}
        onScore={(id) => {
          void c.scoreOne(id);
        }}
        onTogglePortraitSelection={c.togglePortraitSelection}
        open={c.detailId !== null}
        regenerating={c.enqueuing}
        scoring={c.scoring}
        selectedPortraitUrls={c.selectedPortraitUrls}
      />

      {/* ── 手工建档弹窗（新建 / 编辑，create / update 的消费方）── */}
      <CharacterEditDialog
        initial={editInitial}
        key={editTargetId ?? "new"}
        onClose={() => {
          setEditOpen(false);
          setEditTargetId(null);
        }}
        onSubmit={submitEdit}
        open={editOpen}
        pending={editTargetId === null ? c.creating : c.updating}
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

      {/* ── 详情候选删除确认（非阻塞，与角色 / 资产库同一纪律）── */}
      <PortraitDeleteConfirm
        count={c.selectedPortraitUrls.length}
        deleting={c.deletingPortraits}
        name={c.detail?.name ?? null}
        onClose={() => {
          setPortraitDeleteOpen(false);
        }}
        onConfirm={() => {
          void c.deleteSelectedPortraits().then((ok) => {
            if (ok) {
              setPortraitDeleteOpen(false);
            }
          });
        }}
        open={portraitDeleteOpen}
      />
    </DocumentFrame>
  );
}
