"use client";

/**
 * `CharacterDetailModal` — 角色详情弹窗（ISSUE #5009）：左侧立绘预览（含**全部**
 * 候选立绘切换与勾选删除），右侧档案：原型 / 性别 / 状态 / 完整描述 / 全部特征标签
 * + 生成历史（模型 / 工作流 / 状态 / 时间 / 提示词 / 错误）。
 * 操作：「重新生图」「打分」「编辑」「删除」及「删除选中候选」。
 * 纯展示组件：数据与回调由 CharacterLibrary 注入（规范 17 §17.2 第③层）。
 */
import { useState } from "react";
import { Gauge, RefreshCw, SquarePen, Trash2, X } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { ViewableImage } from "~/components/ui/image-viewer";
import { displayValue } from "~/lib/display-value";
import { formatClock, formatDate } from "~/lib/time-format";
import { cn } from "~/lib/utils";

import { characterStatusClass, CHARACTER_STATUS_LABELS } from "./character-status";
import type { CharacterDetail, CharacterHistoryRow } from "./hooks/use-character-library";

export type CharacterDetailModalProps = {
  /** 该角色的取消动作进行中（按钮禁用，防连点）。 */
  cancellingGeneration?: boolean;
  character: CharacterDetail | null;
  /** 删除勾选候选进行中（按钮禁用）。 */
  deletingPortraits: boolean;
  /** 当前角色的全部生成历史（null = 未取到）。 */
  history: Array<CharacterHistoryRow> | null;
  historyLoading: boolean;
  onCancelGeneration?: (id: string) => void;
  onClose: () => void;
  /** 视图只上报「用户确认删」，请求由 controller 收口。 */
  onDeleteSelectedPortraits: () => void;
  onEdit: (id: string) => void;
  onRegenerate: (id: string) => void;
  onRemove: (id: string) => void;
  onScore: (id: string) => void;
  onTogglePortraitSelection: (url: string) => void;
  /** 弹层开关：详情 id 非空才开——查询的 pending 态不能当开关。 */
  open: boolean;
  regenerating: boolean;
  scoring: boolean;
  /** 勾选待删的候选立绘 url。 */
  selectedPortraitUrls: Array<string>;
};

/** 历史时间统一成可读文案（createdAt 是 epoch 毫秒）：日期走统一出口，避免宿主区域设置漂移。 */
function historyTime(createdAt: number): string {
  return `${formatDate(createdAt)} ${formatClock(createdAt)}`;
}

