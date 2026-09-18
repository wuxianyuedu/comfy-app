"use client";

/**
 * MultiModeSelect —— 一个工作流可挂多种模式（multi-select chip）。
 *
 * 工作流卡片右上角用它替代单选 SelectMenu：
 *   - 主 chip：默认 mode（按所在分类着色）
 *   - +N pill：附加模式弱化占位
 *   - 点主 chip 或 +N pill 开同一个多选 popover：
 *       · 搜索框（label / code / subCategory）
 *       · 按 image / video / audio 分类分组页签
 *       · 每行 = checkbox + label + code + 默认 toggle
 *       · 底部 取消 / 保存（显示已选条数）
 *
 * 浮层走 `~/components/ui/popover`（规范 16 §16.2.3 P2）：此前这里照抄了
 * SelectMenu 的全套自搓浮层（portal + fixed 定位 + 滚动重定位 + 手写 Esc /
 * 外点关闭 + z-index 魔数）—— 同一件事在库里因此有两份副本，改一处漏一处。
 * 现在定位与关闭语义交给 base-ui，本组件只留「多选 + 草稿」这件事自己。
 */

import { useCallback, useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import {
  ALL_WORKFLOW_TYPES,
  type WorkflowCategory,
} from "~/lib/workflow/workflow-types";

/* ── per-category pill colors（走语义 token，规范 03 §3.6.2）── */
const CATEGORY_PILL: Record<WorkflowCategory, string> = {
  image: "bg-primary-500/15 ring-1 ring-inset ring-primary-500/25",
  video: "bg-info/15 ring-info/25 ring-1 ring-inset",
  audio: "bg-warning/15 ring-warning/25 ring-1 ring-inset",
};
const CATEGORY_TEXT: Record<WorkflowCategory, string> = {
  image: "text-primary-strong",
  video: "text-info-strong",
  audio: "text-warning-strong",
};
const CATEGORY_LABEL: Record<WorkflowCategory, string> = {
  image: "图像",
  video: "视频",
  audio: "音频",
};
/* accent color for the active tab underline */
const CATEGORY_ACCENT: Record<WorkflowCategory, string> = {
  image: "bg-primary-400",
  video: "bg-info",
  audio: "bg-warning",
};

interface MultiModeSelectProps {
  /** All selected mode codes (defaultMode ⊆ modes).  Empty array → blank chip. */
  modes: string[];
  /** Default mode code (defaultMode must be in `modes`). */
  defaultMode: string;
  onChange: (modes: string[], defaultMode: string) => void;
  className?: string;
  disabled?: boolean;
  /** 隐藏右侧的「+N」徽标：调用方（如详情页）自行把全部模式列在上方，
   *  徽标就成了冗余。popover 仍可从主 chip 打开。 */
  hideExtraBadge?: boolean;
}

const POPOVER_MAX_H = 360;

export function MultiModeSelect({
  modes,
  defaultMode,
  onChange,
  className = "",
  disabled = false,
  hideExtraBadge = false,
}: MultiModeSelectProps) {
  const [open, setOpen] = useState(false);
  // Which category tab is currently shown in the popover (图像/视频/音频).
  const [activeTab, setActiveTab] = useState<WorkflowCategory>("image");
  // Draft state inside the popover — only flushed on save.
  const [draft, setDraft] = useState<Set<string>>(new Set(modes));
  /** 弹窗内的默认模式草稿（必须 ∈ draft），保存时一并落库。 */
  const [draftDefault, setDraftDefault] = useState<string>(defaultMode);
  const [query, setQuery] = useState("");

  // Reset draft only when the popover transitions from closed to open.
  // Do NOT reset while the user is actively checking items, otherwise
  // a parent re-render with a new `modes` array reference would wipe
  // the user's selection.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setDraft(new Set(modes));
      setDraftDefault(defaultMode);
      setQuery("");
      // Open on the category of the first selected mode (falls back to image).
      const firstSelected = ALL_WORKFLOW_TYPES.find((type) =>
        modes.includes(type.code),
      );
      setActiveTab(firstSelected?.category ?? "image");
    }
  }

  const toggle = useCallback((code: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  }, []);

  const handleSave = useCallback(() => {
    const arr = Array.from(draft);
    // 默认模式取弹窗内的草稿；草稿被取消勾选时回退到第一个选中项，
    // 保证 defaultMode ⊆ modes 的约束成立。
    const def = arr.includes(draftDefault) ? draftDefault : (arr[0] ?? "");
    onChange(arr, def);
    setOpen(false);
  }, [draft, draftDefault, onChange]);

  // Default mode's category drives the chip accent.
  const accent = useMemo(() => {
    const first = ALL_WORKFLOW_TYPES.find((type) => modes.includes(type.code));
    const def = ALL_WORKFLOW_TYPES.find((type) => type.code === defaultMode);
    const cat: WorkflowCategory = first?.category ?? def?.category ?? "image";
    return { pill: CATEGORY_PILL[cat], text: CATEGORY_TEXT[cat] };
  }, [modes, defaultMode]);

  // Filtered + grouped (by category) options.  Used inside the popover.
  const grouped = useMemo(() => {
    const lowerQuery = query.trim().toLowerCase();
    const filtered = ALL_WORKFLOW_TYPES.filter((type) => {
      if (!lowerQuery) return true;
      return (
        type.code.toLowerCase().includes(lowerQuery) ||
        type.label.toLowerCase().includes(lowerQuery) ||
        (type.subCategory?.toLowerCase().includes(lowerQuery) ?? false) ||
        (type.fullName.toLowerCase().includes(lowerQuery) ?? false)
      );
    });
    const groupedMap: Partial<
      Record<WorkflowCategory, typeof ALL_WORKFLOW_TYPES>
    > = {};
    for (const type of filtered) {
      (groupedMap[type.category] ??= []).push(type);
    }
    return groupedMap;
  }, [query]);

  const firstSelected = ALL_WORKFLOW_TYPES.find((type) =>
    modes.includes(type.code),
  );
  const mainLabel = firstSelected ? firstSelected.label : "选择模式";
  const plusN = Math.max(0, modes.length - 1);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <span
        className={`inline-flex items-center gap-1 ${disabled ? "pointer-events-none opacity-50" : ""}`}
      >
        {/* main chip — clicking opens the popover */}
        <PopoverTrigger
          title={`当前 ${modes.length} 种模式 · 点击管理`}
          render={
            <Button
              variant="ghost"
              disabled={disabled}
              className={`h-auto gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium hover:brightness-110 ${accent.pill} ${accent.text} ${className}`}
            />
          }
        >
          <span>{modes.length === 0 ? "选择模式" : mainLabel}</span>
          <svg
            className="shrink-0"
            width="10"
            height="10"
            viewBox="0 0 12 12"
            fill="none"
          >
            <path
              d="M3 4.5L6 7.5L9 4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </PopoverTrigger>

        {/* +N pill — clicking also opens the popover */}
        {plusN > 0 && !hideExtraBadge && (
          <Button
            variant="ghost"
            onClick={() => setOpen(true)}
            title={`还有 ${plusN} 种其他模式，点击管理`}
            className="text-ink-faint bg-primary-500/10 hover:bg-primary-500/20 hover:text-primary-strong h-auto rounded-md px-1.5 py-0.5 text-[11px] font-medium"
          >
            +{plusN}
          </Button>
        )}
      </span>

      <PopoverContent
        role="dialog"
        align="start"
        sideOffset={4}
        aria-label="工作流模式编辑器"
        className="border-border-strong bg-card w-[min(92vw,320px)] gap-0 overflow-hidden rounded-xl p-0 shadow-2xl shadow-black/5 dark:shadow-black/40"
      >
        {/* search */}
        <div className="border-border-subtle border-b p-2">
          <input
            autoFocus
            type="text"
            placeholder="搜索模式（标签 / 缩写）…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleSave();
              }
            }}
            className="bg-subtle text-ink-bright placeholder:text-ink-fainter focus:bg-surface-2 focus:ring-primary-500/30 w-full rounded-md px-2.5 py-1.5 text-sm transition-colors outline-none focus:ring-1"
          />
        </div>

        {/* tabs — switchable 图像 / 视频 / 音频 */}
        <div className="border-border-subtle flex items-center gap-1 border-b px-2 pt-2">
          {(["image", "video", "audio"] as WorkflowCategory[]).map((cat) => {
            const selCount = (grouped[cat] ?? []).filter((type) =>
              draft.has(type.code),
            ).length;
            const isActive = activeTab === cat;
            return (
              <Button
                key={cat}
                variant="ghost"
                onClick={() => setActiveTab(cat)}
                className={`relative h-auto flex-1 rounded-t-md px-2 py-1.5 text-xs font-semibold ${
                  isActive
                    ? `${CATEGORY_TEXT[cat]} bg-surface-2 hover:bg-surface-2`
                    : "text-ink-muted hover:text-ink-strong"
                }`}
              >
                {CATEGORY_LABEL[cat]}
                {selCount > 0 && (
                  <span className={`ml-1 text-[10px] ${CATEGORY_TEXT[cat]}`}>
                    {selCount}
                  </span>
                )}
                {isActive && (
                  <span
                    className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full ${CATEGORY_ACCENT[cat]}`}
                  />
                )}
              </Button>
            );
          })}
        </div>

        {/* list — only the active tab's category */}
        <div
          style={{ maxHeight: POPOVER_MAX_H }}
          className="overflow-y-auto py-1"
        >
          {(() => {
            const items = grouped[activeTab] ?? [];
            if (items.length === 0) {
              return (
                <div className="text-ink-muted px-3 py-4 text-center text-xs">
                  {query.trim()
                    ? "没有匹配的模式"
                    : `${CATEGORY_LABEL[activeTab]}暂无模式`}
                </div>
              );
            }
            return items.map((item) => {
              const isSelected = draft.has(item.code);
              const isDraftDefault = draftDefault === item.code;
              return (
                <div
                  key={item.code}
                  className={`flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                    isSelected
                      ? "bg-primary-500/10 text-primary-strong"
                      : "text-ink-strong hover:bg-subtle"
                  }`}
                  onClick={() => toggle(item.code)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggle(item.code);
                    }
                  }}
                  tabIndex={0}
                  role="checkbox"
                  aria-checked={isSelected}
                >
                  {/* checkbox: 每个被选中的模式都显示勾选标记 */}
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      isSelected
                        ? "border-primary-500/60 bg-primary-500/30"
                        : "border-border-strong bg-card"
                    }`}
                  >
                    {isSelected && (
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 12 12"
                        fill="none"
                      >
                        <path
                          d="M2.5 6l2.5 2.5L9.5 3.5"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                  <span className="flex-1 truncate text-[13px] font-medium">
                    {item.label}
                  </span>
                  {/* 默认模式标记：点星星把该模式设为默认（未选中会顺带勾上） */}
                  <Button
                    variant="ghost"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!draft.has(item.code)) toggle(item.code);
                      setDraftDefault(item.code);
                    }}
                    title={isDraftDefault ? "当前默认模式" : "设为默认模式"}
                    className={`h-auto shrink-0 rounded px-1 py-0.5 text-[10px] font-medium ${
                      isDraftDefault
                        ? "bg-primary-500/25 text-primary-strong hover:bg-primary-500/25"
                        : "text-ink-muted hover:bg-surface-2 hover:text-ink-strong"
                    }`}
                  >
                    {isDraftDefault ? "★ 默认" : "☆ 默认"}
                  </Button>
                  <span
                    className={`shrink-0 text-[11px] ${CATEGORY_TEXT[activeTab]} opacity-60`}
                  >
                    {item.code}
                  </span>
                </div>
              );
            });
          })()}
        </div>

        {/* footer */}
        <div className="border-border-subtle flex items-center gap-2 border-t p-2">
          <Button
            variant="secondary"
            onClick={() => setOpen(false)}
            className="h-auto flex-1 rounded-md px-3 py-1.5 text-sm"
          >
            取消
          </Button>
          <Button
            variant="primary-solid"
            onClick={handleSave}
            disabled={draft.size === 0}
            className="h-auto flex-1 rounded-md px-3 py-1.5 text-sm font-semibold"
          >
            保存（{draft.size}）
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