export function CharacterDetailModal({
  cancellingGeneration = false,
  character,
  deletingPortraits,
  history,
  historyLoading,
  onCancelGeneration,
  onClose,
  onDeleteSelectedPortraits,
  onEdit,
  onRegenerate,
  onRemove,
  onScore,
  onTogglePortraitSelection,
  open,
  regenerating,
  scoring,
  selectedPortraitUrls,
}: CharacterDetailModalProps) {
  const [portraitIndex, setPortraitIndex] = useState(0);
  /** 点历史条目时固定预览那张图；点候选缩略图时清空、回到候选预览。 */
  const [historyUrl, setHistoryUrl] = useState<string | null>(null);
  const portraits = character?.portraits ?? [];
  /* 候选列表最新在前（路由回写时新图插到最前），portraitUrl 恒等于第 0 张。 */
  const activePortrait = portraits[portraitIndex]?.url ?? character?.portraitUrl ?? null;
  const previewUrl = historyUrl ?? activePortrait;
  const activeHistory =
    history?.find((row) => row.url === historyUrl) ??
    history?.find(
      (row) => row.url === activePortrait || row.taskId === portraits[portraitIndex]?.taskId,
    ) ??
    null;

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
      open={open}
    >
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{character?.name ?? "角色详情"}</DialogTitle>
          <DialogDescription>
            {character === null
              ? "加载中…"
              : [
                  character.archetype === "" ? "未设原型" : character.archetype,
                  character.gender,
                  CHARACTER_STATUS_LABELS[character.status] ?? character.status,
                ]
                  .filter((part) => part !== "" && part !== undefined)
                  .join(" · ")}
          </DialogDescription>
        </DialogHeader>
        {character === null ? null : (
          <div className="flex gap-4">
            {/* ── 左：立绘预览 + 全部候选（每张带删除勾选） ── */}
            <div className="w-56 shrink-0">
              <div className="bg-panel-deep aspect-3/4 w-full overflow-hidden rounded-lg">
                {previewUrl === null ? (
                  <span className="text-ink-fainter flex size-full items-center justify-center text-xs">
                    {character.status === "failed" ? "最近一次生成失败" : "暂无立绘"}
                  </span>
                ) : (
                  <ViewableImage
                    alt={character.name}
                    className="h-full w-full object-cover"
                    label={character.name}
                    src={previewUrl}
                  />
                )}
              </div>
              {portraits.length > 1 ? (
                <div className="custom-scrollbar mt-2 flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                  {portraits.map((portrait, index) => (
                    <div className="relative" key={portrait.url}>
                      <Button
                        aria-label={`查看第 ${index + 1} 张候选立绘`}
                        className={cn(
                          "bg-panel-deep size-10 overflow-hidden rounded-md border p-0",
                          (historyUrl ?? activePortrait) === portrait.url
                            ? "border-primary-strong"
                            : "border-transparent opacity-70",
                        )}
                        onClick={() => {
                          setPortraitIndex(index);
                          setHistoryUrl(null);
                        }}
                        type="button"
                        variant="ghost"
                      >
                        {/* 候选缩略图：MediaThumbnail 带加载失败兜底（P18：不裸写 img）。 */}
                        <MediaThumbnail
                          alt=""
                          className="size-full object-cover"
                          src={portrait.url}
                        />
                      </Button>
                      <Checkbox
                        aria-label={`勾选第 ${index + 1} 张候选立绘用于删除`}
                        checked={selectedPortraitUrls.includes(portrait.url)}
                        className="bg-panel/80 absolute top-0.5 right-0.5"
                        onCheckedChange={() => {
                          onTogglePortraitSelection(portrait.url);
                        }}
                      />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {/* ── 右：档案描述 + 标签 + 生成历史 + 操作 ── */}
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="custom-scrollbar max-h-64 overflow-y-auto">
                <p className="text-ink-strong text-sm leading-relaxed whitespace-pre-wrap">
                  {character.description}
                </p>
              </div>
              {character.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {character.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {character.qualityScore !== null && character.qualityScore !== undefined ? (
                <div className="flex flex-col gap-1">
                  <p
                    className={cn(
                      "text-xs font-medium",
                      character.qualityScore >= 80
                        ? "text-success-strong"
                        : character.qualityScore >= 60
                          ? "text-warning-strong"
                          : "text-danger-strong",
                    )}
                  >
                    质量分 {character.qualityScore} / 100
                  </p>
                  {(character.qualityIssues ?? []).length > 0 ? (
                    <ul className="text-ink-fainter text-2xs list-disc pl-4">
                      {(character.qualityIssues ?? []).map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              {/* ── 生成历史：选中候选看对应任务，下列全量条目可点选切换 ── */}
              <div className="border-border-subtle flex min-h-0 flex-col gap-2 border-t pt-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-ink-strong text-xs font-medium">生成历史</p>
                  <span className="text-ink-fainter text-2xs">
                    {historyLoading ? "读取中…" : `共 ${history?.length ?? 0} 条`}
                  </span>
                </div>
                {activeHistory === null ? (
                  <p className="text-ink-fainter text-2xs">
                    {history === null
                      ? "暂无生成历史。"
                      : "点选一张候选立绘或下方历史条目查看生成信息。"}
                  </p>
                ) : (
                  <div className="bg-panel-deep text-2xs flex flex-col gap-1 rounded-lg p-2">
                    <p className="text-ink-strong">
                      工作流 {displayValue(activeHistory.workflowName)} · 模型{" "}
                      {displayValue(activeHistory.modelName)}
                    </p>
                    <p className="text-ink-faint">
                      状态 {displayValue(activeHistory.status)} · 时间{" "}
                      {historyTime(activeHistory.createdAt)} · 产物 {activeHistory.imageCount} 张
                    </p>
                    <p className="text-ink-faint line-clamp-2">
                      提示词 {displayValue(activeHistory.prompt)}
                    </p>
                    {activeHistory.error === null ? null : (
                      <p className="text-danger-strong line-clamp-2">
                        错误 {displayValue(activeHistory.error)}
                      </p>
                    )}
                  </div>
                )}
                {history !== null && history.length > 0 ? (
                  <div className="custom-scrollbar flex max-h-40 flex-col gap-1 overflow-y-auto">
                    {history.map((row) => (
                      <Button
                        className={cn(
                          "flex h-auto flex-col items-start gap-0 px-2 py-1 text-left",
                          row.url === (historyUrl ?? activePortrait) && "bg-primary-soft",
                        )}
                        key={row.taskId}
                        onClick={() => {
                          setHistoryUrl(row.url);
                          const index = portraits.findIndex(
                            (portrait) =>
                              portrait.url === row.url || portrait.taskId === row.taskId,
                          );
                          if (index !== -1) {
                            setPortraitIndex(index);
                          }
                        }}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        <span className="text-ink-strong text-2xs">
                          {historyTime(row.createdAt)} · {displayValue(row.workflowName)}
                        </span>
                        <span className="text-ink-fainter text-2xs">
                          {displayValue(row.modelName)} · {displayValue(row.status)} ·{" "}
                          {row.imageCount} 张
                        </span>
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="mt-auto flex flex-wrap items-center gap-2">
                {character.status === "generating" && character.taskId ? (
                  <Button
                    aria-label="取消生成"
                    disabled={cancellingGeneration}
                    onClick={() => {
                      onCancelGeneration?.(character.id);
                    }}
                    size="sm"
                    type="button"
                    variant="destructive"
                  >
                    <X aria-hidden className="size-3.5" data-icon="inline-start" />
                    取消生成
                  </Button>
                ) : null}
                <Button
                  onClick={() => {
                    onRegenerate(character.id);
                  }}
                  size="sm"
                  type="button"
                >
                  <RefreshCw aria-hidden className="size-3.5" data-icon="inline-start" />
                  {regenerating ? "入队中…" : "重新生图"}
                </Button>
                <Button
                  disabled={scoring}
                  onClick={() => {
                    onScore(character.id);
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Gauge aria-hidden className="size-3.5" data-icon="inline-start" />
                  {scoring ? "打分中…" : "打分"}
                </Button>
                <Button
                  onClick={() => {
                    onEdit(character.id);
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <SquarePen aria-hidden className="size-3.5" data-icon="inline-start" />
                  编辑
                </Button>
                <Button
                  onClick={() => {
                    onRemove(character.id);
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Trash2 aria-hidden className="size-3.5" data-icon="inline-start" />
                  删除
                </Button>
                <Button
                  disabled={selectedPortraitUrls.length === 0 || deletingPortraits}
                  onClick={() => {
                    onDeleteSelectedPortraits();
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Trash2 aria-hidden className="size-3.5" data-icon="inline-start" />
                  {deletingPortraits ? "删除中…" : `删除选中（${selectedPortraitUrls.length}）`}
                </Button>
                <span
                  className={cn(
                    "text-2xs ml-auto rounded-full px-2 py-0.5 font-medium",
                    characterStatusClass(character.status),
                  )}
                >
                  {CHARACTER_STATUS_LABELS[character.status] ?? character.status}
                </span>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
